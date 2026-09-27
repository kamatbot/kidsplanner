import Foundation
import CryptoKit
import FamilyControls
import ManagedSettings
import DeviceActivity

extension ManagedSettingsStore.Name {
    static let downtime = Self("downtime")
    static let pause = Self("pause")
    static func limit(_ id: String) -> Self { Self("limit.\(id)") }
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
        static let policy = "fam_st_policy"
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

    var lastMonitorAt: Date? { defaults.object(forKey: Key.lastMonitorAt) as? Date }
    func recordMonitorFire(_ now: Date = Date()) { defaults.set(now, forKey: Key.lastMonitorAt) }

    /// Store name → human reason, read by the shield configuration extension.
    var shieldReasons: [String: String] { defaults.dictionary(forKey: Key.shieldReasons) as? [String: String] ?? [:] }
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
        guard let limit = storedPolicy?.limits.first(where: { $0.id == id }) else { return }
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
        let prefix = "limit."
        let shielded = shieldReasons.keys.filter { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
        let ids = Set((storedPolicy?.limits.map(\.id) ?? []) + shielded + extraIds)
        ids.forEach { clear(.limit($0)) }
    }

    func clearAllStores(extraLimitIds: [String] = []) {
        clearLimitStores(extraIds: extraLimitIds)
        clear(.downtime)
        clear(.pause)
    }

    /// Downtime window `id` started: shield all if it started on a listed day.
    func downtimeDidStart(id: String, now: Date = Date()) {
        guard let dt = storedPolicy?.downtime.first(where: { $0.id == id }) else { return }
        let weekday = Calendar.current.component(.weekday, from: now)
        if ScreenTimeSchedule.isScheduled(today: weekday, days: dt.days) {
            shieldAll(.downtime, reason: "Downtime")
        }
    }

    // MARK: Apply (app only — calls DeviceActivityCenter)

    /// Idempotently enforce `policy`: re-registers DeviceActivity schedules only when
    /// the limits/downtime changed, then reconciles the downtime and pause shields.
    func apply(_ policy: ScreenTimePolicy, now: Date = Date()) {
        let previousLimitIds = storedPolicy?.limits.map(\.id) ?? []
        storedPolicy = policy
        defer { defaults.set(policy.version, forKey: Key.appliedVersion) }
        let center = DeviceActivityCenter()

        guard policy.enabled else {
            center.stopMonitoring()
            clearAllStores(extraLimitIds: previousLimitIds)
            defaults.removeObject(forKey: Key.scheduleSignature)
            defaults.removeObject(forKey: Key.pauseSignature)
            return
        }

        let registered = Set(center.activities)
        // Today's bonus is part of the signature, so a new/raised bonus re-registers
        // today's day.N with the higher threshold and the limit stores (incl.
        // `limit.total`) are cleared right away; the next day it drops back out.
        // ponytail: if the app never applies again that day, day.N keeps the bonus
        // threshold for the same weekday next week (late, never early, shield);
        // apply from the monitor's day.N start if that ever matters.
        let signature = Self.scheduleSignature(policy, now: now)
        if signature != defaults.string(forKey: Key.scheduleSignature) || !registered.contains(.day(1)) {
            center.stopMonitoring(Array(registered.filter { $0 != .pause }))
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
        clearAllStores()
        clearCredentials()
        storedPolicy = nil
        storedAgreement = nil
        storedRequests = nil
        [Key.scheduleSignature, Key.pauseSignature, Key.appliedVersion, Key.mode].forEach(defaults.removeObject(forKey:))
    }

    private func register(_ policy: ScreenTimePolicy, center: DeviceActivityCenter, now: Date) {
        func start(_ name: DeviceActivityName, _ schedule: DeviceActivitySchedule,
                   events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]) {
            do { try center.startMonitoring(name, during: schedule, events: events) }
            catch { print("[screentime] \(name.rawValue) schedule failed: \(error.localizedDescription)") }
        }

        // DeviceActivity allows ~20 monitored activities per app. Budget:
        // day.1…7 (7) + heartbeat.0…3 (4) + downtime (≤ 4, capped below) + pause (1) = 16.
        let selections = policy.limits.compactMap { l -> (ScreenTimeLimit, FamilyActivitySelection)? in
            guard let sel = Self.decodeSelection(l.selection), !Self.isEmpty(sel) else { return nil }
            return (l, sel)
        }
        for weekday in 1...7 {
            var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
            for (limit, sel) in selections {
                let minutes = max(1, ScreenTimeSchedule.minutes(for: limit, weekday: weekday, bonus: policy.bonus, today: now))
                events[DeviceActivityEvent.Name("limit.\(limit.id)")] = DeviceActivityEvent(
                    applications: sel.applicationTokens,
                    categories: sel.categoryTokens,
                    webDomains: sel.webDomainTokens,
                    threshold: DateComponents(hour: minutes / 60, minute: minutes % 60),
                    includesPastActivity: true)
            }
            start(.day(weekday), DeviceActivitySchedule(intervalStart: DateComponents(hour: 0, minute: 0, weekday: weekday),
                                                        intervalEnd: DateComponents(hour: 23, minute: 59, weekday: weekday),
                                                        repeats: true), events: events)
        }

        for dt in policy.downtime.prefix(4) {
            guard let s = ScreenTimeSchedule.parseTime(dt.start), let e = ScreenTimeSchedule.parseTime(dt.end),
                  ScreenTimeSchedule.durationMinutes(start: s, end: e) >= 15, !dt.days.isEmpty else { continue }
            start(.downtime(dt.id), DeviceActivitySchedule(intervalStart: s, intervalEnd: e, repeats: true))
        }

        for (n, w) in ScreenTimeSchedule.heartbeatWindows().enumerated() {
            start(.heartbeat(n), DeviceActivitySchedule(intervalStart: w.start, intervalEnd: w.end, repeats: true))
        }
    }

    /// Stable hash of everything that shapes the DeviceActivity registration.
    private static func scheduleSignature(_ p: ScreenTimePolicy, now: Date) -> String {
        var text = ""
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

    /// Device request whose response is `{ policy, agreement }`: stores both (does not apply).
    private func policyRequest(_ path: String, method: String, body: [String: Any],
                               completion: @escaping (Result<ScreenTimePolicy, Error>) -> Void) {
        deviceRequest(path, method: method, body: body) { [weak self] (result: Result<ScreenTimePolicyResponse, Error>) in
            completion(result.map { r in
                self?.storedPolicy = r.policy
                self?.storedAgreement = r.agreement
                if let requests = r.requests { self?.storedRequests = requests }
                return r.policy
            })
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
