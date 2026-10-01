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
    /// The kid this DEVICE is currently assigned to, server-confirmed (nil until a sync
    /// has completed at least once). Used for the kid-side "shared device" notice.
    var enrolledKidId: String?
    var enrolledKidName: String?
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
    var deviceHealth: ScreenTimeDeviceHealth?
    /// Apple's opaque selection does not provide proof of whole-device coverage.
    var usageCoverage: String { hasUsageSelection ? "selected" : "unavailable" }

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
    nonisolated static let bannerAlertTypes: Set<String> = ["revoked", "removed", "stale", "check_needed", "selection_changed"]
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
    @ObservationIgnored private var accountKey: String?
    @ObservationIgnored private var accountKidId: String?
    @ObservationIgnored private var accountGeneration = 0

    private init() {
        authState = ScreenTimeEnforcer.currentAuthState
        mode = enforcer.mode
        isEnrolled = enforcer.isEnrolled
        policy = nil
        agreement = nil
        pendingAgreement = nil
        hasUsageSelection = enforcer.usageSelection != nil
        enrolledKidId = enforcer.storedKidId
        enrolledKidName = enforcer.storedKidName
        deviceHealth = nil
    }

    /// Clears account presentation and invalidates late responses. Local device
    /// enforcement is deliberately retained across sign-out and account switches.
    func accountChanged(user: User?, familyId: String?) {
        let key = user.map { "\($0.id)|\($0.role ?? "parent")|\($0.kidId ?? "")|\(familyId ?? "")" }
        guard key != accountKey else { return }
        accountKey = key
        accountKidId = user?.role == "kid" ? user?.kidId : nil
        accountGeneration &+= 1
        overview = nil
        hiddenAlertIds = []
        ackingAlertIds = []
        policy = nil
        agreement = nil
        pendingAgreement = nil
        requests = []
        famsBalance = nil
        lastError = nil
        lastSyncAt = nil
        deviceHealth = nil
        publishDeviceState()
    }

    private func publishDeviceState() {
        isEnrolled = enforcer.isEnrolled
        enrolledKidId = enforcer.storedKidId
        enrolledKidName = enforcer.storedKidName
        hasUsageSelection = enforcer.everythingSelection(enforcer.storedPolicy) != nil
        guard accountKidId != nil, accountKidId == enforcer.storedKidId else {
            policy = nil
            agreement = nil
            pendingAgreement = nil
            requests = []
            famsBalance = nil
            deviceHealth = nil
            return
        }
        policy = enforcer.storedPolicy
        agreement = enforcer.storedAgreement
        pendingAgreement = enforcer.pendingAgreement
        requests = Self.newestFirst(enforcer.storedRequests)
        deviceHealth = enforcer.deviceHealth
    }

    /// Apple's AuthorizationCenter loads `authorizationStatus` asynchronously: right after
    /// launch or a background wake it can briefly read `.notDetermined` before the real
    /// status arrives, which the server used to read as "turned off Screen Time". Waits
    /// out that moment instead of reporting it.
    static func settledAuthState(timeout: Duration = .seconds(3)) async -> ScreenTimeAuthState {
        let first = ScreenTimeEnforcer.currentAuthState
        guard first == .notDetermined else { return first }
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(200))
            let state = ScreenTimeEnforcer.currentAuthState
            if state != .notDetermined { return state }
        }
        return ScreenTimeEnforcer.currentAuthState
    }

    // MARK: Kid — authorization + enrollment

    /// `.family` → Apple's `.child` authorization (a parent approves on this device);
    /// `.cooperative` → `.individual` (the device owner approves).
    func requestAuthorization(_ mode: ScreenTimeMode) async throws {
        let generation = accountGeneration
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: mode == .family ? .child : .individual)
            guard generation == accountGeneration else { throw CancellationError() }
            self.mode = mode
            enforcer.mode = mode
            authState = ScreenTimeEnforcer.currentAuthState
            lastError = nil
        } catch {
            guard generation == accountGeneration else { throw CancellationError() }
            authState = ScreenTimeEnforcer.currentAuthState
            let message = Self.message(for: error, mode: mode)
            lastError = message
            throw ScreenTimeServiceError.message(message)
        }
    }

    /// Registers this device with the server using the kid's cookie session.
    func enroll() async throws {
        let generation = accountGeneration
        authState = await Self.settledAuthState()
        guard generation == accountGeneration else { throw CancellationError() }
        guard authState == .approved, let mode else {
            throw ScreenTimeServiceError.message("Turn on Screen Time access first.")
        }
        let label = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        do {
            let r = try await api.enrollScreenTimeDevice(label: label, mode: mode, authStatus: authState,
                                                          pushToken: enforcer.pushToken, installKey: ScreenTimeInstallKey.value())
            guard generation == accountGeneration else { throw CancellationError() }
            enforcer.baseURL = Config.baseURL.absoluteString
            guard enforcer.installEnrollment(r) else { throw CancellationError() }
            isEnrolled = true
            policy = r.policy
            agreement = r.agreement
            enrolledKidId = r.kidId
            enrolledKidName = r.kidName
            lastSyncAt = Date()
            lastError = nil
            publishDeviceState()
            Self.scheduleRefresh()
        } catch {
            guard generation == accountGeneration else { throw CancellationError() }
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
        let generation = accountGeneration
        // Only worth waiting out the momentary `.notDetermined` when there's a device
        // enrolled to report it — don't slow down the common not-set-up-yet path.
        authState = enforcer.isEnrolled ? await Self.settledAuthState() : ScreenTimeEnforcer.currentAuthState
        mode = enforcer.mode
        guard enforcer.isEnrolled else {
            isEnrolled = false
            enrolledKidId = nil
            enrolledKidName = nil
            // The extension saw a 401 (device forgotten): stop leftover schedules.
            if !DeviceActivityCenter().activities.isEmpty || enforcer.storedPolicy != nil {
                enforcer.reset()
            }
            // Not set up yet: show the kid the parents' rules so the Today card can
            // offer "Set it up". Display only — nothing is enforced until enroll().
            let mine = accountKidId != nil ? try? await api.myScreenTime() : nil
            guard generation == accountGeneration else { return }
            if let mine {
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
            // A parent check must report this attempt's evidence, not revive a
            // previously successful apply that would fail now.
            if authState == .approved, let stored = enforcer.storedPolicy { enforcer.apply(stored) }
            let sentHealth = enforcer.deviceHealth
            let sentVersion = enforcer.appliedVersion
            let p = try await enforcer.heartbeat(source: source)
            if authState == .approved { enforcer.apply(p) }
            if ScreenTimeSchedule.needsHealthAcknowledgement(previous: sentHealth, current: enforcer.deviceHealth,
                                                              previousVersion: sentVersion, currentVersion: enforcer.appliedVersion) {
                // One bounded acknowledgement. If this reply itself contains a
                // newer policy, apply it and report on the next normal sync.
                let latest = try await enforcer.heartbeat(source: source)
                if authState == .approved { enforcer.apply(latest) }
            }
            guard generation == accountGeneration else { return }
            // What's actually enforced: `storedPolicy` only changes when the enforcer's own
            // `shouldAccept` guard took this reply, so a stale/losing race never flashes
            // through here even though it's what the network just returned.
            policy = nil
            agreement = nil
            pendingAgreement = nil
            requests = []
            publishDeviceState()
            lastSyncAt = Date()
            lastError = nil
            if let pending = pendingAgreement { try? await saveAgreement(pending) }
        } catch ScreenTimeDeviceError.unenrolled {
            // A fresh enrollment may have completed while this failed request
            // resumed. An old 401 must never erase its new device credentials.
            if !enforcer.isEnrolled { enforcer.reset() }
            guard generation == accountGeneration else { return }
            if enforcer.isEnrolled { publishDeviceState(); return }
            isEnrolled = false
            policy = nil
            agreement = nil
            enrolledKidId = nil
            enrolledKidName = nil
            lastError = ScreenTimeDeviceError.unenrolled.localizedDescription
        } catch {
            // Offline: still enforce what we have (e.g. a policy the extension stored, pause expiry).
            if authState == .approved, let stored = enforcer.storedPolicy {
                enforcer.apply(stored)
            }
            guard generation == accountGeneration else { return }
            publishDeviceState()
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
        // A pause is registered from local DateComponents (docs/SCREEN-TIME-UX.md §5); a
        // time zone change alone (travel, a DST database update) needs a re-sync so it
        // re-registers even though `policy.pauseUntil` itself didn't change.
        NotificationCenter.default.publisher(for: Notification.Name.NSSystemTimeZoneDidChange)
            .sink { [weak self] _ in Task { await self?.sync(source: "foreground") } }
            .store(in: &observers)
        Self.scheduleRefresh()
    }

    // MARK: Kid — app selection on this device

    func selection(for limit: ScreenTimeLimit) -> FamilyActivitySelection {
        ScreenTimeEnforcer.decodeSelection(limit.selection) ?? FamilyActivitySelection()
    }

    func saveDeviceSelection(limitId: String, selection: FamilyActivitySelection) async throws {
        let generation = accountGeneration
        guard accountKidId == enforcer.storedKidId, accountKidId != nil else { throw CancellationError() }
        guard let blob = Self.encode(selection) else {
            throw ScreenTimeServiceError.message("Couldn't save those apps. Try again.")
        }
        let p = try await enforcer.uploadSelection(limitId: limitId, selection: blob, summary: Self.summary(of: selection))
        if authState == .approved { enforcer.apply(p) }
        guard generation == accountGeneration else { throw CancellationError() }
        publishDeviceState()
    }

    /// The setup's "All Apps & Categories" pick: kept on this device for usage
    /// milestones, and uploaded as this device's `total` selection when there's a daily limit.
    func saveAllAppsSelection(_ selection: FamilyActivitySelection) async throws {
        guard accountKidId == enforcer.storedKidId, accountKidId != nil,
              !ScreenTimeEnforcer.isEmpty(selection) else {
            throw ScreenTimeServiceError.message("Choose the apps or categories to measure on this device.")
        }
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
        publishDeviceState()
    }

    func proposeEssentialApps(selection: FamilyActivitySelection, note: String?) async throws {
        let generation = accountGeneration
        guard accountKidId == enforcer.storedKidId, accountKidId != nil else { throw CancellationError() }
        guard ScreenTimeEnforcer.isValidEssentialSelection(selection), let blob = Self.encode(selection) else {
            throw ScreenTimeServiceError.message("Choose 1–50 individual apps, without categories or websites.")
        }
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        _ = try await enforcer.uploadEssentialApps(selection: blob, summary: Self.summary(of: selection),
                                                   note: trimmed?.isEmpty == false ? String(trimmed!.prefix(80)) : nil)
        guard generation == accountGeneration else { throw CancellationError() }
        publishDeviceState()
    }

    func checkThisDevice() async {
        await sync(source: "app")
    }

    // MARK: Kid — our Screen Time deal

    /// Saves the signed deal (FamDevice PUT). The draft is kept on this device first,
    /// so a failed save never loses what the family signed; `sync` retries it.
    func saveAgreement(_ deal: ScreenTimeAgreement) async throws {
        let generation = accountGeneration
        let assignment = enforcer.assignmentGeneration
        guard accountKidId == enforcer.storedKidId, accountKidId != nil else { throw CancellationError() }
        pendingAgreement = deal
        enforcer.pendingAgreement = deal
        do {
            let saved = try await enforcer.uploadAgreement(deal)
            guard generation == accountGeneration, assignment == enforcer.assignmentGeneration else { throw CancellationError() }
            agreement = saved
            pendingAgreement = nil
            enforcer.pendingAgreement = nil
        } catch {
            guard generation == accountGeneration, assignment == enforcer.assignmentGeneration else { throw CancellationError() }
            lastError = error.localizedDescription
            throw error
        }
    }

    // MARK: Kid — more time for fams

    func loadFamsBalance(kidId: String?) async {
        let generation = accountGeneration
        guard let kidId else { return }
        if let wallet = try? await api.famsWallet(kidId: kidId), generation == accountGeneration { famsBalance = wallet.balance }
    }

    /// Asks the grown-ups for `minutes` more today (dated with this device's local day).
    func requestMoreTime(minutes: Int, note: String?) async throws {
        let generation = accountGeneration
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines)
        let r = try await api.requestScreenTime(minutes: minutes,
                                                date: ScreenTimeSchedule.dayString(Date()),
                                                note: trimmed?.isEmpty == false ? String(trimmed!.prefix(80)) : nil)
        guard generation == accountGeneration else { throw CancellationError() }
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
        let generation = accountGeneration
        do {
            let fresh = try await api.screenTimeOverview()
            guard generation == accountGeneration else { return }
            overview = fresh
            // Dismissed alerts whose ack failed reappear now; in-flight ones stay hidden.
            hiddenAlertIds.formIntersection(ackingAlertIds)
            lastError = nil
        } catch {
            guard generation == accountGeneration else { return }
            lastError = error.localizedDescription
        }
    }

    func state(for kidId: String) -> ScreenTimeKidState? {
        overview?.kids.first { $0.kidId == kidId }
    }

    private func parentMutation(_ work: () async throws -> ScreenTimeKidState) async throws {
        let generation = accountGeneration
        let result = try await work()
        guard generation == accountGeneration else { throw CancellationError() }
        merge(result)
    }

    func checkProtection(kidId: String) async throws {
        try await parentMutation { try await api.checkScreenTimeProtection(kidId: kidId) }
    }

    func approveEssentialApps(kidId: String, deviceId: String, requestId: String) async throws {
        try await parentMutation { try await api.decideScreenTimeEssentialApps(kidId: kidId, deviceId: deviceId, requestId: requestId, approve: true) }
    }

    func declineEssentialApps(kidId: String, deviceId: String, requestId: String) async throws {
        try await parentMutation { try await api.decideScreenTimeEssentialApps(kidId: kidId, deviceId: deviceId, requestId: requestId, approve: false) }
    }

    func removeEssentialApps(kidId: String, deviceId: String) async throws {
        try await parentMutation { try await api.removeScreenTimeEssentialApps(kidId: kidId, deviceId: deviceId) }
    }

    func savePolicy(kidId: String, enabled: Bool, limits: [ScreenTimeLimit], downtime: [ScreenTimeDowntime]) async throws {
        try await parentMutation { try await api.saveScreenTimePolicy(kidId: kidId, enabled: enabled, limits: limits, downtime: downtime) }
    }

    func pause(kidId: String, minutes: Int) async throws {
        try await parentMutation { try await api.pauseScreenTime(kidId: kidId, minutes: minutes) }
    }

    /// Adds `minutes` (15, 30 or 60) to today's daily limit for one kid.
    func grantBonus(kidId: String, minutes: Int) async throws {
        try await parentMutation { try await api.grantScreenTimeBonus(kidId: kidId, minutes: minutes) }
    }

    func approveRequest(kidId: String, requestId: String) async throws {
        try await parentMutation { try await api.decideScreenTimeRequest(kidId: kidId, requestId: requestId, approve: true) }
    }

    func declineRequest(kidId: String, requestId: String) async throws {
        try await parentMutation { try await api.decideScreenTimeRequest(kidId: kidId, requestId: requestId, approve: false) }
    }

    func ackAlerts(kidId: String) async {
        let generation = accountGeneration
        do { try await parentMutation { try await api.ackScreenTimeAlerts(kidId: kidId) } }
        catch { if generation == accountGeneration { lastError = error.localizedDescription } }
    }

    /// Dismisses one alert: hidden immediately, then acked on the server
    /// (`POST /api/screen-time/kids/:kidId/alerts/:alertId/ack`).
    func ackAlert(kidId: String, alertId: String) async {
        let generation = accountGeneration
        hiddenAlertIds.insert(alertId)
        ackingAlertIds.insert(alertId)
        defer { ackingAlertIds.remove(alertId) }
        do { try await parentMutation { try await api.ackScreenTimeAlert(kidId: kidId, alertId: alertId) } }
        catch { if generation == accountGeneration { lastError = error.localizedDescription } }
    }

    func forgetDevice(kidId: String, deviceId: String) async throws {
        try await parentMutation { try await api.forgetScreenTimeDevice(kidId: kidId, deviceId: deviceId) }
    }

    /// Moves a device to another kid; it follows that kid's Screen Time rules from its
    /// next check-in. The server returns the source kid's (`kidId`) updated state.
    func moveDevice(kidId: String, deviceId: String, toKidId: String) async throws {
        try await parentMutation { try await api.moveScreenTimeDevice(kidId: kidId, deviceId: deviceId, toKidId: toKidId) }
        await loadOverview()   // the other kid now lists the device too
    }

    /// Coarse daily totals the kid's devices reported (newest date first).
    func usage(kidId: String, days: Int) async throws -> ScreenTimeUsage {
        let generation = accountGeneration
        let result = try await api.screenTimeUsage(kidId: kidId, days: days)
        guard generation == accountGeneration else { throw CancellationError() }
        return result
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
        case .unauthorized:
            return "Screen Time access wasn't granted. Try the permission step again together."
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
