import XCTest
@testable import FamETC

/// Ghost-device status precedence and date formatting (docs/SCREEN-TIME-UX.md §1),
/// fixed by `ScreenTimeFormat.statusDevices` / `ScreenTimeFormat.moment`.
final class ScreenTimeParentStatusTests: XCTestCase {

    private func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: date)
    }

    private func device(id: String, state: String, daysAgo: Double) -> ScreenTimeDevice {
        let seen = Date().addingTimeInterval(-daysAgo * 24 * 3600)
        return ScreenTimeDevice(id: id, label: "iPhone", mode: ScreenTimeMode.cooperative.rawValue,
                                 authStatus: "approved", appliedVersion: 1, lastSeenAt: iso(seen),
                                 enrolledAt: iso(seen), state: state)
    }

    private func kidState(devices: [ScreenTimeDevice]) -> ScreenTimeKidState {
        let policy = ScreenTimePolicy(version: 1, enabled: true, updatedAt: nil, pauseUntil: nil, limits: [], downtime: [])
        return ScreenTimeKidState(kidId: "kid1", policy: policy, devices: devices, alerts: [])
    }

    // MARK: Ghost devices (item 1)

    func testGhostDeviceIgnoredWhenAnotherIsOkAndRecent() {
        let ok = device(id: "new", state: "ok", daysAgo: 0)
        let ghost = device(id: "old", state: "removed", daysAgo: 10)
        XCTAssertEqual(ScreenTimeKidStatus(state: kidState(devices: [ok, ghost])), .cooperative)
    }

    func testGhostDeviceKeptWhenItIsTheOnlyDevice() {
        let ghost = device(id: "old", state: "removed", daysAgo: 10)
        XCTAssertEqual(ScreenTimeKidStatus(state: kidState(devices: [ghost])), .mayBeRemoved)
    }

    func testRecentRevokedDeviceStillWinsOverOkDevice() {
        let ok = device(id: "new", state: "ok", daysAgo: 0)
        let revoked = device(id: "other", state: "revoked", daysAgo: 0)
        XCTAssertEqual(ScreenTimeKidStatus(state: kidState(devices: [ok, revoked])), .turnedOff(nil))
    }

    // MARK: ScreenTimeFormat.moment (item 2)

    /// Local noon `daysFromToday` days from now — far from a local midnight/DST edge.
    private func noon(_ daysFromToday: Int = 0) -> Date {
        let base = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date()) ?? Date()
        return Calendar.current.date(byAdding: .day, value: daysFromToday, to: base) ?? base
    }

    func testMomentSameDayUsesClockOnly() {
        let now = noon()
        let laterToday = now.addingTimeInterval(2 * 3600)
        XCTAssertEqual(ScreenTimeFormat.moment(laterToday, now: now), ScreenTimeFormat.clock(laterToday))
    }

    func testMomentThreeDaysEarlierContainsWeekday() {
        let now = noon()
        let past = noon(-3)
        XCTAssertTrue(ScreenTimeFormat.moment(past, now: now).contains(past.formatted(.dateTime.weekday(.abbreviated))))
    }

    func testMomentTwentyDaysEarlierContainsMonth() {
        let now = noon()
        let past = noon(-20)
        XCTAssertTrue(ScreenTimeFormat.moment(past, now: now).contains(past.formatted(.dateTime.month(.abbreviated))))
    }

    func testMomentYesterday() {
        let now = noon()
        XCTAssertTrue(ScreenTimeFormat.moment(noon(-1), now: now).hasPrefix("Yesterday"))
    }
}
