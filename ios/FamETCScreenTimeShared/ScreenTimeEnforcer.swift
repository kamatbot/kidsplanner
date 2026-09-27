import Foundation
import CryptoKit
import FamilyControls
import ManagedSettings
import DeviceActivity

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
        static let lastMonitorAt = "fam_st_lastMonitorAt"
        static let shieldReasons = "fam_st_shieldReasons"
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
        let at = limitReached ? ISO8601DateFormatter().string(from: now) : nil
        encode(ScreenTimeSchedule.mergeUsage(decode(Key.usageRecord), today: ScreenTimeSchedule.dayString(now),
                                             minutes: minutes, limitReachedAt: at), Key.usageRecord)
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

    /// Store name → human reason, read by the shield configuration extension.
    var shieldReasons: [String: String] { defaults.dictionary(forKey: Key.shieldReasons) as? [String: String] ?? [:] }

    /// Limit ids whose `limit.<id>` store has a shield reason recorded.
    private var shieldedLimitIds: Set<String> {
        let prefix = "limit."
        return Set(shieldReasons.keys.filter { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) })
    }
    private func setReason(_ reason: String?, for store: String) {
        var r = shieldReasons
        r[store] = reason
        defaults.set(r, forKey: Key.shieldReasons)
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

    private static func isEmpty(_ s: FamilyActivitySelection) -> Bool {
        s.applicationTokens.isEmpty && s.categoryTokens.isEmpty && s.webDomainTokens.isEmpty
    }

    // MARK: Shields (safe from the monitor extension)

    func shieldAll(_ name: ManagedSettingsStore.Name, reason: String) {
        let store = ManagedSettingsStore(named: name)
        store.shield.applicationCategories = .all()
        store.shield.webDomainCategories = .all()
        setReason(reason, for: name.rawValue)
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
    func apply(_ policy: ScreenTimePolicy, now: Date = Date()) {
        let previousLimitIds = storedPolicy?.limits.map(\.id) ?? []
        storedPolicy = policy
        defer { defaults.set(policy.version, forKey: Key.appliedVersion) }
        reconcileShields(now: now)
        let center = DeviceActivityCenter()
        let registered = Set(center.activities)

        guard policy.enabled else {
            // Off: stop everything except the heartbeats, so the device keeps checking in.
            // Never pass [] — stopMonitoring([]) stops every activity.
            let stop = registered.filter { !$0.rawValue.hasPrefix("heartbeat.") }
            if !stop.isEmpty { center.stopMonitoring(Array(stop)) }
            registerHeartbeats(center: center, skipping: registered)
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
        if signature != defaults.string(forKey: Key.scheduleSignature) || !registered.contains(.day(1)) {
            let stop = registered.filter { $0 != .pause }
            if !stop.isEmpty { center.stopMonitoring(Array(stop)) }
            // Events recorded against the old thresholds no longer vouch for the new ones.
            forgetLimitEvents(extraIds: previousLimitIds)
            clearLimitStores(extraIds: previousLimitIds)
            register(policy, center: center, now: now)
            defaults.set(signature, forKey: Key.scheduleSignature)
        }

        if policy.downtime.contains(where: { ScreenTimeSchedule.isInsideWindow(start: $0.start, end: $0.end, days: $0.days, now: now) }) {
            shieldAll(.downtime, reason: "Downtime")
        } else {
            clear(.downtime)
        }

        if let interval = ScreenTimeSchedule.pauseInterval(now: now, until: policy.pauseUntilDate) {
            shieldAll(.pause, reason: "Paused by a parent")
            let pauseSig = policy.pauseUntil ?? ""
            if pauseSig != defaults.string(forKey: Key.pauseSignature) || !registered.contains(.pause) {
                center.stopMonitoring([.pause])
                let cal = Calendar.current
                let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
                let schedule = DeviceActivitySchedule(intervalStart: cal.dateComponents(parts, from: interval.start),
                                                      intervalEnd: cal.dateComponents(parts, from: interval.end),
                                                      repeats: false)
                do {
                    try center.startMonitoring(.pause, during: schedule)
                    defaults.set(pauseSig, forKey: Key.pauseSignature)
                } catch {
                    print("[screentime] pause schedule failed: \(error.localizedDescription)")
                }
            }
        } else {
            clear(.pause)
            if registered.contains(.pause) { center.stopMonitoring([.pause]) }
            defaults.removeObject(forKey: Key.pauseSignature)
        }
    }

    /// Stops every schedule and removes all shields, credentials and the stored policy.
    func reset() {
        DeviceActivityCenter().stopMonitoring()
        forgetLimitEvents()
        clearAllStores()
        clearCredentials()
        storedPolicy = nil
        storedAgreement = nil
        storedRequests = nil
        [Key.scheduleSignature, Key.pauseSignature, Key.appliedVersion, Key.mode,
         Key.registeredAt, Key.registeredTotalMinutes].forEach(defaults.removeObject(forKey:))
    }

    /// Registers the quarter-day heartbeat activities that aren't in `registered`.
    private func registerHeartbeats(center: DeviceActivityCenter, skipping registered: Set<DeviceActivityName> = []) {
        for (n, w) in ScreenTimeSchedule.heartbeatWindows().enumerated() where !registered.contains(.heartbeat(n)) {
            do {
                try center.startMonitoring(.heartbeat(n), during: DeviceActivitySchedule(intervalStart: w.start,
                                                                                         intervalEnd: w.end, repeats: true))
            } catch {
                print("[screentime] heartbeat.\(n) schedule failed: \(error.localizedDescription)")
            }
        }
    }

    private func register(_ policy: ScreenTimePolicy, center: DeviceActivityCenter, now: Date) {
        func start(_ name: DeviceActivityName, _ schedule: DeviceActivitySchedule,
                   events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]) {
            do { try center.startMonitoring(name, during: schedule, events: events) }
            catch { print("[screentime] \(name.rawValue) schedule failed: \(error.localizedDescription)") }
        }

        // DeviceActivity allows ~20 monitored activities per app (usage milestones are
        // events, not activities). Budget:
        // day.1…7 (7) + heartbeat.0…3 (4) + downtime (≤ 4, capped below) + pause (1) = 16.
        // Stamped before registering: the includesPastActivity burst follows immediately.
        defaults.set(now, forKey: Key.registeredAt)
        let everything = everythingSelection(policy)
        let selections = policy.limits.compactMap { l -> (ScreenTimeLimit, FamilyActivitySelection)? in
            guard let sel = Self.decodeSelection(l.selection), !Self.isEmpty(sel) else { return nil }
            return (l, sel)
        }
        var totalMinutes: [String: Int] = [:]
        for weekday in 1...7 {
            var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
            for (limit, sel) in selections {
                let minutes = max(1, ScreenTimeSchedule.minutes(for: limit, weekday: weekday, bonus: policy.bonus, today: now))
                if limit.isTotal { totalMinutes[String(weekday)] = minutes }
                events[DeviceActivityEvent.Name("limit.\(limit.id)")] = DeviceActivityEvent(
                    applications: sel.applicationTokens,
                    categories: sel.categoryTokens,
                    webDomains: sel.webDomainTokens,
                    threshold: DateComponents(hour: minutes / 60, minute: minutes % 60),
                    includesPastActivity: true)
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
                        includesPastActivity: true)
                }
            }
            start(.day(weekday), DeviceActivitySchedule(intervalStart: DateComponents(hour: 0, minute: 0, weekday: weekday),
                                                        intervalEnd: DateComponents(hour: 23, minute: 59, weekday: weekday),
                                                        repeats: true), events: events)
        }
        defaults.set(totalMinutes, forKey: Key.registeredTotalMinutes)

        for dt in policy.downtime.prefix(4) {
            guard let s = ScreenTimeSchedule.parseTime(dt.start), let e = ScreenTimeSchedule.parseTime(dt.end),
                  ScreenTimeSchedule.durationMinutes(start: s, end: e) >= 15, !dt.days.isEmpty else { continue }
            start(.downtime(dt.id), DeviceActivitySchedule(intervalStart: s, intervalEnd: e, repeats: true))
        }

        registerHeartbeats(center: center)
    }

    /// Stable hash of everything that shapes the DeviceActivity registration.
    private static func scheduleSignature(_ p: ScreenTimePolicy, usage: String?, now: Date) -> String {
        var text = ""
        if let usage { text += "U|\(usage)\n" }
        if let extra = ScreenTimeSchedule.activeBonus(p.bonus, today: now) {
            text += "B|\(ScreenTimeSchedule.dayString(now))|\(extra)\n"
        }
        for l in p.limits { text += "L|\(l.id)|\(l.kind ?? "")|\(l.minutesPerDay)|\(l.weekendMinutes ?? -1)|\(l.selection ?? "")\n" }
        for d in p.downtime { text += "D|\(d.id)|\(d.start)|\(d.end)|\(d.days.map(String.init).joined(separator: ","))\n" }
        return SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Device HTTP (works from the extension; no cookies)

    /// POST /api/screen-time/device/heartbeat. Stores (does not apply) the returned policy.
    func heartbeat(source: String, completion: @escaping (Result<ScreenTimePolicy, Error>) -> Void) {
        var body: [String: Any] = [
            "authStatus": Self.currentAuthState.rawValue,
            "mode": mode?.rawValue ?? ScreenTimeMode.cooperative.rawValue,
            "appliedVersion": appliedVersion,
            "source": source,
        ]
        if let pushToken { body["pushToken"] = pushToken }
        if let u = todayUsage() {
            body["usage"] = ["date": u.date, "minutes": u.minutes, "limitReachedAt": u.limitReachedAt ?? NSNull()] as [String: Any]
        }
        policyRequest("/api/screen-time/device/heartbeat", method: "POST", body: body, completion: completion)
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
        ]
        return try await withCheckedThrowingContinuation { c in
            policyRequest("/api/screen-time/device/limits/\(id)/selection", method: "PUT", body: body) { c.resume(with: $0) }
        }
    }

    /// PUT /api/screen-time/device/agreement. The server stamps `signedAt` + `deviceId`.
    func uploadAgreement(_ a: ScreenTimeAgreement) async throws -> ScreenTimeAgreement {
        let r = a.rules
        let body: [String: Any] = [
            "kidPromises": a.kidPromises,
            "parentPromises": a.parentPromises,
            "kidStamp": a.kidStamp,
            "parentSigner": a.parentSigner,
            "rules": ["bedStart": r.bedStart ?? NSNull(), "bedEnd": r.bedEnd ?? NSNull(),
                      "school": r.school ?? NSNull(), "weekend": r.weekend ?? NSNull()] as [String: Any],
        ]
        let saved: ScreenTimeAgreementResponse = try await withCheckedThrowingContinuation { c in
            deviceRequest("/api/screen-time/device/agreement", method: "PUT", body: body) { c.resume(with: $0) }
        }
        storedAgreement = saved.agreement
        return saved.agreement
    }

    /// Device request whose response is `{ policy, agreement }`: stores both (does not apply)
    /// and removes any shield the new policy no longer justifies — so a parent's "turn off"
    /// clears the shields even from the extension or while authorization is revoked.
    private func policyRequest(_ path: String, method: String, body: [String: Any],
                               completion: @escaping (Result<ScreenTimePolicy, Error>) -> Void) {
        deviceRequest(path, method: method, body: body) { [weak self] (result: Result<ScreenTimePolicyResponse, Error>) in
            if case .success(let r) = result, let self {
                self.storedPolicy = r.policy
                self.storedAgreement = r.agreement
                if let requests = r.requests { self.storedRequests = requests }
                self.reconcileShields()
            }
            completion(result.map(\.policy))
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
            if let error { completion(.failure(error)); return }
            guard let http = resp as? HTTPURLResponse, let data else { completion(.failure(ScreenTimeDeviceError.badResponse)); return }
            if http.statusCode == 401 {
                // Forgotten device: drop shields + credentials. The app stops the
                // DeviceActivity schedules on its next sync.
                self?.clearAllStores()
                self?.clearCredentials()
                self?.storedPolicy = nil
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
        }.resume()
    }
}
