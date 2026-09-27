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

    var id: String { kidId }
}

struct ScreenTimeOverview: Codable, Hashable, Sendable {
    var kids: [ScreenTimeKidState]
}

/// `{ policy }` — heartbeat, selection upload and `/mine` responses.
struct ScreenTimePolicyResponse: Codable, Sendable {
    var policy: ScreenTimePolicy
}

/// `POST /api/screen-time/device/enroll` response.
struct ScreenTimeEnrollResponse: Codable, Sendable {
    var deviceId: String
    var deviceSecret: String
    var policy: ScreenTimePolicy
}
