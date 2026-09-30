import Foundation
import CryptoKit
import FamilyControls
import ManagedSettings
import DeviceActivity
import Darwin

extension ManagedSettingsStore.Name {
    static let downtime = Self(ScreenTimeSchedule.downtimeStore)
    static let pause = Self(ScreenTimeSchedule.pauseStore)
    static func limit(_ id: String) -> Self { Self(ScreenTimeSchedule.limitStore(id)) }
}

extension DeviceActivityName {
    /// Weekly-repeating 00:00–23:59 on `Calendar.weekday` n (1 = Sunday … 7 = Saturday).
    static func day(_ n: Int) -> Self { Self("day.\(n)") }
    static let pause = Self("pause")
    static func downtime(_ id: String) -> Self { Self("downtime.\(id)") }
    static func heartbeat(_ n: Int) -> Self { Self("heartbeat.\(n)") }
}

enum ScreenTimeDeviceError: LocalizedError {
    case notEnrolled
    /// 401 — the parent forgot this device (or the secret is unknown).
    case unenrolled
    case http(Int, String?)
    case badResponse

    var errorDescription: String? {
        switch self {
        case .notEnrolled: return "This device isn't set up for Screen Time yet."
        case .unenrolled: return "A parent removed this device from Screen Time."
        case .http(_, let msg): return msg ?? "Screen Time couldn't reach Fam ETC."
        case .badResponse: return "Couldn't read the Screen Time response."
        }
    }
}

/// App Group storage + local enforcement for Screen Time. Shared by the app and
/// the DeviceActivity monitor extension — keep it small (the extension has a
/// ~6 MB memory cap): no SwiftUI, UIKit or app-only APIs.
final class ScreenTimeEnforcer: @unchecked Sendable {
    static let shared = ScreenTimeEnforcer()
    static let appGroup = "group.com.fametc.app.family-assistance"
    private final class StateLock: @unchecked Sendable {
        let process = NSRecursiveLock()
        var depth = 0
    }
    private static let stateLock = StateLock()

    /// The app and monitor can receive device responses at the same time. Check
    /// and persist the generation under one App Group lock, so a losing response
    /// cannot pass its guard just before the newer assignment is stored.
    private func withStateLock<T>(_ work: () -> T) -> T {
        let lock = Self.stateLock
        lock.process.lock()
        var descriptor: Int32 = -1
        if lock.depth == 0 {
            if let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) {
                descriptor = Darwin.open(container.appendingPathComponent("fam_st_state.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
                if descriptor >= 0 { _ = flock(descriptor, LOCK_EX) }
            }
            defaults.synchronize()
        }
        lock.depth += 1
        defer {
            defaults.synchronize()
            lock.depth -= 1
            if descriptor >= 0 { _ = flock(descriptor, LOCK_UN); Darwin.close(descriptor) }
            lock.process.unlock()
        }
        return work()
    }

    private enum Key {
        static let policy = ScreenTimePolicy.storageKey
        static let agreement = "fam_st_agreement"
        static let agreementDraft = "fam_st_agreementDraft"
        static let requests = "fam_st_requests"
        static let deviceId = "fam_st_deviceId"
        // ponytail: App Group defaults (file-protected container); move to a shared
        // keychain access group if the secret ever needs hardware-backed storage.
        static let deviceSecret = "fam_st_deviceSecret"
        static let mode = "fam_st_mode"
        static let baseURL = "fam_st_baseURL"
        static let pushToken = "fam_st_pushToken"
        static let appliedVersion = "fam_st_appliedVersion"
        static let health = "fam_st_health"
        static let assignmentGeneration = "fam_st_assignmentGeneration"
        static let assignmentResetAt = "fam_st_assignmentResetAt"
        static let usageRegistrationBase = "fam_st_usageRegistrationBase"
        static let lastMonitorAt = "fam_st_lastMonitorAt"
        /// The kid this DEVICE currently belongs to (server-confirmed via enroll/heartbeat).
        static let kidId = "fam_st_kidId"
        static let kidName = "fam_st_kidName"
        /// Legacy combined shield-reasons dict (migrated to per-store keys below, then removed).
        static let shieldReasons = "fam_st_shieldReasons"
        static let shieldReasonPrefix = "fam_st_shieldReason."
        static func shieldReason(_ store: String) -> String { shieldReasonPrefix + store }
        static let scheduleSignature = "fam_st_scheduleSignature"
        static let pauseSignature = "fam_st_pauseSignature"
        static let usageSelection = "fam_st_usageSelection"
        static let usageRecord = "fam_st_usageRecord"
        static let usageHeartbeatAt = "fam_st_usageHeartbeatAt"
        static let registeredAt = "fam_st_registeredAt"
        static let registeredTotalMinutes = "fam_st_registeredTotalMinutes"
        static func limitEventAt(_ id: String) -> String { "fam_st_limitEventAt.\(id)" }
    }

    let defaults: UserDefaults

    init(defaults: UserDefaults? = UserDefaults(suiteName: ScreenTimeEnforcer.appGroup)) {
        self.defaults = defaults ?? .standard
    }

    // MARK: Stored state

    var storedPolicy: ScreenTimePolicy? {
        get { defaults.data(forKey: Key.policy).flatMap { try? JSONDecoder().decode(ScreenTimePolicy.self, from: $0) } }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) { defaults.set(data, forKey: Key.policy) }
            else { defaults.removeObject(forKey: Key.policy) }
        }
    }

    /// The kid's current signed deal, as last reported by the server.
    var storedAgreement: ScreenTimeAgreement? {
        get { decode(Key.agreement) }
        set { encode(newValue, Key.agreement) }
    }

    /// The kid's last "more time" requests, as last reported by the server.
    var storedRequests: [ScreenTimeRequest]? {
        get { decode(Key.requests) }
        set { encode(newValue, Key.requests) }
    }

    /// A deal signed on this device that the server hasn't confirmed yet.
    var pendingAgreement: ScreenTimeAgreement? {
        get { decode(Key.agreementDraft) }
        set { encode(newValue, Key.agreementDraft) }
    }

    private func decode<T: Decodable>(_ key: String) -> T? {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }

    private func encode<T: Encodable>(_ value: T?, _ key: String) {
        if let value, let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
        else { defaults.removeObject(forKey: key) }
    }

    var deviceId: String? { defaults.string(forKey: Key.deviceId) }
    private var deviceSecret: String? { defaults.string(forKey: Key.deviceSecret) }
    var isEnrolled: Bool { deviceId != nil && deviceSecret != nil }

    func saveCredentials(deviceId: String, deviceSecret: String) {
        defaults.set(deviceId, forKey: Key.deviceId)
        defaults.set(deviceSecret, forKey: Key.deviceSecret)
    }

    func clearCredentials() {
        defaults.removeObject(forKey: Key.deviceId)
        defaults.removeObject(forKey: Key.deviceSecret)
    }

    var mode: ScreenTimeMode? {
        get { defaults.string(forKey: Key.mode).flatMap(ScreenTimeMode.init(rawValue:)) }
        set { defaults.set(newValue?.rawValue, forKey: Key.mode) }
    }

    /// Written by the app (Config.baseURL) so the extension can reach the server.
    var baseURL: String? {
        get { defaults.string(forKey: Key.baseURL) }
        set { defaults.set(newValue, forKey: Key.baseURL) }
    }

    /// Hex APNs token, written by AppDelegate on registration.
    var pushToken: String? {
        get { defaults.string(forKey: Key.pushToken) }
        set { defaults.set(newValue, forKey: Key.pushToken) }
    }

    var appliedVersion: Int { defaults.integer(forKey: Key.appliedVersion) }
    var deviceHealth: ScreenTimeDeviceHealth? {
        get { decode(Key.health) }
        set { encode(newValue, Key.health) }
    }
    var assignmentGeneration: Int { max(1, defaults.integer(forKey: Key.assignmentGeneration)) }

    /// Assignment-scoped evidence must never be credited to the next child.
    /// Credentials and enforced rules are device-owned and survive account sign-out.
    func resetAssignmentEvidence() {
        defaults.set(Date(), forKey: Key.assignmentResetAt)
        forgetLimitEvents()
        pendingAgreement = nil
        storedAgreement = nil
        storedRequests = nil
        usageSelection = nil
        [Key.usageRecord, Key.usageHeartbeatAt, Key.scheduleSignature, Key.pauseSignature,
         Key.registeredAt, Key.registeredTotalMinutes, Key.health, Key.appliedVersion].forEach(defaults.removeObject(forKey:))
        defaults.removeObject(forKey: Key.usageRegistrationBase)
    }

    @discardableResult
    func acceptAssignment(kidId: String?, kidName: String?, generation: Int?) -> Bool {
        withStateLock { acceptAssignmentUnlocked(kidId: kidId, kidName: kidName, generation: generation) }
    }

    private func acceptAssignmentUnlocked(kidId: String?, kidName: String?, generation: Int?) -> Bool {
        guard ScreenTimeSchedule.acceptsAssignment(incoming: generation, current: assignmentGeneration) else { return false }
        let next = generation ?? 1
        if next > assignmentGeneration || (storedKidId != nil && kidId != nil && kidId != storedKidId) {
            resetAssignmentEvidence()
            storedPolicy = nil
        }
        defaults.set(next, forKey: Key.assignmentGeneration)
        if let kidId { storedKidId = kidId }
        if let kidName { storedKidName = kidName }
        return true
    }

    @discardableResult
    func installEnrollment(_ response: ScreenTimeEnrollResponse) -> Bool {
        withStateLock {
            guard ScreenTimeSchedule.acceptsEnrollment(incomingGeneration: response.assignmentGeneration,
                                                        currentGeneration: assignmentGeneration,
                                                        incomingDeviceId: response.deviceId, currentDeviceId: deviceId) else { return false }
            if deviceId != response.deviceId {
                resetAssignmentEvidence()
                storedPolicy = nil
                storedKidId = nil
                storedKidName = nil
                defaults.removeObject(forKey: Key.assignmentGeneration)
            }
            guard acceptAssignment(kidId: response.kidId, kidName: response.kidName, generation: response.assignmentGeneration) else { return false }
            saveCredentials(deviceId: response.deviceId, deviceSecret: response.deviceSecret)
            storedAgreement = response.agreement
            apply(response.policy, kidId: response.kidId)
            return true
        }
    }

    /// The kid this DEVICE currently belongs to (server-confirmed): read for the kid-side
    /// "shared device" notice and to accept a moved device's policy unconditionally.
    var storedKidId: String? {
        get { defaults.string(forKey: Key.kidId) }
        set { defaults.set(newValue, forKey: Key.kidId) }
    }
    var storedKidName: String? {
        get { defaults.string(forKey: Key.kidName) }
        set { defaults.set(newValue, forKey: Key.kidName) }
    }

    // MARK: Usage (docs/SCREEN-TIME-PLAN.md "Usage details")

    /// Device-local "All Apps & Categories" pick (base64 selection), captured in setup so
    /// usage milestones work without a daily limit. Never uploaded.
    var usageSelection: String? {
        get { defaults.string(forKey: Key.usageSelection) }
        set { defaults.set(newValue, forKey: Key.usageSelection) }
    }

    /// The "everything" selection milestones count: this device's `total` selection,
    /// else the local usage selection.
    func everythingSelection(_ policy: ScreenTimePolicy?) -> FamilyActivitySelection? {
        if let total = policy?.limits.first(where: \.isTotal),
           let sel = Self.decodeSelection(total.selection), !Self.isEmpty(sel) { return sel }
        guard let sel = Self.decodeSelection(usageSelection), !Self.isEmpty(sel) else { return nil }
        return sel
    }

    /// Today's usage record (nil when nothing was counted today).
    func todayUsage(now: Date = Date()) -> ScreenTimeUsageRecord? {
        guard let r: ScreenTimeUsageRecord = decode(Key.usageRecord), r.date == ScreenTimeSchedule.dayString(now) else { return nil }
        return r
    }

    func recordUsage(minutes: Int? = nil, limitReached: Bool = false, now: Date = Date()) {
        withStateLock { recordUsageUnlocked(minutes: minutes, limitReached: limitReached, now: now) }
    }

    private func recordUsageUnlocked(minutes: Int?, limitReached: Bool, now: Date) {
        if minutes != nil, !canAcceptAssignmentEvent(now: now) { return }
        let context = ScreenTimeSchedule.registrationUsage(
            assignmentResetAt: defaults.object(forKey: Key.assignmentResetAt) as? Date, now: now,
            retained: decode(Key.usageRegistrationBase))
        let counted = minutes.map { ScreenTimeSchedule.countedMilestone(minutes: $0, baseMinutes: context.baseMinutes) }
        if let counted, !ScreenTimeSchedule.isPlausibleAssignmentUsage(
            minutes: counted, assignmentResetAt: defaults.object(forKey: Key.assignmentResetAt) as? Date, now: now) { return }
        let at = limitReached ? ISO8601DateFormatter().string(from: now) : nil
        encode(ScreenTimeSchedule.mergeUsage(decode(Key.usageRecord), today: ScreenTimeSchedule.dayString(now),
                                             minutes: counted, limitReachedAt: at), Key.usageRecord)
    }

    /// A move invalidates callbacks from registrations belonging to the previous
    /// child. Count only after the app has registered the new assignment.
    func canAcceptAssignmentEvent(now: Date = Date()) -> Bool {
        guard let reset = defaults.object(forKey: Key.assignmentResetAt) as? Date else { return true }
        guard let registeredAt, registeredAt >= reset else { return false }
        return !ScreenTimeSchedule.isRegistrationEcho(now: now, registeredAt: registeredAt)
    }

    /// Milestones can fire in a burst (re-registration with `includesPastActivity`):
    /// allow one usage heartbeat a minute.
    // ponytail: a burst reports its first milestone; the next milestone, quarter-day or app heartbeat catches up.
    func claimUsageHeartbeat(now: Date = Date()) -> Bool {
        if let last = defaults.object(forKey: Key.usageHeartbeatAt) as? Date, now.timeIntervalSince(last) < 60 { return false }
        defaults.set(now, forKey: Key.usageHeartbeatAt)
        return true
    }

    var lastMonitorAt: Date? { defaults.object(forKey: Key.lastMonitorAt) as? Date }
    func recordMonitorFire(_ now: Date = Date()) { defaults.set(now, forKey: Key.lastMonitorAt) }

    /// When the app last (re)registered the DeviceActivity schedules (registration-burst filter).
    var registeredAt: Date? { defaults.object(forKey: Key.registeredAt) as? Date }

    /// Weekday ("1"…"7") → the `limit.total` threshold minutes the app last registered.
    private var registeredTotalMinutes: [String: Int] {
        defaults.dictionary(forKey: Key.registeredTotalMinutes) as? [String: Int] ?? [:]
    }

    /// When `limit.<id>` last fired (only an event from today counts).
    func limitEventAt(_ id: String) -> Date? { defaults.object(forKey: Key.limitEventAt(id)) as? Date }
    func recordLimitEvent(_ id: String, now: Date = Date()) { defaults.set(now, forKey: Key.limitEventAt(id)) }

    /// Forgets recorded `limit.*` events (a new day, or thresholds re-registered).
    func forgetLimitEvents(extraIds: [String] = []) {
        let ids = Set((storedPolicy?.limits.map(\.id) ?? []) + extraIds).union(shieldedLimitIds)
        ids.forEach { defaults.removeObject(forKey: Key.limitEventAt($0)) }
    }

    /// Store name → human reason, read by the shield configuration extension. One key per
    /// store (`fam_st_shieldReason.<store>`) so a near-simultaneous write from the app and
    /// the monitor extension on different stores can't drop each other's update (unlike a
    /// single shared dict's read-modify-write) — docs/SCREEN-TIME-UX.md §5.
    var shieldReasons: [String: String] {
        migrateLegacyShieldReasonsIfNeeded()
        var result: [String: String] = [:]
        for (key, value) in defaults.dictionaryRepresentation() where key.hasPrefix(Key.shieldReasonPrefix) {
            guard let reason = value as? String else { continue }
            result[String(key.dropFirst(Key.shieldReasonPrefix.count))] = reason
        }
        return result
    }

    /// Limit ids whose `limit.<id>` store has a shield reason recorded.
    private var shieldedLimitIds: Set<String> {
        let prefix = "limit."
        return Set(shieldReasons.keys.filter { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) })
    }
    private func setReason(_ reason: String?, for store: String) {
        let key = Key.shieldReason(store)
        if let reason { defaults.set(reason, forKey: key) } else { defaults.removeObject(forKey: key) }
    }

    /// One-time: copies the old single shared dict into the new per-store keys, then
    /// removes it. Cheap no-op on every call after the first (the legacy key is gone).
    private func migrateLegacyShieldReasonsIfNeeded() {
        guard let legacy = defaults.dictionary(forKey: Key.shieldReasons) as? [String: String] else { return }
        for (store, reason) in legacy { defaults.set(reason, forKey: Key.shieldReason(store)) }
        defaults.removeObject(forKey: Key.shieldReasons)
    }

    static var currentAuthState: ScreenTimeAuthState {
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved, .approvedWithDataAccess: return .approved
        case .denied: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }

    // MARK: Selection encoding (base64(JSON FamilyActivitySelection))

    static func encode(_ selection: FamilyActivitySelection) -> String? {
        (try? JSONEncoder().encode(selection))?.base64EncodedString()
    }

    static func decodeSelection(_ base64: String?) -> FamilyActivitySelection? {
        guard let base64, let data = Data(base64Encoded: base64) else { return nil }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    static func summary(of s: FamilyActivitySelection) -> SelectionSummary {
        SelectionSummary(apps: s.applicationTokens.count, categories: s.categoryTokens.count, webDomains: s.webDomainTokens.count)
    }

    static func isEmpty(_ s: FamilyActivitySelection) -> Bool {
        s.applicationTokens.isEmpty && s.categoryTokens.isEmpty && s.webDomainTokens.isEmpty
    }

    // MARK: Shields (safe from the monitor extension)

    func shieldAll(_ name: ManagedSettingsStore.Name, reason: String) {
        let store = ManagedSettingsStore(named: name)
        // ManagedSettings combines stores restrictively: this exception affects
        // downtime only; daily limits and explicit pause still shield these apps.
        let exceptions = name == .downtime ? approvedEssentialApplications() : []
        store.shield.applications = nil
        store.shield.applicationCategories = .all(except: exceptions)
        store.shield.webDomainCategories = .all()
        setReason(reason, for: name.rawValue)
    }

    func approvedEssentialApplications() -> Set<ApplicationToken> {
        guard let selection = Self.decodeSelection(storedPolicy?.essentialApps?.selection),
              Self.isValidEssentialSelection(selection) else { return [] }
        return selection.applicationTokens
    }

    static func isValidEssentialSelection(_ selection: FamilyActivitySelection) -> Bool {
        (1...50).contains(selection.applicationTokens.count)
            && selection.categoryTokens.isEmpty && selection.webDomainTokens.isEmpty
    }

    func shieldLimit(id: String) {
        guard let policy = storedPolicy, policy.enabled,
              let limit = policy.limits.first(where: { $0.id == id }) else { return }
        if limit.isTotal {
            // Whole-device screen time: shield everything, not just the selection.
            shieldAll(.limit(id), reason: "Daily screen time is up")
            return
        }
        guard let sel = Self.decodeSelection(limit.selection), !Self.isEmpty(sel) else { return }
        let store = ManagedSettingsStore(named: .limit(id))
        store.shield.applications = sel.applicationTokens.isEmpty ? nil : sel.applicationTokens
        store.shield.applicationCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
        store.shield.webDomains = sel.webDomainTokens.isEmpty ? nil : sel.webDomainTokens
        store.shield.webDomainCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
        setReason("\(limit.name): daily limit reached", for: ManagedSettingsStore.Name.limit(id).rawValue)
    }

    func clear(_ name: ManagedSettingsStore.Name) {
        ManagedSettingsStore(named: name).clearAllSettings()
        setReason(nil, for: name.rawValue)
    }

    /// Clears every `limit.*` store we know of (stored policy + shielded reasons).
    func clearLimitStores(extraIds: [String] = []) {
        let ids = Set((storedPolicy?.limits.map(\.id) ?? []) + extraIds).union(shieldedLimitIds)
        ids.forEach { clear(.limit($0)) }
    }

    func clearAllStores(extraLimitIds: [String] = []) {
        clearLimitStores(extraIds: extraLimitIds)
        clear(.downtime)
        clear(.pause)
    }

    // MARK: Guards (docs/SCREEN-TIME-UX.md §5 — shield only when the stored policy says so now)

    /// Guards against a slower, older device response landing after a newer one and
    /// overwriting `storedPolicy` with stale data (the app and the monitor extension both
    /// heartbeat independently). True when there's nothing stored yet, `kidId` says the
    /// device was just moved to a different kid (their policy versions are unrelated, so
    /// always take the new kid's), or `incoming` is at least as new as what's stored —
    /// every parent change bumps the version, so an equal version (e.g. a selection
    /// upload's echo) is still accepted.
    func shouldAccept(_ incoming: ScreenTimePolicy, kidId: String?, generation: Int? = nil) -> Bool {
        guard ScreenTimeSchedule.acceptsAssignment(incoming: generation, current: assignmentGeneration) else { return false }
        if let generation, generation > assignmentGeneration { return true }
        guard let storedPolicy else { return true }
        if let kidId, kidId != storedKidId { return generation == nil && assignmentGeneration == 1 }
        return incoming.version >= storedPolicy.version
    }

    /// Removes every shield the stored policy doesn't justify right now; never adds one.
    /// Safe from the monitor extension. Runs after every device response, at every
    /// interval start/end and at the start of `apply`.
    func reconcileShields(now: Date = Date()) {
        let policy = storedPolicy
        let shielded = shieldedLimitIds
        let today = ScreenTimeSchedule.dayString(now)
        let stale = shielded.filter { id in limitEventAt(id).map { ScreenTimeSchedule.dayString($0) != today } ?? false }
        let stores = ScreenTimeSchedule.storesToClear(policy: policy, isEnrolled: isEnrolled, shieldedLimitIds: shielded,
                                                      todayMinutes: todayUsage(now: now)?.minutes ?? 0,
                                                      totalEventCounts: totalEventCounts(policy, now: now),
                                                      staleLimitIds: stale, now: now)
        stores.forEach { clear(ManagedSettingsStore.Name($0)) }
    }

    /// Does today's `limit.total` event (if any) count towards the decision?
    private func totalEventCounts(_ policy: ScreenTimePolicy?, now: Date) -> Bool {
        guard let total = policy?.limits.first(where: \.isTotal),
              let threshold = ScreenTimeSchedule.todayAllowance(policy, now: now) else { return false }
        let weekday = Calendar.current.component(.weekday, from: now)
        return ScreenTimeSchedule.totalEventCounts(eventAt: limitEventAt(total.id),
                                                   registeredMinutes: registeredTotalMinutes[String(weekday)],
                                                   threshold: threshold, now: now)
    }

    /// Shields `total` iff `ScreenTimeSchedule.totalShieldDecision` says today's usage reached
    /// the allowance. Returns true only the first time today (the caller heartbeats).
    @discardableResult
    func decideTotalShield(now: Date = Date()) -> Bool {
        guard isEnrolled, let policy = storedPolicy, policy.enabled,
              let total = policy.limits.first(where: \.isTotal),
              let threshold = ScreenTimeSchedule.todayAllowance(policy, now: now) else { return false }
        let usage = todayUsage(now: now)
        // Never trust more minutes than have passed since midnight (spurious milestones).
        guard ScreenTimeSchedule.isPlausibleUsage(minutes: usage?.minutes ?? 0, now: now),
              ScreenTimeSchedule.totalShieldDecision(recorded: usage?.minutes ?? 0, threshold: threshold,
                                                     limitEventSeenToday: totalEventCounts(policy, now: now)) else { return false }
        shieldLimit(id: total.id)
        guard usage?.limitReachedAt == nil else { return false }
        recordUsage(limitReached: true, now: now)
        return true
    }

    /// A `limit.<id>` event on today's `day.N`. `total` is decided from milestones; an apps
    /// limit shields unless it's the registration burst. Returns true when the daily screen
    /// time was first reached today (the caller heartbeats).
    func limitEventDidFire(id: String, now: Date = Date()) -> Bool {
        guard canAcceptAssignmentEvent(now: now) else { return false }
        guard isEnrolled, let policy = storedPolicy, policy.enabled,
              let limit = policy.limits.first(where: { $0.id == id }) else { return false }
        let threshold = ScreenTimeSchedule.minutes(for: limit, weekday: Calendar.current.component(.weekday, from: now),
                                                   bonus: policy.bonus, today: now)
        guard threshold > 0 else { return false }
        if limit.isTotal {
            recordLimitEvent(id, now: now)
            return decideTotalShield(now: now)
        }
        let recorded = todayUsage(now: now)?.minutes ?? 0
        guard !ScreenTimeSchedule.shouldIgnoreAppsLimitEvent(
            now: now, registeredAt: registeredAt,
            recordedMinutes: ScreenTimeSchedule.isPlausibleUsage(minutes: recorded, now: now) ? recorded : 0,
            threshold: threshold) else { return false }
        recordLimitEvent(id, now: now)
        shieldLimit(id: id)
        return false
    }

    /// Would downtime window `id` shield right now (enabled, inside the window that began
    /// on a listed day)?
    func downtimeShouldShield(id: String, now: Date = Date()) -> Bool {
        guard isEnrolled, let policy = storedPolicy, policy.enabled,
              let window = policy.downtime.first(where: { $0.id == id }) else { return false }
        return ScreenTimeSchedule.downtimeShouldShield(window, now: now)
    }

    /// Downtime window `id` started: shield all only if `downtimeShouldShield`.
    func downtimeDidStart(id: String, now: Date = Date()) {
        guard downtimeShouldShield(id: id, now: now) else { return }
        shieldAll(.downtime, reason: "Downtime")
    }

    /// Downtime window `id` ended: clear unless another window is still on.
    func downtimeDidEnd(id: String, now: Date = Date()) {
        guard ScreenTimeSchedule.activeDowntimeIds(storedPolicy, now: now).allSatisfy({ $0 == id }) else { return }
        clear(.downtime)
    }

    /// Would the pause shield right now (enabled and `pauseUntil` still ahead)?
    func pauseShouldShield(now: Date = Date()) -> Bool {
        guard isEnrolled, let policy = storedPolicy, policy.enabled else { return false }
        return ScreenTimeSchedule.pauseInterval(now: now, until: policy.pauseUntilDate) != nil
    }

    func pauseDidStart(now: Date = Date()) {
        guard pauseShouldShield(now: now) else { return }
        shieldAll(.pause, reason: "Paused by a parent")
    }

    // MARK: Apply (app only — calls DeviceActivityCenter)

    /// Idempotently enforce `policy`: re-registers DeviceActivity schedules only when
    /// the limits/downtime changed, then reconciles the downtime and pause shields.
    /// `kidId`, when known at the call site, lets `shouldAccept` recognize a device moved
    /// to another kid; omitting it just falls back to the version check.
    func apply(_ policy: ScreenTimePolicy, kidId: String? = nil, now: Date = Date()) {
        withStateLock { applyUnlocked(policy, kidId: kidId, now: now) }
    }

    private func applyUnlocked(_ policy: ScreenTimePolicy, kidId: String?, now: Date) {
        guard shouldAccept(policy, kidId: kidId, generation: assignmentGeneration) else { return }
        let previousLimitIds = storedPolicy?.limits.map(\.id) ?? []
        storedPolicy = policy
        let center = DeviceActivityCenter()
        var failures: [String] = []
        if Self.currentAuthState != .approved { failures.append("authorization_unavailable") }
        if let essential = policy.essentialApps?.selection,
           Self.decodeSelection(essential).map(Self.isValidEssentialSelection) != true { failures.append("invalid_essential_selection") }
        var expected = Set(ScreenTimeSchedule.heartbeatWindows().indices.map(DeviceActivityName.heartbeat))
        defer {
            let actual = Set(center.activities)
            if !expected.isSubset(of: actual) { failures.append("missing_activities") }
            if expected.contains(where: { center.schedule(for: $0) == nil }) { failures.append("missing_schedule") }
            if policy.enabled {
                let plan = registrationPlan(policy, now: now)
                failures += plan.failures
                if !plan.activities.allSatisfy({ center.schedule(for: $0.name) == $0.schedule && center.events(for: $0.name) == $0.events }) {
                    failures.append("registration_mismatch")
                    defaults.removeObject(forKey: Key.scheduleSignature)
                }
            }
            let missingSelection = policy.enabled && (everythingSelection(policy) == nil || policy.limits.contains {
                Self.decodeSelection($0.selection).map(Self.isEmpty) ?? true
            })
            let state = ScreenTimeSchedule.healthState(enabled: policy.enabled, failures: failures,
                                                       missingSelection: missingSelection, registered: actual.intersection(expected).count)
            deviceHealth = ScreenTimeDeviceHealth(policyVersion: policy.version, state: state,
                                                  registeredActivities: actual.intersection(expected).count,
                                                  expectedActivities: expected.count,
                                                  hasUsageSelection: everythingSelection(policy) != nil,
                                                  failures: Array(Set(failures)).sorted())
            if state == "applied" || state == "off" { defaults.set(policy.version, forKey: Key.appliedVersion) }
        }
        reconcileShields(now: now)
        let registered = Set(center.activities)

        guard policy.enabled else {
            // Off: stop everything except the heartbeats, so the device keeps checking in.
            // Never pass [] — stopMonitoring([]) stops every activity.
            let stop = registered.filter { !$0.rawValue.hasPrefix("heartbeat.") }
            if !stop.isEmpty { center.stopMonitoring(Array(stop)) }
            failures += registerHeartbeats(center: center, skipping: registered)
            forgetLimitEvents(extraIds: previousLimitIds)
            clearAllStores(extraLimitIds: previousLimitIds)
            defaults.removeObject(forKey: Key.scheduleSignature)
            defaults.removeObject(forKey: Key.pauseSignature)
            return
        }

        // Today's bonus is part of the signature, so a new/raised bonus re-registers
        // today's day.N with the higher threshold and the limit stores (incl.
        // `limit.total`) are cleared right away; the next day it drops back out.
        // If the app never applies again that day, day.N keeps the bonus threshold for
        // the same weekday next week, but `decideTotalShield` still shields on time from
        // the milestones against the stored policy's allowance.
        let signature = Self.scheduleSignature(policy, usage: usageSelection, now: now)
        expected.formUnion((1...7).map(DeviceActivityName.day))
        expected.formUnion(policy.downtime.prefix(4).map { .downtime($0.id) })
        if policy.downtime.count > 4 { failures.append("too_many_downtime_windows") }
        let desired = registrationPlan(policy, now: now)
        let schedulesPresent = desired.failures.isEmpty && desired.activities.allSatisfy {
            center.schedule(for: $0.name) == $0.schedule && center.events(for: $0.name) == $0.events
        }
        if signature != defaults.string(forKey: Key.scheduleSignature) || !schedulesPresent {
            let stop = registered.filter { $0 != .pause }
            if !stop.isEmpty { center.stopMonitoring(Array(stop)) }
            // Events recorded against the old thresholds no longer vouch for the new ones.
            forgetLimitEvents(extraIds: previousLimitIds)
            clearLimitStores(extraIds: previousLimitIds)
            failures += register(policy, center: center, now: now)
            if failures.isEmpty && expected.isSubset(of: Set(center.activities)) {
                defaults.set(signature, forKey: Key.scheduleSignature)
            } else { defaults.removeObject(forKey: Key.scheduleSignature) }
        }

        // Same leeway as the monitor's downtime start, so an early shield isn't cleared here.
        if policy.downtime.contains(where: { ScreenTimeSchedule.downtimeShouldShield($0, now: now) }) {
            shieldAll(.downtime, reason: "Downtime")
        } else {
            clear(.downtime)
        }

        if let interval = ScreenTimeSchedule.pauseInterval(now: now, until: policy.pauseUntilDate) {
            expected.insert(.pause)
            shieldAll(.pause, reason: "Paused by a parent")
            let pauseSig = Self.pauseSignature(pauseUntil: policy.pauseUntil)
            let cal = Calendar.current
            let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
            let schedule = DeviceActivitySchedule(intervalStart: cal.dateComponents(parts, from: interval.start),
                                                  intervalEnd: cal.dateComponents(parts, from: interval.end), repeats: false)
            if pauseSig != defaults.string(forKey: Key.pauseSignature)
                || center.schedule(for: .pause)?.intervalEnd != schedule.intervalEnd {
                center.stopMonitoring([.pause])
                do {
                    try center.startMonitoring(.pause, during: schedule)
                    defaults.set(pauseSig, forKey: Key.pauseSignature)
                } catch {
                    failures.append("pause_registration_failed")
                    defaults.removeObject(forKey: Key.pauseSignature)
                }
            }
        } else {
            clear(.pause)
            if registered.contains(.pause) { center.stopMonitoring([.pause]) }
            defaults.removeObject(forKey: Key.pauseSignature)
        }
        decideTotalShield(now: now)
    }

    /// Stops every schedule and removes all shields, credentials and the stored policy.
    func reset() {
        DeviceActivityCenter().stopMonitoring()
        forgetLimitEvents()
        clearAllStores()
        clearCredentials()
        resetAssignmentEvidence()
        storedPolicy = nil
        storedAgreement = nil
        storedRequests = nil
        [Key.scheduleSignature, Key.pauseSignature, Key.appliedVersion, Key.mode,
         Key.registeredAt, Key.registeredTotalMinutes, Key.kidId, Key.kidName, Key.assignmentGeneration,
         Key.assignmentResetAt].forEach(defaults.removeObject(forKey:))
    }

    /// Registers the quarter-day heartbeat activities that aren't in `registered`.
    private func registerHeartbeats(center: DeviceActivityCenter, skipping registered: Set<DeviceActivityName> = []) -> [String] {
        var failures: [String] = []
        for (n, w) in ScreenTimeSchedule.heartbeatWindows().enumerated() {
            let schedule = DeviceActivitySchedule(intervalStart: w.start, intervalEnd: w.end, repeats: true)
            if registered.contains(.heartbeat(n)), center.schedule(for: .heartbeat(n)) == schedule { continue }
            do {
                try center.startMonitoring(.heartbeat(n), during: schedule)
            } catch {
                failures.append("heartbeat_registration_failed")
            }
        }
        return failures
    }

    private typealias Registration = (name: DeviceActivityName, schedule: DeviceActivitySchedule,
                                     events: [DeviceActivityEvent.Name: DeviceActivityEvent])

    private func registrationPlan(_ policy: ScreenTimePolicy, now: Date) -> (activities: [Registration], failures: [String]) {
        var activities: [Registration] = []
        var failures: [String] = []
        func start(_ name: DeviceActivityName, _ schedule: DeviceActivitySchedule,
                   events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]) {
            activities.append((name, schedule, events))
        }

        // DeviceActivity allows ~20 monitored activities per app (usage milestones are
        // events, not activities). Budget:
        // day.1…7 (7) + heartbeat.0…3 (4) + downtime (≤ 4, capped below) + pause (1) = 16.
        // Stamped before registering: the includesPastActivity burst follows immediately.
        let everything = everythingSelection(policy)
        // Do not attribute the previous child's activity earlier in this device's
        // current interval to a newly assigned child.
        let usageContext = ScreenTimeSchedule.registrationUsage(
            assignmentResetAt: defaults.object(forKey: Key.assignmentResetAt) as? Date, now: now,
            retained: decode(Key.usageRegistrationBase))
        let selections = policy.limits.compactMap { l -> (ScreenTimeLimit, FamilyActivitySelection)? in
            guard let sel = Self.decodeSelection(l.selection), !Self.isEmpty(sel) else { return nil }
            return (l, sel)
        }
        for weekday in 1...7 {
            let assignmentDay = weekday == Calendar.current.component(.weekday, from: now) && !usageContext.includesPastActivity
            let includePast = !assignmentDay
            var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
            for (limit, sel) in selections {
                let minutes = max(1, ScreenTimeSchedule.minutes(for: limit, weekday: weekday, bonus: policy.bonus, today: now))
                events[DeviceActivityEvent.Name("limit.\(limit.id)")] = DeviceActivityEvent(
                    applications: sel.applicationTokens,
                    categories: sel.categoryTokens,
                    webDomains: sel.webDomainTokens,
                    threshold: DateComponents(hour: minutes / 60, minute: minutes % 60),
                    includesPastActivity: includePast)
            }
            // Coarse usage: one event per 15 minutes over "everything" (only events are
            // added, so the activity count is unchanged).
            if let everything {
                for m in ScreenTimeSchedule.usageMilestones {
                    events[DeviceActivityEvent.Name(ScreenTimeSchedule.usageEventName(m))] = DeviceActivityEvent(
                        applications: everything.applicationTokens,
                        categories: everything.categoryTokens,
                        webDomains: everything.webDomainTokens,
                        threshold: DateComponents(hour: m / 60, minute: m % 60),
                        includesPastActivity: includePast)
                }
            }
            start(.day(weekday), DeviceActivitySchedule(intervalStart: DateComponents(hour: 0, minute: 0, weekday: weekday),
                                                        intervalEnd: DateComponents(hour: 23, minute: 59, weekday: weekday),
                                                        repeats: true), events: events)
        }

        for dt in policy.downtime.prefix(4) {
            guard let s = ScreenTimeSchedule.parseTime(dt.start), let e = ScreenTimeSchedule.parseTime(dt.end),
                  ScreenTimeSchedule.durationMinutes(start: s, end: e) >= 15, !dt.days.isEmpty,
                  dt.days.allSatisfy({ (1...7).contains($0) }) else {
                failures.append("invalid_downtime_schedule"); continue
            }
            start(.downtime(dt.id), DeviceActivitySchedule(intervalStart: s, intervalEnd: e, repeats: true))
        }

        for (n, window) in ScreenTimeSchedule.heartbeatWindows().enumerated() {
            start(.heartbeat(n), DeviceActivitySchedule(intervalStart: window.start, intervalEnd: window.end, repeats: true))
        }
        return (activities, failures)
    }

    private func register(_ policy: ScreenTimePolicy, center: DeviceActivityCenter, now: Date) -> [String] {
        let context = ScreenTimeSchedule.registrationUsage(
            assignmentResetAt: defaults.object(forKey: Key.assignmentResetAt) as? Date, now: now, retained: todayUsage(now: now))
        encode(ScreenTimeUsageRecord(date: ScreenTimeSchedule.dayString(now), minutes: context.baseMinutes), Key.usageRegistrationBase)
        let plan = registrationPlan(policy, now: now)
        var failures = plan.failures
        defaults.set(now, forKey: Key.registeredAt)
        var totalMinutes: [String: Int] = [:]
        for activity in plan.activities {
            do { try center.startMonitoring(activity.name, during: activity.schedule, events: activity.events) }
            catch { failures.append("activity_registration_failed") }
            if let event = activity.events[DeviceActivityEvent.Name("limit.total")],
               let weekday = activity.schedule.intervalStart.weekday {
                totalMinutes[String(weekday)] = (event.threshold.hour ?? 0) * 60 + (event.threshold.minute ?? 0)
            }
        }
        defaults.set(totalMinutes, forKey: Key.registeredTotalMinutes)
        return failures
    }

    /// The value stored in `pauseSignature`. Includes the time zone identifier so a time
    /// zone change (travel, a DST database update) re-registers the one-shot pause
    /// schedule even though `pauseUntil` itself — built from local `DateComponents` —
    /// didn't change. Pure and internal so it's unit-testable without DeviceActivity.
    static func pauseSignature(pauseUntil: String?, timeZone: TimeZone = .current) -> String {
        "\(pauseUntil ?? "")|\(timeZone.identifier)"
    }

    /// Stable hash of everything that shapes the DeviceActivity registration.
    private static func scheduleSignature(_ p: ScreenTimePolicy, usage: String?, now: Date) -> String {
        var text = "TZ|\(TimeZone.current.identifier)\n"
        if let usage { text += "U|\(usage)\n" }
        if let extra = ScreenTimeSchedule.activeBonus(p.bonus, today: now) {
            text += "B|\(ScreenTimeSchedule.dayString(now))|\(extra)\n"
        }
        for l in p.limits { text += "L|\(l.id)|\(l.kind ?? "")|\(l.minutesPerDay)|\(l.weekendMinutes ?? -1)|\(l.selection ?? "")\n" }
        for d in p.downtime { text += "D|\(d.id)|\(d.start)|\(d.end)|\(d.days.map(String.init).joined(separator: ","))\n" }
        return SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Device HTTP (works from the extension; no cookies)

    /// Read-only verification for app and extension heartbeats. Never stamp a
    /// cached successful apply as fresh if the OS no longer has its schedules.
    /// An extension cannot verify a newer unapplied policy, so it omits health.
    private func validatedHeartbeatHealth(now: Date = Date()) -> ScreenTimeDeviceHealth? {
        guard let policy = storedPolicy, var health = deviceHealth, health.policyVersion == policy.version else { return nil }
        let center = DeviceActivityCenter()
        let plan = registrationPlan(policy, now: now)
        let activities = policy.enabled ? plan.activities : plan.activities.filter { $0.name.rawValue.hasPrefix("heartbeat.") }
        var expected = Set(activities.map(\.name))
        var failures = health.failures
        if policy.enabled { failures += plan.failures }
        if !activities.allSatisfy({ center.schedule(for: $0.name) == $0.schedule && center.events(for: $0.name) == $0.events }) {
            failures.append("registration_mismatch")
        }
        if policy.enabled, let interval = ScreenTimeSchedule.pauseInterval(now: now, until: policy.pauseUntilDate) {
            expected.insert(.pause)
            let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
            if center.schedule(for: .pause)?.intervalEnd != Calendar.current.dateComponents(parts, from: interval.end) {
                failures.append("pause_registration_mismatch")
            }
        }
        if Self.currentAuthState != .approved { failures.append("authorization_unavailable") }
        let registered = Set(center.activities).intersection(expected).count
        health.registeredActivities = registered
        health.expectedActivities = expected.count
        health.failures = Array(Set(failures)).sorted()
        if !health.failures.isEmpty {
            health.state = ScreenTimeSchedule.healthState(enabled: policy.enabled, failures: health.failures,
                                                         missingSelection: health.state == "needsSelection", registered: registered)
        }
        return health
    }

    /// POST /api/screen-time/device/heartbeat. Stores (does not apply) the returned policy.
    func heartbeat(source: String, completion: @escaping (Result<ScreenTimePolicy, Error>) -> Void) {
        withStateLock {
        var body: [String: Any] = [
            "authStatus": Self.currentAuthState.rawValue,
            "mode": mode?.rawValue ?? ScreenTimeMode.cooperative.rawValue,
            "appliedVersion": appliedVersion,
            "source": source,
            "assignmentGeneration": assignmentGeneration,
        ]
        if let health = validatedHeartbeatHealth(), let data = try? JSONEncoder().encode(health),
           let json = try? JSONSerialization.jsonObject(with: data) { body["health"] = json }
        if let pushToken { body["pushToken"] = pushToken }
        if let u = todayUsage() {
            body["usage"] = ["date": u.date, "minutes": u.minutes, "limitReachedAt": u.limitReachedAt ?? NSNull()] as [String: Any]
        }
        policyRequest("/api/screen-time/device/heartbeat", method: "POST", body: body, completion: completion)
        }
    }

    func heartbeat(source: String) async throws -> ScreenTimePolicy {
        try await withCheckedThrowingContinuation { c in heartbeat(source: source) { c.resume(with: $0) } }
    }

    /// PUT /api/screen-time/device/limits/:limitId/selection.
    func uploadSelection(limitId: String, selection: String, summary: SelectionSummary) async throws -> ScreenTimePolicy {
        let id = limitId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? limitId
        let body: [String: Any] = [
            "selection": selection,
            "summary": ["apps": summary.apps, "categories": summary.categories, "webDomains": summary.webDomains],
            "assignmentGeneration": assignmentGeneration,
        ]
        return try await withCheckedThrowingContinuation { c in
            policyRequest("/api/screen-time/device/limits/\(id)/selection", method: "PUT", body: body) { c.resume(with: $0) }
        }
    }

    func uploadEssentialApps(selection: String, summary: SelectionSummary, note: String?) async throws -> ScreenTimePolicy {
        var body: [String: Any] = ["selection": selection,
                                  "summary": ["apps": summary.apps, "categories": summary.categories, "webDomains": summary.webDomains],
                                  "assignmentGeneration": assignmentGeneration]
        if let note { body["note"] = note }
        return try await withCheckedThrowingContinuation { continuation in
            policyRequest("/api/screen-time/device/essential-apps", method: "PUT", body: body) { continuation.resume(with: $0) }
        }
    }

    /// PUT /api/screen-time/device/agreement. The server stamps `signedAt` + `deviceId`.
    func uploadAgreement(_ a: ScreenTimeAgreement) async throws -> ScreenTimeAgreement {
        let generation = assignmentGeneration
        let identity = deviceId
        let r = a.rules
        let body: [String: Any] = [
            "kidPromises": a.kidPromises,
            "parentPromises": a.parentPromises,
            "kidStamp": a.kidStamp,
            "parentSigner": a.parentSigner,
            "assignmentGeneration": generation,
            "rules": ["bedStart": r.bedStart ?? NSNull(), "bedEnd": r.bedEnd ?? NSNull(),
                      "school": r.school ?? NSNull(), "weekend": r.weekend ?? NSNull()] as [String: Any],
        ]
        let saved: ScreenTimeAgreementResponse = try await withCheckedThrowingContinuation { c in
            deviceRequest("/api/screen-time/device/agreement", method: "PUT", body: body) { c.resume(with: $0) }
        }
        let accepted = withStateLock {
            guard generation == assignmentGeneration, identity == deviceId else { return false }
            storedAgreement = saved.agreement
            return true
        }
        guard accepted else { throw CancellationError() }
        return saved.agreement
    }

    /// Device request whose response is `{ policy, agreement }`: stores both (does not apply)
    /// and removes any shield the new policy no longer justifies — so a parent's "turn off"
    /// clears the shields even from the extension or while authorization is revoked. Skips
    /// the store (and the reconcile) when `shouldAccept` says this reply is older than what's
    /// already stored — a slower heartbeat racing a newer one must never win.
    private func policyRequest(_ path: String, method: String, body: [String: Any],
                               completion: @escaping (Result<ScreenTimePolicy, Error>) -> Void) {
        let requestSecret = deviceSecret
        deviceRequest(path, method: method, body: body) { [weak self] (result: Result<ScreenTimePolicyResponse, Error>) in
            guard let self else { completion(.failure(CancellationError())); return }
            self.withStateLock {
            guard self.deviceSecret == requestSecret else { completion(.failure(CancellationError())); return }
            if case .success(let r) = result, self.shouldAccept(r.policy, kidId: r.kidId, generation: r.assignmentGeneration) {
                self.acceptAssignment(kidId: r.kidId, kidName: r.kidName, generation: r.assignmentGeneration)
                self.storedPolicy = r.policy
                if let agreement = r.agreement { self.storedAgreement = agreement }
                if let requests = r.requests { self.storedRequests = requests }
                if let kidId = r.kidId { self.storedKidId = kidId }
                if let kidName = r.kidName { self.storedKidName = kidName }
                self.reconcileShields()
                if self.shieldReasons[ScreenTimeSchedule.downtimeStore] != nil {
                    self.shieldAll(.downtime, reason: "Downtime")
                }
            }
            // Callers must apply only the accepted response; returning a losing
            // assignment's policy would bypass the guard in a second apply call.
            completion(result.map { [weak self] response in self?.storedPolicy ?? response.policy })
            }
        }
    }

    private func deviceRequest<T: Decodable>(_ path: String, method: String, body: [String: Any],
                                             completion: @escaping (Result<T, Error>) -> Void) {
        guard let secret = deviceSecret, let base = baseURL, let url = URL(string: base + path) else {
            completion(.failure(ScreenTimeDeviceError.notEnrolled)); return
        }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = method
        req.setValue("FamDevice \(secret)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("ios", forHTTPHeaderField: "X-FamETC-Client")
        // Same shared client key as Config.clientHeaders; the extension's Info.plist carries it too.
        if let key = (Bundle.main.object(forInfoDictionaryKey: "FAMIOSClientKey") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty {
            req.setValue(key, forHTTPHeaderField: "X-FamETC-Client-Key")
        }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        let session = URLSession(configuration: .ephemeral)
        defer { session.finishTasksAndInvalidate() }
        session.dataTask(with: req) { [weak self] data, resp, error in
            guard let self else { completion(.failure(CancellationError())); return }
            self.withStateLock {
            guard self.deviceSecret == secret else { completion(.failure(CancellationError())); return }
            if let error { completion(.failure(error)); return }
            guard let http = resp as? HTTPURLResponse, let data else { completion(.failure(ScreenTimeDeviceError.badResponse)); return }
            if http.statusCode == 401 {
                // Forgotten device: drop shields + credentials. The app stops the
                // DeviceActivity schedules on its next sync.
                self.clearAllStores()
                self.clearCredentials()
                self.storedPolicy = nil
                completion(.failure(ScreenTimeDeviceError.unenrolled)); return
            }
            guard (200..<300).contains(http.statusCode) else {
                let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                completion(.failure(ScreenTimeDeviceError.http(http.statusCode, msg))); return
            }
            guard let decoded = try? JSONDecoder().decode(T.self, from: data) else {
                completion(.failure(ScreenTimeDeviceError.badResponse)); return
            }
            completion(.success(decoded))
            }
        }.resume()
    }
}
