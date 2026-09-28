import Foundation

// Codable mirrors of the Screen Time JSON in docs/SCREEN-TIME-PLAN.md ("Server").
// Compiled into the app and the DeviceActivity monitor extension, so Foundation only.

enum ScreenTimeAuthState: String, Codable, Sendable {
    case notDetermined, denied, approved
}

enum ScreenTimeMode: String, Codable, Sendable {
    /// "With Family Sharing" — AuthorizationCenter `.child`.
    case family
    /// "Without Family Sharing" — AuthorizationCenter `.individual`.
    case cooperative
}

struct SelectionSummary: Codable, Hashable, Sendable {
    var apps: Int = 0
    var categories: Int = 0
    var webDomains: Int = 0

    var isEmpty: Bool { apps + categories + webDomains == 0 }
}

struct ScreenTimeLimit: Codable, Identifiable, Hashable, Sendable {
    /// Empty for a limit the parent is creating; the server assigns one.
    var id: String
    /// "total" (whole-device daily screen time, id is always "total") | "apps"; nil = apps.
    var kind: String?
    var name: String
    /// Monday–Friday minutes (every day when `weekendMinutes` is nil).
    var minutesPerDay: Int
    /// Saturday + Sunday minutes; nil = same as `minutesPerDay`.
    var weekendMinutes: Int?
    /// base64(JSON FamilyActivitySelection), opaque to the server.
    var selection: String?
    var selectionSummary: SelectionSummary?
    /// Parent projection only: per-device summaries keyed by device id.
    var deviceSelections: [String: SelectionSummary]?

    /// The whole-device daily screen time limit (id is always "total").
    var isTotal: Bool { id == "total" || kind == "total" }
}

struct ScreenTimeDowntime: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    /// "HH:mm"; `end < start` crosses midnight.
    var start: String
    var end: String
    /// `Calendar.weekday` numbering (1 = Sunday … 7 = Saturday); applies on the day it starts.
    var days: [Int]
}

struct ScreenTimePolicy: Codable, Hashable, Sendable {
    var version: Int
    var enabled: Bool
    var updatedAt: String?
    var pauseUntil: String?
    var limits: [ScreenTimeLimit]
    var downtime: [ScreenTimeDowntime]
    /// Extra `total` minutes a parent approved for one day ("More time for fams").
    var bonus: ScreenTimeBonus?

    /// App Group key the enforcer stores the device's policy under (read by the report extension).
    static let storageKey = "fam_st_policy"

    static let disabled = ScreenTimePolicy(version: 0, enabled: false, updatedAt: nil, pauseUntil: nil, limits: [], downtime: [])

    var pauseUntilDate: Date? { ScreenTimeSchedule.date(fromISO: pauseUntil) }
}

struct ScreenTimeDevice: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var label: String
    var mode: String
    /// approved | denied | notDetermined
    var authStatus: String
    var appliedVersion: Int?
    var lastSeenAt: String?
    var enrolledAt: String?
    /// ok | revoked | stale | removed
    var state: String
}

struct ScreenTimeAlert: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var kidId: String
    var deviceId: String?
    /// revoked | restored | stale | removed | selection_changed
    var type: String
    var message: String
    var at: String
    var ackedAt: String?
}

struct ScreenTimeKidState: Codable, Identifiable, Hashable, Sendable {
    var kidId: String
    var policy: ScreenTimePolicy
    var devices: [ScreenTimeDevice]
    var alerts: [ScreenTimeAlert]
    /// The kid's current signed deal (nil = none yet / older server).
    var agreement: ScreenTimeAgreement?
    /// The kid's last 10 "more time" requests (nil on older servers).
    var requests: [ScreenTimeRequest]?

    var id: String { kidId }
}

struct ScreenTimeOverview: Codable, Hashable, Sendable {
    var kids: [ScreenTimeKidState]
}

/// `{ policy, agreement }` — heartbeat, selection upload and `/mine` responses.
struct ScreenTimePolicyResponse: Codable, Sendable {
    var policy: ScreenTimePolicy
    var agreement: ScreenTimeAgreement?
    /// Heartbeat + `/mine` only: the kid's last 10 requests.
    var requests: [ScreenTimeRequest]?
    /// The kid this DEVICE belongs to (nil on older servers).
    var kidId: String?
    var kidName: String?
}

/// `POST /api/screen-time/device/enroll` response.
struct ScreenTimeEnrollResponse: Codable, Sendable {
    var deviceId: String
    var deviceSecret: String
    var policy: ScreenTimePolicy
    var agreement: ScreenTimeAgreement?
    /// The kid this DEVICE belongs to (nil on older servers).
    var kidId: String?
    var kidName: String?
}

// MARK: Our Screen Time Deal (docs/SCREEN-TIME-PLAN.md "Agreement JSON")

/// The Basic rules the deal was signed against. A field is nil when that rule is off.
struct ScreenTimeAgreementRules: Codable, Hashable, Sendable {
    var bedStart: String?
    var bedEnd: String?
    /// Minutes on school days (Mon–Fri).
    var school: Int?
    /// Minutes on Saturday + Sunday.
    var weekend: Int?

    /// Snapshot of the Basic rules (downtime `bedtime` + limit `total`); pause never counts.
    init(policy: ScreenTimePolicy) {
        let bed = policy.downtime.first { $0.id == "bedtime" }
        let total = policy.limits.first(where: \.isTotal)
        bedStart = bed?.start
        bedEnd = bed?.end
        school = total?.minutesPerDay
        weekend = total.map { $0.weekendMinutes ?? $0.minutesPerDay }
    }
}

struct ScreenTimeAgreement: Codable, Hashable, Sendable {
    var kidPromises: [String]
    var parentPromises: [String]
    var kidStamp: String
    var parentSigner: String
    var rules: ScreenTimeAgreementRules
    /// Server-stamped; nil on a draft not saved yet.
    var signedAt: String?
    var deviceId: String?

    /// The parent changed bedtime or daily time since this deal was signed.
    func isStale(for policy: ScreenTimePolicy) -> Bool {
        rules != ScreenTimeAgreementRules(policy: policy)
    }
}

/// `PUT /api/screen-time/device/agreement` response.
struct ScreenTimeAgreementResponse: Codable, Sendable {
    var agreement: ScreenTimeAgreement
}

// MARK: More time for fams (docs/SCREEN-TIME-PLAN.md "More time for fams")

/// Extra minutes on the `total` limit for one kid-device-local day ("YYYY-MM-DD").
struct ScreenTimeBonus: Codable, Hashable, Sendable {
    var date: String
    var minutes: Int
}

struct ScreenTimeRequest: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var kidId: String
    var minutes: Int
    var fams: Int
    /// Kid device's local "YYYY-MM-DD"; the request expires at the end of it.
    var date: String
    var note: String?
    /// pending | approved | declined | expired
    var status: String
    var createdAt: String?
    var decidedAt: String?
    var decidedBy: String?

    var isPending: Bool { status == "pending" }

    static let choices = [15, 30, 45, 60]
    /// 1 fam per 3 minutes (15 min = 5 fams).
    static func cost(minutes: Int) -> Int { minutes / 3 }
}

/// `POST /api/screen-time/requests` response.
struct ScreenTimeRequestResponse: Codable, Sendable {
    var request: ScreenTimeRequest
}

// MARK: Usage details (docs/SCREEN-TIME-PLAN.md "Usage details")

/// This device's coarse usage for one device-local day, from `usage.<m>` milestones.
/// Sent in the heartbeat as `usage`. Never records which apps.
struct ScreenTimeUsageRecord: Codable, Hashable, Sendable {
    /// Device-local "YYYY-MM-DD".
    var date: String
    /// 0–1440, a multiple of 15.
    var minutes: Int
    /// ISO time the whole-device daily limit was reached, nil if not (yet).
    var limitReachedAt: String?
}

/// One device's day in `GET /api/screen-time/kids/:kidId/usage`.
struct ScreenTimeUsageDevice: Codable, Hashable, Sendable {
    var deviceId: String
    var label: String?
    var minutes: Int?
    var limitReachedAt: String?
}

/// One date in the parent usage response (newest first).
struct ScreenTimeUsageDay: Codable, Hashable, Sendable {
    var date: String
    /// Sum over devices; nil when no device reported that day.
    var minutes: Int?
    var devices: [ScreenTimeUsageDevice]?
    /// That day's allowance incl. bonus; nil without a daily limit.
    var limitMinutes: Int?
    var extraMinutes: Int?
}

/// `GET /api/screen-time/kids/:kidId/usage?days=N` (parent only).
struct ScreenTimeUsage: Codable, Hashable, Sendable {
    var kidId: String
    var days: [ScreenTimeUsageDay]
    var requests: [ScreenTimeRequest]?
}
