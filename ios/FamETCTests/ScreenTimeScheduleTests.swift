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

    // MARK: Enforcement guards (docs/SCREEN-TIME-UX.md §5)

    func testTotalShieldDecisionTable() {
        typealias Row = (recorded: Int, threshold: Int, event: Bool, shield: Bool)
        let rows: [Row] = [
            (0, 120, false, false),
            (0, 120, true, false),     // spurious limit.total with nothing recorded shields nothing
            (105, 120, false, false),
            (105, 120, true, true),    // genuine event, milestone lagging by one step
            (90, 120, true, false),    // more than one milestone short: wait for the milestones
            (120, 120, false, true),   // milestones alone are the truth
            (120, 120, true, true),
            (135, 120, false, true),
            // Bonus: 120 + 30 = 150.
            (120, 150, true, false),
            (135, 150, true, true),
            (135, 150, false, false),
            (150, 150, false, true),
            // Short limit: the first milestone completes it; still nothing at 0 minutes.
            (0, 10, true, false),
            (15, 10, false, true),
            (0, 0, true, false),
        ]
        for r in rows {
            XCTAssertEqual(ScreenTimeSchedule.totalShieldDecision(recorded: r.recorded, threshold: r.threshold,
                                                                  limitEventSeenToday: r.event),
                           r.shield, "recorded \(r.recorded) / \(r.threshold), event \(r.event)")
        }
    }

    func testUsageNeverExceedsTimeSinceMidnight() {
        func plausible(_ minutes: Int, _ hour: Int, _ minute: Int) -> Bool {
            ScreenTimeSchedule.isPlausibleUsage(minutes: minutes, now: date(day: 28, hour: hour, minute: minute), calendar: calendar)
        }
        XCTAssertFalse(plausible(120, 1, 0))     // spurious burst at 01:00
        XCTAssertTrue(plausible(120, 2, 5))
        XCTAssertTrue(plausible(120, 2, 0))      // exactly two hours in
        XCTAssertFalse(plausible(15, 0, 14))
        XCTAssertTrue(plausible(15, 0, 15))
        XCTAssertTrue(plausible(0, 0, 0))
        XCTAssertFalse(plausible(960, 12, 0))
        XCTAssertTrue(plausible(960, 16, 0))
    }

    func testTotalEventCountsOnlyTodayAtTheRegisteredThreshold() {
        let now = date(day: 28, hour: 16)
        let earlier = date(day: 28, hour: 15), yesterday = date(day: 27, hour: 20)
        XCTAssertTrue(ScreenTimeSchedule.totalEventCounts(eventAt: earlier, registeredMinutes: 120, threshold: 120, now: now, calendar: calendar))
        XCTAssertTrue(ScreenTimeSchedule.totalEventCounts(eventAt: earlier, registeredMinutes: nil, threshold: 120, now: now, calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.totalEventCounts(eventAt: yesterday, registeredMinutes: 120, threshold: 120, now: now, calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.totalEventCounts(eventAt: nil, registeredMinutes: 120, threshold: 120, now: now, calendar: calendar))
        // A bonus stored but not registered yet: the 120-minute event can't vouch for 150.
        XCTAssertFalse(ScreenTimeSchedule.totalEventCounts(eventAt: earlier, registeredMinutes: 120, threshold: 150, now: now, calendar: calendar))
        XCTAssertTrue(ScreenTimeSchedule.totalEventCounts(eventAt: earlier, registeredMinutes: 150, threshold: 120, now: now, calendar: calendar))
    }

    func testIsTodayActivityAcrossTheWeekBoundary() {
        let saturdayNight = date(day: 26, hour: 23, minute: 59)   // Saturday = 7
        let sundayMidnight = date(day: 27, hour: 0)               // Sunday = 1
        XCTAssertTrue(ScreenTimeSchedule.isTodayActivity("day.7", now: saturdayNight, calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.isTodayActivity("day.1", now: saturdayNight, calendar: calendar))
        XCTAssertTrue(ScreenTimeSchedule.isTodayActivity("day.1", now: sundayMidnight, calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.isTodayActivity("day.7", now: sundayMidnight, calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.isTodayActivity("day.2", now: sundayMidnight, calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.isTodayActivity("downtime.x", now: sundayMidnight, calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.isTodayActivity("heartbeat.0", now: sundayMidnight, calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.isTodayActivity("pause", now: sundayMidnight, calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.isTodayActivity("day.x", now: sundayMidnight, calendar: calendar))
    }

    func testAppsLimitEventIgnoredOnlyInTheRegistrationBurst() {
        let registeredAt = date(day: 28, hour: 16)
        func ignored(_ seconds: TimeInterval, recorded: Int = 0, threshold: Int = 0) -> Bool {
            ScreenTimeSchedule.shouldIgnoreAppsLimitEvent(now: registeredAt.addingTimeInterval(seconds), registeredAt: registeredAt,
                                                          recordedMinutes: recorded, threshold: threshold)
        }
        XCTAssertTrue(ignored(0))
        XCTAssertTrue(ignored(30))
        XCTAssertTrue(ignored(60))
        XCTAssertFalse(ignored(61))
        XCTAssertFalse(ignored(3600))
        XCTAssertTrue(ignored(-10))   // clock set back: ambiguous, never shield
        XCTAssertFalse(ScreenTimeSchedule.shouldIgnoreAppsLimitEvent(now: registeredAt, registeredAt: nil))
        // In the burst, today's recorded total can vouch for a limit already reached (apps ⊆ everything).
        XCTAssertFalse(ignored(10, recorded: 60, threshold: 60))
        XCTAssertFalse(ignored(10, recorded: 45, threshold: 60))
        XCTAssertTrue(ignored(10, recorded: 15, threshold: 60))
        XCTAssertTrue(ignored(10, recorded: 0, threshold: 60))
    }

    private func policy(enabled: Bool = true, pauseUntil: String? = nil, bonus: ScreenTimeBonus? = nil,
                        downtime: [ScreenTimeDowntime] = []) -> ScreenTimePolicy {
        var p = ScreenTimePolicy(version: 2, enabled: enabled, updatedAt: nil, pauseUntil: pauseUntil,
                                 limits: [ScreenTimeLimit(id: "total", kind: "total", name: "Screen time", minutesPerDay: 120, weekendMinutes: 180),
                                          ScreenTimeLimit(id: "games", kind: "apps", name: "Games", minutesPerDay: 60)],
                                 downtime: downtime)
        p.bonus = bonus
        return p
    }

    private let sundayBedtime = ScreenTimeDowntime(id: "bedtime", name: "Bedtime", start: "21:00", end: "07:00", days: [1])

    func testActiveDowntimeIdsBelongToTheDayTheWindowStarted() {
        let p = policy(downtime: [sundayBedtime])
        // 06:30 Monday is inside Sunday's 21:00–07:00 window.
        XCTAssertEqual(ScreenTimeSchedule.activeDowntimeIds(p, now: date(day: 28, hour: 6, minute: 30), calendar: calendar), ["bedtime"])
        // 06:30 Sunday belongs to Saturday's window, which isn't listed.
        XCTAssertEqual(ScreenTimeSchedule.activeDowntimeIds(p, now: date(day: 27, hour: 6, minute: 30), calendar: calendar), [])
        XCTAssertEqual(ScreenTimeSchedule.activeDowntimeIds(p, now: date(day: 28, hour: 7), calendar: calendar), [])
        XCTAssertEqual(ScreenTimeSchedule.activeDowntimeIds(p, now: date(day: 28, hour: 21, minute: 30), calendar: calendar), [])
        XCTAssertEqual(ScreenTimeSchedule.activeDowntimeIds(p, now: date(day: 27, hour: 21, minute: 30), calendar: calendar), ["bedtime"])
        // Off: never inside anything.
        XCTAssertEqual(ScreenTimeSchedule.activeDowntimeIds(policy(enabled: false, downtime: [sundayBedtime]),
                                                            now: date(day: 28, hour: 6, minute: 30), calendar: calendar), [])
        XCTAssertEqual(ScreenTimeSchedule.activeDowntimeIds(nil, now: date(day: 28, hour: 6, minute: 30), calendar: calendar), [])
    }

    func testDowntimeStartShieldsOnlyInsideTheWindowWithLeeway() {
        let early = date(day: 27, hour: 20, minute: 59).addingTimeInterval(30)   // Sunday 20:59:30
        XCTAssertTrue(ScreenTimeSchedule.downtimeShouldShield(sundayBedtime, now: early, calendar: calendar))
        XCTAssertTrue(ScreenTimeSchedule.downtimeShouldShield(sundayBedtime, now: date(day: 27, hour: 21), calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.downtimeShouldShield(sundayBedtime, now: date(day: 27, hour: 20, minute: 58), calendar: calendar))
        // Monday isn't listed, even though the activity starts every day at 21:00.
        XCTAssertFalse(ScreenTimeSchedule.downtimeShouldShield(sundayBedtime, now: date(day: 28, hour: 21), calendar: calendar))
        XCTAssertFalse(ScreenTimeSchedule.downtimeShouldShield(sundayBedtime, now: date(day: 28, hour: 12), calendar: calendar))
    }

    func testReconcileDecisionTable() {
        let monday = date(day: 28, hour: 12)
        let everything: Set<String> = ["downtime", "pause", "limit.total", "limit.games"]
        func clear(_ p: ScreenTimePolicy?, enrolled: Bool = true, shielded: Set<String> = [], minutes: Int = 0,
                   event: Bool = false, stale: Set<String> = [], at now: Date? = nil) -> Set<String> {
            ScreenTimeSchedule.storesToClear(policy: p, isEnrolled: enrolled, shieldedLimitIds: shielded, todayMinutes: minutes,
                                             totalEventCounts: event, staleLimitIds: stale, now: now ?? monday, calendar: calendar)
        }

        // Off, unenrolled or no policy: clear everything we know of.
        XCTAssertEqual(clear(policy(enabled: false)), everything)
        XCTAssertEqual(clear(policy(enabled: false), shielded: ["old"]), everything.union(["limit.old"]))
        XCTAssertEqual(clear(policy(), enrolled: false), everything)
        XCTAssertEqual(clear(nil, shielded: ["total"]), ["downtime", "pause", "limit.total"])

        // Pause: kept while pauseUntil is ahead, cleared once it passed.
        XCTAssertEqual(clear(policy(pauseUntil: "2026-09-28T13:00:00Z")), ["downtime"])
        XCTAssertEqual(clear(policy(pauseUntil: "2026-09-28T11:00:00Z")), ["downtime", "pause"])

        // Downtime: kept inside a window (Sunday's bedtime at 06:30 Monday), cleared outside it.
        let bed = policy(downtime: [sundayBedtime])
        XCTAssertEqual(clear(bed, at: date(day: 28, hour: 6, minute: 30)), ["pause"])
        XCTAssertEqual(clear(bed, at: date(day: 28, hour: 22)), ["downtime", "pause"])

        // A limit the policy no longer has.
        XCTAssertEqual(clear(policy(), shielded: ["removed"]), ["downtime", "pause", "limit.removed"])

        // total (Monday: 120 min): kept only while the decision still holds.
        XCTAssertEqual(clear(policy(), shielded: ["total"], minutes: 0, event: true), ["downtime", "pause", "limit.total"])
        XCTAssertEqual(clear(policy(), shielded: ["total"], minutes: 120), ["downtime", "pause"])
        XCTAssertEqual(clear(policy(), shielded: ["total"], minutes: 105, event: true), ["downtime", "pause"])
        XCTAssertEqual(clear(policy(), shielded: ["total"], minutes: 105), ["downtime", "pause", "limit.total"])
        // Recorded minutes beyond the time since midnight are never trusted.
        XCTAssertEqual(clear(policy(), shielded: ["total"], minutes: 120, at: date(day: 28, hour: 1)),
                       ["downtime", "pause", "limit.total"])
        // A bonus today lifts it.
        XCTAssertEqual(clear(policy(bonus: ScreenTimeBonus(date: "2026-09-28", minutes: 30)), shielded: ["total"], minutes: 120),
                       ["downtime", "pause", "limit.total"])

        // Apps limit: kept on the day it fired, cleared once that day has passed.
        XCTAssertEqual(clear(policy(), shielded: ["games"]), ["downtime", "pause"])
        XCTAssertEqual(clear(policy(), shielded: ["games"], stale: ["games"]), ["downtime", "pause", "limit.games"])
    }

    func testUsageResponseDecodesNullMinutes() throws {
        let json = #"{"kidId":"k1","days":[{"date":"2026-09-27","minutes":null,"devices":[],"limitMinutes":null,"extraMinutes":0}],"requests":[]}"#
        let u = try JSONDecoder().decode(ScreenTimeUsage.self, from: Data(json.utf8))
        XCTAssertNil(u.days.first?.minutes)
        XCTAssertNil(u.days.first?.limitMinutes)
    }
}
