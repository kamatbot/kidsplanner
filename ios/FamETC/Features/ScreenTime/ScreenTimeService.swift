import Foundation
import UIKit
import Combine
import BackgroundTasks
import FamilyControls
import DeviceActivity

enum ScreenTimeServiceError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
}

/// Screen Time for both sides of the family (docs/SCREEN-TIME-PLAN.md).
/// Kid device: Apple authorization, enrollment, heartbeat + local enforcement via
/// `ScreenTimeEnforcer`. Parent: the server policy/devices/alerts endpoints.
@MainActor @Observable final class ScreenTimeService {
    static let shared = ScreenTimeService()
    nonisolated static let refreshTaskId = "com.fametc.app.screentime.refresh"

    // MARK: Kid device state
    var authState: ScreenTimeAuthState
    var mode: ScreenTimeMode?
    var isEnrolled: Bool
    var policy: ScreenTimePolicy?
    var lastSyncAt: Date?
    var lastError: String?
    /// The kid's signed Screen Time deal (server copy). Before enrollment `/mine` supplies it.
    var agreement: ScreenTimeAgreement?
    /// Signed on this device but not saved yet (offline / server error). Retried on every sync.
    var pendingAgreement: ScreenTimeAgreement?

    /// The kid's last "more time" requests, newest first.
    var requests: [ScreenTimeRequest] = []
    /// The kid's fams balance (nil until loaded / if it failed — the server still checks).
    var famsBalance: Double?

    /// Only one request can wait at a time.
    var pendingRequest: ScreenTimeRequest? { requests.first(where: \.isPending) }

    /// Extra minutes a grown-up approved for today (nil when none).
    var bonusToday: Int? { ScreenTimeSchedule.activeBonus(policy?.bonus, today: Date()) }

    /// What the kid sees as "our deal": the saved one, or the one waiting to save.
    var currentDeal: ScreenTimeAgreement? { pendingAgreement ?? agreement }

    /// The deal's rules snapshot no longer matches the current bedtime / daily time
    /// (pause never counts): time to renew it together.
    var agreementIsStale: Bool {
        guard let deal = currentDeal, let policy else { return false }
        return deal.isStale(for: policy)
    }

    /// The policy has a `total` limit but this device hasn't picked "All Apps &
    /// Categories" for it yet (device projection `selection` is nil). Save via
    /// `saveDeviceSelection(limitId: "total", …)`.
    var needsTotalSelection: Bool {
        guard let policy, policy.enabled else { return false }
        return policy.limits.contains { $0.isTotal && $0.selection == nil }
    }

    /// A device-local "All Apps & Categories" pick exists (for usage milestones).
    var hasUsageSelection: Bool

    /// This device can't count its screen time yet: no "everything" selection (neither
    /// its `total` selection nor a local usage pick). Setup ends with that pick.
    var needsUsageSelection: Bool {
        guard isEnrolled, authState == .approved, let policy, policy.enabled, !hasUsageSelection else { return false }
        return !policy.limits.contains { $0.isTotal && $0.selection != nil }
    }

    // MARK: Parent state
    var overview: ScreenTimeOverview?
    var unackedAlerts: [ScreenTimeAlert] {
        overview?.kids.flatMap { $0.alerts.filter { $0.ackedAt == nil } } ?? []
    }
    /// Kids' "more time" requests waiting for a parent, oldest first.
    var pendingRequests: [ScreenTimeRequest] {
        (overview?.kids.flatMap { ($0.requests ?? []).filter(\.isPending) } ?? [])
            .sorted { ($0.createdAt ?? "") < ($1.createdAt ?? "") }
    }

    /// Alert types the app-wide banner may show (docs/SCREEN-TIME-UX.md §2).
    nonisolated static let bannerAlertTypes: Set<String> = ["revoked", "removed", "stale", "selection_changed"]
    /// Alerts older than this never reach the banner (the server also expires them).
    nonisolated static let alertMaxAge: TimeInterval = 7 * 24 * 3600

    /// Alerts the parent dismissed on this device; hidden right away while the ack is sent.
    /// A failed ack's alert comes back on the next successful `loadOverview()`.
    var hiddenAlertIds: Set<String> = []

    /// What the banner may show, newest first: unacked, a bannerable type, younger than
    /// 7 days, not dismissed here, and only for kids whose Screen Time is on.
    var bannerAlerts: [ScreenTimeAlert] {
        let cutoff = Date().addingTimeInterval(-Self.alertMaxAge)
        let alerts = (overview?.kids ?? []).filter(\.policy.enabled).flatMap(\.alerts).filter { alert in
            guard alert.ackedAt == nil, Self.bannerAlertTypes.contains(alert.type),
                  !hiddenAlertIds.contains(alert.id),
                  let at = ScreenTimeSchedule.date(fromISO: alert.at) else { return false }
            return at > cutoff
        }
        return alerts.sorted {
            (ScreenTimeSchedule.date(fromISO: $0.at) ?? .distantPast) > (ScreenTimeSchedule.date(fromISO: $1.at) ?? .distantPast)
        }
    }

    @ObservationIgnored private let enforcer = ScreenTimeEnforcer.shared
    @ObservationIgnored private let api = APIClient.shared
    @ObservationIgnored private var syncTask: Task<Void, Never>?
    @ObservationIgnored private var pendingSource: String?
    @ObservationIgnored private var observers: [AnyCancellable] = []
    /// Per-alert acks still in flight (their alerts stay hidden across an overview reload).
    @ObservationIgnored private var ackingAlertIds: Set<String> = []

    private init() {
        authState = ScreenTimeEnforcer.currentAuthState
        mode = enforcer.mode
        isEnrolled = enforcer.isEnrolled
        policy = enforcer.storedPolicy
        agreement = enforcer.storedAgreement
        pendingAgreement = enforcer.pendingAgreement
        requests = Self.newestFirst(enforcer.storedRequests)
        hasUsageSelection = enforcer.usageSelection != nil
    }

    // MARK: Kid — authorization + enrollment

    /// `.family` → Apple's `.child` authorization (a parent approves on this device);
    /// `.cooperative` → `.individual` (the device owner approves).
    func requestAuthorization(_ mode: ScreenTimeMode) async throws {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: mode == .family ? .child : .individual)
            self.mode = mode
            enforcer.mode = mode
            authState = ScreenTimeEnforcer.currentAuthState
            lastError = nil
        } catch {
            authState = ScreenTimeEnforcer.currentAuthState
            let message = Self.message(for: error, mode: mode)
            lastError = message
            throw ScreenTimeServiceError.message(message)
        }
    }

    /// Registers this device with the server using the kid's cookie session.
    func enroll() async throws {
        authState = ScreenTimeEnforcer.currentAuthState
        guard authState == .approved, let mode else {
            throw ScreenTimeServiceError.message("Turn on Screen Time access first.")
        }
        let label = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        do {
            let r = try await api.enrollScreenTimeDevice(label: label, mode: mode, authStatus: authState, pushToken: enforcer.pushToken)
            enforcer.baseURL = Config.baseURL.absoluteString
            enforcer.saveCredentials(deviceId: r.deviceId, deviceSecret: r.deviceSecret)
            enforcer.apply(r.policy)
            enforcer.storedAgreement = r.agreement
            isEnrolled = true
            policy = r.policy
            agreement = r.agreement
            lastSyncAt = Date()
            lastError = nil
            Self.scheduleRefresh()
        } catch {
            lastError = error.localizedDescription
            throw error
        }
    }

    // MARK: Kid — sync

    /// Heartbeat + apply. Concurrent calls coalesce: callers during an in-flight
    /// sync wait for it, and one follow-up run reports any status that changed meanwhile.
    func sync(source: String) async {
        if let running = syncTask {
            pendingSource = source
            await running.value
            return
        }
        let task = Task { [weak self] in
            var next: String? = source
            while let src = next, let self {
                await self.performSync(source: src)
                next = self.pendingSource
                self.pendingSource = nil
            }
        }
        syncTask = task
        await task.value
        syncTask = nil
    }

    private func performSync(source: String) async {
        authState = ScreenTimeEnforcer.currentAuthState
        mode = enforcer.mode
        guard enforcer.isEnrolled else {
            isEnrolled = false
            // The extension saw a 401 (device forgotten): stop leftover schedules.
            if !DeviceActivityCenter().activities.isEmpty || enforcer.storedPolicy != nil {
                enforcer.reset()
            }
            // Not set up yet: show the kid the parents' rules so the Today card can
            // offer "Set it up". Display only — nothing is enforced until enroll().
            if let mine = try? await api.myScreenTime() {
                policy = mine.policy
                agreement = mine.agreement
                if let r = mine.requests { requests = Self.newestFirst(r) }
            } else {
                policy = nil
            }
            return
        }
        isEnrolled = true
        enforcer.baseURL = Config.baseURL.absoluteString
        do {
            let p = try await enforcer.heartbeat(source: source)
            if authState == .approved { enforcer.apply(p) }
            policy = p
            agreement = enforcer.storedAgreement
            requests = Self.newestFirst(enforcer.storedRequests)
            lastSyncAt = Date()
            lastError = nil
            if let pending = pendingAgreement { try? await saveAgreement(pending) }
        } catch ScreenTimeDeviceError.unenrolled {
            enforcer.reset()
            isEnrolled = false
            policy = nil
            agreement = nil
            lastError = ScreenTimeDeviceError.unenrolled.localizedDescription
        } catch {
            // Offline: still enforce what we have (e.g. a policy the extension stored, pause expiry).
            if authState == .approved, let stored = enforcer.storedPolicy {
                enforcer.apply(stored)
                policy = stored
            }
            lastError = error.localizedDescription
        }
    }

    /// Kid sessions, once at launch: Apple status observer (revocation while the app
    /// runs), foreground sync, and the BGAppRefresh schedule.
    func startObserving() {
        guard observers.isEmpty else { return }
        AuthorizationCenter.shared.$authorizationStatus
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in Task { await self?.sync(source: "observer") } }
            .store(in: &observers)
        NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)
            .sink { [weak self] _ in Task { await self?.sync(source: "foreground") } }
            .store(in: &observers)
        Self.scheduleRefresh()
    }

    // MARK: Kid — app selection on this device

    func selection(for limit: ScreenTimeLimit) -> FamilyActivitySelection {
        ScreenTimeEnforcer.decodeSelection(limit.selection) ?? FamilyActivitySelection()
    }

    func saveDeviceSelection(limitId: String, selection: FamilyActivitySelection) async throws {
        guard let blob = Self.encode(selection) else {
            throw ScreenTimeServiceError.message("Couldn't save those apps. Try again.")
        }
        let p = try await enforcer.uploadSelection(limitId: limitId, selection: blob, summary: Self.summary(of: selection))
        if authState == .approved { enforcer.apply(p) }
        policy = p
    }

    /// The setup's "All Apps & Categories" pick: kept on this device for usage
    /// milestones, and uploaded as this device's `total` selection when there's a daily limit.
    func saveAllAppsSelection(_ selection: FamilyActivitySelection) async throws {
        guard let blob = Self.encode(selection) else {
            throw ScreenTimeServiceError.message("Couldn't save those apps. Try again.")
        }
        enforcer.usageSelection = blob
        hasUsageSelection = true
        if policy?.limits.contains(where: \.isTotal) == true {
            try await saveDeviceSelection(limitId: "total", selection: selection)   // applies
        } else if authState == .approved, let p = enforcer.storedPolicy {
            enforcer.apply(p)
        }
    }

    // MARK: Kid — our Screen Time deal

    /// Saves the signed deal (FamDevice PUT). The draft is kept on this device first,
    /// so a failed save never loses what the family signed; `sync` retries it.
    func saveAgreement(_ deal: ScreenTimeAgreement) async throws {
        pendingAgreement = deal
        enforcer.pendingAgreement = deal
        do {
            agreement = try await enforcer.uploadAgreement(deal)
            pendingAgreement = nil
            enforcer.pendingAgreement = nil
        } catch {
            lastError = error.localizedDescription
            throw error
        }
    }

    // MARK: Kid — more time for fams

    func loadFamsBalance(kidId: String?) async {
        guard let kidId else { return }
        if let wallet = try? await api.famsWallet(kidId: kidId) { famsBalance = wallet.balance }
    }

    /// Asks the grown-ups for `minutes` more today (dated with this device's local day).
    func requestMoreTime(minutes: Int, note: String?) async throws {
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        let r = try await api.requestScreenTime(minutes: minutes,
                                                date: ScreenTimeSchedule.dayString(Date()),
                                                note: trimmed?.isEmpty == false ? String(trimmed!.prefix(80)) : nil)
        requests = [r] + requests.filter { $0.id != r.id }
        await sync(source: "app")
    }

    private static func newestFirst(_ list: [ScreenTimeRequest]?) -> [ScreenTimeRequest] {
        (list ?? []).sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
    }

    // MARK: Background refresh

    /// Must run before launch completes (AppDelegate.didFinishLaunching).
    nonisolated static func registerBackgroundTask() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshTaskId, using: nil) { task in
            let work = Task { @MainActor in
                let service = ScreenTimeService.shared
                await service.sync(source: "background")
                if service.isEnrolled { scheduleRefresh() }
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    nonisolated static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 3600)
        do { try BGTaskScheduler.shared.submit(request) }
        catch { print("[screentime] refresh not scheduled: \(error.localizedDescription)") }
    }

    // MARK: Parent

    func loadOverview() async {
        do {
            overview = try await api.screenTimeOverview()
            // Dismissed alerts whose ack failed reappear now; in-flight ones stay hidden.
            hiddenAlertIds.formIntersection(ackingAlertIds)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func state(for kidId: String) -> ScreenTimeKidState? {
        overview?.kids.first { $0.kidId == kidId }
    }

    func savePolicy(kidId: String, enabled: Bool, limits: [ScreenTimeLimit], downtime: [ScreenTimeDowntime]) async throws {
        merge(try await api.saveScreenTimePolicy(kidId: kidId, enabled: enabled, limits: limits, downtime: downtime))
    }

    func pause(kidId: String, minutes: Int) async throws {
        merge(try await api.pauseScreenTime(kidId: kidId, minutes: minutes))
    }

    func approveRequest(kidId: String, requestId: String) async throws {
        merge(try await api.decideScreenTimeRequest(kidId: kidId, requestId: requestId, approve: true))
    }

    func declineRequest(kidId: String, requestId: String) async throws {
        merge(try await api.decideScreenTimeRequest(kidId: kidId, requestId: requestId, approve: false))
    }

    func ackAlerts(kidId: String) async {
        do { merge(try await api.ackScreenTimeAlerts(kidId: kidId)) }
        catch { lastError = error.localizedDescription }
    }

    /// Dismisses one alert: hidden immediately, then acked on the server
    /// (`POST /api/screen-time/kids/:kidId/alerts/:alertId/ack`).
    func ackAlert(kidId: String, alertId: String) async {
        hiddenAlertIds.insert(alertId)
        ackingAlertIds.insert(alertId)
        defer { ackingAlertIds.remove(alertId) }
        do { merge(try await api.ackScreenTimeAlert(kidId: kidId, alertId: alertId)) }
        catch { lastError = error.localizedDescription }
    }

    func forgetDevice(kidId: String, deviceId: String) async throws {
        merge(try await api.forgetScreenTimeDevice(kidId: kidId, deviceId: deviceId))
    }

    /// Moves a device to another kid; it follows that kid's Screen Time rules from its
    /// next check-in. The server returns the source kid's (`kidId`) updated state.
    func moveDevice(kidId: String, deviceId: String, toKidId: String) async throws {
        merge(try await api.moveScreenTimeDevice(kidId: kidId, deviceId: deviceId, toKidId: toKidId))
        await loadOverview()   // the other kid now lists the device too
    }

    /// Coarse daily totals the kid's devices reported (newest date first).
    func usage(kidId: String, days: Int) async throws -> ScreenTimeUsage {
        try await api.screenTimeUsage(kidId: kidId, days: days)
    }

    private func merge(_ state: ScreenTimeKidState) {
        var o = overview ?? ScreenTimeOverview(kids: [])
        if let i = o.kids.firstIndex(where: { $0.kidId == state.kidId }) { o.kids[i] = state } else { o.kids.append(state) }
        overview = o
    }

    // MARK: Selection helpers

    nonisolated static func encode(_ selection: FamilyActivitySelection) -> String? {
        ScreenTimeEnforcer.encode(selection)
    }

    nonisolated static func summary(of selection: FamilyActivitySelection) -> SelectionSummary {
        ScreenTimeEnforcer.summary(of: selection)
    }

    // MARK: Errors

    private static func message(for error: Error, mode: ScreenTimeMode) -> String {
        guard let fc = error as? FamilyControlsError else {
            return "Screen Time couldn't be turned on. (\(error.localizedDescription))"
        }
        switch fc {
        case .invalidAccountType:
            return mode == .family
                ? "This Apple Account isn't a child in a Family Sharing group. You can set up Screen Time without Family Sharing instead."
                : "Screen Time can't be turned on for this Apple Account."
        case .authorizationCanceled:
            return "Setup was cancelled. Try again when you're ready."
        case .restricted:
            return "Screen Time is restricted on this device, for example by another management profile."
        case .unavailable:
            return "Screen Time isn't available on this device."
        case .authorizationConflict:
            return "Another app is already managing Screen Time on this device."
        case .networkError:
            return "Couldn't reach Apple. Check the connection and try again."
        case .authenticationMethodUnavailable:
            return "Set a device passcode first, then try again."
        case .invalidArgument:
            return "Screen Time couldn't be turned on. Please try again."
        @unknown default:
            return mode == .family
                ? "Family Sharing setup didn't work. You can set up Screen Time without Family Sharing instead."
                : "Screen Time couldn't be turned on. Please try again."
        }
    }
}
