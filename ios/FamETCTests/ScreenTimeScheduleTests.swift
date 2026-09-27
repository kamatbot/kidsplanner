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

    // MARK: More time for fams — bonus

    func testBonusTodayAddsToTotalOnTodaysWeekdayOnly() {
        let total = ScreenTimeLimit(id: "total", kind: "total", name: "Screen time", minutesPerDay: 120, weekendMinutes: 180)
        let today = date(day: 27, hour: 15) // Sunday
        let bonus = ScreenTimeBonus(date: "2026-09-27", minutes: 15)
        XCTAssertEqual(ScreenTimeSchedule.dayString(today, calendar: calendar), "2026-09-27")
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: total, weekday: 1, bonus: bonus, today: today, calendar: calendar), 195)
        // Other weekdays keep their normal threshold.
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: total, weekday: 2, bonus: bonus, today: today, calendar: calendar), 120)
        XCTAssertEqual(ScreenTimeSchedule.activeBonus(bonus, today: today, calendar: calendar), 15)
    }

    func testBonusFromYesterdayIsIgnored() {
        let total = ScreenTimeLimit(id: "total", kind: "total", name: "Screen time", minutesPerDay: 120, weekendMinutes: 180)
        let today = date(day: 28, hour: 9) // Monday
        let yesterday = ScreenTimeBonus(date: "2026-09-27", minutes: 60)
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: total, weekday: 2, bonus: yesterday, today: today, calendar: calendar), 120)
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: total, weekday: 1, bonus: yesterday, today: today, calendar: calendar), 180)
        XCTAssertNil(ScreenTimeSchedule.activeBonus(yesterday, today: today, calendar: calendar))
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: total, weekday: 2, bonus: nil, today: today, calendar: calendar), 120)
    }

    func testBonusNeverChangesAppLimits() {
        let games = ScreenTimeLimit(id: "games", kind: "apps", name: "Games", minutesPerDay: 60)
        let today = date(day: 27, hour: 15)
        let bonus = ScreenTimeBonus(date: "2026-09-27", minutes: 30)
        XCTAssertEqual(ScreenTimeSchedule.minutes(for: games, weekday: 1, bonus: bonus, today: today, calendar: calendar), 60)
    }

    func testRequestCostAndDecoding() throws {
        XCTAssertEqual(ScreenTimeRequest.choices.map(ScreenTimeRequest.cost(minutes:)), [5, 10, 15, 20])
        let json = #"""
        {"policy":{"version":4,"enabled":true,"limits":[],"downtime":[],"bonus":{"date":"2026-09-27","minutes":15}},
         "agreement":null,
         "requests":[{"id":"r1","kidId":"k1","minutes":15,"fams":5,"date":"2026-09-27","note":null,"status":"approved",
                      "createdAt":"2026-09-27T10:00:00.000Z","decidedAt":"2026-09-27T10:05:00.000Z","decidedBy":"p1"}]}
        """#
        let r = try JSONDecoder().decode(ScreenTimePolicyResponse.self, from: Data(json.utf8))
        XCTAssertEqual(r.policy.bonus, ScreenTimeBonus(date: "2026-09-27", minutes: 15))
        XCTAssertEqual(r.requests?.first?.status, "approved")
        // Older payloads without bonus/requests still decode.
        let old = try JSONDecoder().decode(ScreenTimePolicyResponse.self, from: Data(#"{"policy":{"version":1,"enabled":false,"limits":[],"downtime":[]}}"#.utf8))
        XCTAssertNil(old.policy.bonus)
        XCTAssertNil(old.requests)
    }

    // MARK: Usage milestones

    func testUsageMilestonesEvery15MinutesUpTo16Hours() {
        let m = ScreenTimeSchedule.usageMilestones
        XCTAssertEqual(m.first, 15)
        XCTAssertEqual(m.last, 960)
        XCTAssertEqual(m.count, 64)
        XCTAssertTrue(m.allSatisfy { $0 % 15 == 0 })
        XCTAssertEqual(ScreenTimeSchedule.usageEventName(45), "usage.45")
    }

    func testParseUsageEvent() {
        XCTAssertEqual(ScreenTimeSchedule.usageMinutes(fromEvent: "usage.15"), 15)
        XCTAssertEqual(ScreenTimeSchedule.usageMinutes(fromEvent: "usage.960"), 960)
        XCTAssertNil(ScreenTimeSchedule.usageMinutes(fromEvent: "usage.20"))
        XCTAssertNil(ScreenTimeSchedule.usageMinutes(fromEvent: "usage.0"))
        XCTAssertNil(ScreenTimeSchedule.usageMinutes(fromEvent: "usage.x"))
        XCTAssertNil(ScreenTimeSchedule.usageMinutes(fromEvent: "limit.total"))
    }

    func testMergeUsageKeepsMaxAndFirstLimitAndResetsOnNewDay() {
        var r = ScreenTimeSchedule.mergeUsage(nil, today: "2026-09-27", minutes: 30)
        XCTAssertEqual(r, ScreenTimeUsageRecord(date: "2026-09-27", minutes: 30, limitReachedAt: nil))
        r = ScreenTimeSchedule.mergeUsage(r, today: "2026-09-27", minutes: 15)   // burst out of order
        XCTAssertEqual(r.minutes, 30)
        r = ScreenTimeSchedule.mergeUsage(r, today: "2026-09-27", limitReachedAt: "A")
        r = ScreenTimeSchedule.mergeUsage(r, today: "2026-09-27", minutes: 120, limitReachedAt: "B")
        XCTAssertEqual(r.minutes, 120)
        XCTAssertEqual(r.limitReachedAt, "A")
        r = ScreenTimeSchedule.mergeUsage(r, today: "2026-09-28", minutes: 15)
        XCTAssertEqual(r, ScreenTimeUsageRecord(date: "2026-09-28", minutes: 15, limitReachedAt: nil))
    }

    func testTodayAllowanceUsesWeekendAndBonus() {
        let total = ScreenTimeLimit(id: "total", kind: "total", name: "Screen time", minutesPerDay: 120, weekendMinutes: 180)
        var p = ScreenTimePolicy(version: 1, enabled: true, updatedAt: nil, pauseUntil: nil, limits: [total], downtime: [])
        let sunday = date(day: 27, hour: 10), monday = date(day: 28, hour: 10)
        XCTAssertEqual(ScreenTimeSchedule.todayAllowance(p, now: sunday, calendar: calendar), 180)
        XCTAssertEqual(ScreenTimeSchedule.todayAllowance(p, now: monday, calendar: calendar), 120)
        p.bonus = ScreenTimeBonus(date: "2026-09-28", minutes: 30)
        XCTAssertEqual(ScreenTimeSchedule.todayAllowance(p, now: monday, calendar: calendar), 150)
        p.enabled = false
        XCTAssertNil(ScreenTimeSchedule.todayAllowance(p, now: monday, calendar: calendar))
        XCTAssertNil(ScreenTimeSchedule.todayAllowance(.disabled, now: monday, calendar: calendar))
    }

    func testUsageResponseDecodesNullMinutes() throws {
        let json = #"{"kidId":"k1","days":[{"date":"2026-09-27","minutes":null,"devices":[],"limitMinutes":null,"extraMinutes":0}],"requests":[]}"#
        let u = try JSONDecoder().decode(ScreenTimeUsage.self, from: Data(json.utf8))
        XCTAssertNil(u.days.first?.minutes)
        XCTAssertNil(u.days.first?.limitMinutes)
    }
}
