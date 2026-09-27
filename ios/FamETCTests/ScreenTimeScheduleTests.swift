import XCTest
@testable import FamETC

final class ScreenTimeScheduleTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    /// 2026-09-27 is a Sunday (weekday 1).
    private func date(day: Int, hour: Int, minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour, minute: minute))!
    }

    func testParseTimeAcceptsHHmmAndRejectsInvalid() {
        XCTAssertEqual(ScreenTimeSchedule.parseTime("21:00"), DateComponents(hour: 21, minute: 0))
        XCTAssertEqual(ScreenTimeSchedule.parseTime("07:05"), DateComponents(hour: 7, minute: 5))
        XCTAssertNil(ScreenTimeSchedule.parseTime("25:00"))
        XCTAssertNil(ScreenTimeSchedule.parseTime("12:60"))
        XCTAssertNil(ScreenTimeSchedule.parseTime("7:00"))
        XCTAssertNil(ScreenTimeSchedule.parseTime("bedtime"))
    }

    func testBedtimeCrossesMidnight() {
        let s = ScreenTimeSchedule.parseTime("21:00")!, e = ScreenTimeSchedule.parseTime("07:00")!
        XCTAssertTrue(ScreenTimeSchedule.crossesMidnight(start: s, end: e))
        XCTAssertEqual(ScreenTimeSchedule.durationMinutes(start: s, end: e), 600)
        XCTAssertFalse(ScreenTimeSchedule.crossesMidnight(start: e, end: s))
    }

    func testWeekdayMembershipAndWindowStartsOnListedDay() {
        XCTAssertTrue(ScreenTimeSchedule.isScheduled(today: 1, days: [1, 7]))
        XCTAssertFalse(ScreenTimeSchedule.isScheduled(today: 2, days: [1, 7]))

        // School nights only: Sun–Thu (1…5). Sunday 22:00 is inside.
        let schoolNights = [1, 2, 3, 4, 5]
        XCTAssertTrue(ScreenTimeSchedule.isInsideWindow(start: "21:00", end: "07:00", days: schoolNights, now: date(day: 27, hour: 22), calendar: calendar))
        // Monday 06:00 belongs to Sunday's window → inside.
        XCTAssertTrue(ScreenTimeSchedule.isInsideWindow(start: "21:00", end: "07:00", days: schoolNights, now: date(day: 28, hour: 6), calendar: calendar))
        // Sunday 06:00 belongs to Saturday's (unlisted) window → outside.
        XCTAssertFalse(ScreenTimeSchedule.isInsideWindow(start: "21:00", end: "07:00", days: schoolNights, now: date(day: 27, hour: 6), calendar: calendar))
        // Midday is outside.
        XCTAssertFalse(ScreenTimeSchedule.isInsideWindow(start: "21:00", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7], now: date(day: 27, hour: 12), calendar: calendar))
    }

    func testPauseIntervalClampsToFifteenMinutes() {
        let now = date(day: 27, hour: 12)
        let short = ScreenTimeSchedule.pauseInterval(now: now, until: now.addingTimeInterval(60))
        XCTAssertEqual(short?.duration, 15 * 60)
        let long = ScreenTimeSchedule.pauseInterval(now: now, until: now.addingTimeInterval(3600))
        XCTAssertEqual(long?.duration, 3600)
        XCTAssertNil(ScreenTimeSchedule.pauseInterval(now: now, until: now.addingTimeInterval(-1)))
        XCTAssertNil(ScreenTimeSchedule.pauseInterval(now: now, until: nil))
    }

    func testHeartbeatWindowsCoverTheDay() {
        let windows = ScreenTimeSchedule.heartbeatWindows()
        XCTAssertEqual(windows.count, 4)
        var expectedStart = 0
        for w in windows {
            XCTAssertEqual(ScreenTimeSchedule.minutes(w.start), expectedStart)
            XCTAssertGreaterThanOrEqual(ScreenTimeSchedule.durationMinutes(start: w.start, end: w.end), 15)
            expectedStart = ScreenTimeSchedule.minutes(w.end) + 1
        }
        XCTAssertEqual(expectedStart, 1440)
    }

    func testWeekendMinutes() {
        let limit = ScreenTimeLimit(id: "total", kind: "total", name: "Screen time", minutesPerDay: 120, weekendMinutes: 180)
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: limit, weekday: 1), 180) // Sunday
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: limit, weekday: 7), 180) // Saturday
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: limit, weekday: 4), 120)
        let same = ScreenTimeLimit(id: "l", name: "Games", minutesPerDay: 60)
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: same, weekday: 1), 60)
    }

    func testPolicyDecodesServerJSON() throws {
        let json = #"""
        {"version":3,"enabled":true,"updatedAt":"2026-09-27T10:00:00.000Z","pauseUntil":"2026-09-27T11:00:00.000Z",
         "limits":[{"id":"total","kind":"total","name":"Screen time","minutesPerDay":120,"weekendMinutes":null,"selection":null}],
         "downtime":[{"id":"bedtime","name":"Bedtime","start":"21:00","end":"07:00","days":[1,2,3,4,5,6,7]}]}
        """#
        let p = try JSONDecoder().decode(ScreenTimePolicy.self, from: Data(json.utf8))
        XCTAssertEqual(p.limits[0].kind, "total")
        XCTAssertNil(p.limits[0].weekendMinutes)
        XCTAssertNotNil(p.pauseUntilDate)
    }
}
