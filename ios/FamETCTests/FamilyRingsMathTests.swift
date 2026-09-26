import XCTest
@testable import FamETC

final class FamilyRingsMathTests: XCTestCase {
    func testMondaySundayBoundsDoNotUseSundayFirstLocale() {
        // US Sunday-first conventions must not affect this date-only boundary.
        for date in ["2026-09-21", "2026-09-23", "2026-09-27"] {
            let bounds = FamilyRingsMath.weekBounds(today: date)
            XCTAssertEqual(bounds.start, "2026-09-21")
            XCTAssertEqual(bounds.end, "2026-09-27")
        }
        XCTAssertEqual(FamilyRingsMath.weekBounds(today: "2026-09-28").start, "2026-09-28")
    }

    func testHomeworkCarriesUnfinishedWorkButNotOldCompletions() {
        let items = [homework("old-open", "2026-09-01"), homework("old-done", "2026-09-01", done: true),
                     homework("today", "2026-09-23"), homework("week-done", "2026-09-27", done: true),
                     homework("future", "2026-09-28"), homework("undated", ""),
                     homework("sibling", "2026-09-23", kid: "other")]
        let result = FamilyRingsMath.homework(kidID: "kid", items: items, today: "2026-09-23")
        XCTAssertEqual(result.done, 1)
        XCTAssertEqual(result.total, 3)
        XCTAssertEqual(result.left, 2)
        XCTAssertEqual(result.overdue, 1)
        XCTAssertEqual(result.dueToday, 1)
        XCTAssertEqual(FamilyRingsMath.statusChip(homework: result), "1 overdue")
        let todayOnly = FamilyRingsMath.homework(kidID: "kid", items: [items[2]], today: "2026-09-23")
        XCTAssertEqual(FamilyRingsMath.statusChip(homework: todayOnly), "1 due today")
        XCTAssertEqual(FamilyRingsMath.statusChip(homework: FamilyRingsMath.homework(kidID: "none", items: items, today: "2026-09-23")), "Nothing due today")
    }

    func testHabitsIgnoreMilestonesSiblingsAndNullChecks() {
        let goals = [goal("checked", checks: ["2026-09-23"]), goal("null", checks: nil),
                     goal("yesterday", checks: ["2026-09-22"]), goal("milestone", type: "milestone", checks: nil),
                     goal("sibling", kid: "other", checks: ["2026-09-23"])]
        XCTAssertEqual(FamilyRingsMath.habits(kidID: "kid", goals: goals, today: "2026-09-23"), .init(done: 1, total: 3))
    }

    func testHabitStreakCrossesMonthBoundaryAndRequiresToday() {
        let checked = goal("read", checks: ["2026-03-01", "2026-02-28", "2026-02-28", "2026-02-27", "2026-02-25"])
        XCTAssertEqual(FamilyRingsMath.habitStreak(goal: checked, today: "2026-03-01"), 3)
        XCTAssertEqual(FamilyRingsMath.habitStreak(goal: checked, today: "2026-03-02"), 0)
        XCTAssertEqual(FamilyRingsMath.habitStreak(goal: goal("nil", checks: nil), today: "2026-03-01"), 0)
        XCTAssertEqual(FamilyRingsMath.habitStreak(goal: goal("milestone", type: "milestone", checks: ["2026-03-01"]), today: "2026-03-01"), 0)
    }

    func testActionsExcludeFutureSnoozeAndRequireCompletionDateToday() throws {
        let calendar = Calendar.current
        let midnight = calendar.startOfDay(for: Date())
        let now = calendar.date(byAdding: .hour, value: 12, to: midnight)!
        let stamp = ISO8601DateFormatter()
        let today = DateFmt.ymd.string(from: now)
        var open = try action("open"); open.dueDate = today
        var snoozed = try action("snoozed"); snoozed.status = "snoozed"; snoozed.dueDate = today
        snoozed.snoozedUntil = stamp.string(from: now.addingTimeInterval(3600))
        var expired = snoozed; expired.snoozedUntil = stamp.string(from: now.addingTimeInterval(-1)); expired.dueDate = nil
        var done = try action("done"); done.status = "done"; done.completedAt = stamp.string(from: midnight.addingTimeInterval(1))
        var yesterday = done; yesterday.completedAt = stamp.string(from: midnight.addingTimeInterval(-1))
        var legacy = done; legacy.completedAt = nil; legacy.updatedAt = stamp.string(from: now)
        let undated = try action("undated")
        let result = FamilyRingsMath.parentRing(viewerItems: [open, snoozed, expired, done, yesterday, legacy, undated], now: now)
        XCTAssertEqual(result.open, 3)
        XCTAssertEqual(result.dueNow, 2)
        XCTAssertEqual(result.cleared, 1)
        XCTAssertEqual(result.total, 3)
        XCTAssertTrue(ActionQueue.isDueNow(expired, now: now))
        XCTAssertFalse(ActionQueue.isDueNow(undated, now: now))
    }

    func testDaily3UnavailableAndOnlyThreePartsCount() throws {
        XCTAssertNil(FamilyRingsMath.daily3(nil, today: "2026-09-23"))
        let payload = try JSONDecoder().decode(DailyFiveProgressPayload.self, from: Data(#"{"date":"2026-09-23","parts":{"news":{"status":"completed"},"quote":{"status":"started"},"word":{"status":"completed"},"puzzle":{"status":"completed"}}}"#.utf8))
        XCTAssertNil(FamilyRingsMath.daily3(payload, today: "2026-09-24"))
        XCTAssertEqual(FamilyRingsMath.daily3(payload, today: "2026-09-23"), .init(done: 2, total: 3))
    }

    private func homework(_ id: String, _ due: String, done: Bool = false, kid: String = "kid") -> HomeworkItem {
        HomeworkItem(id: id, kidId: kid, title: id, subject: nil, dueDate: due, dueTime: nil, status: done ? "done" : "todo", effortMin: nil)
    }
    private func goal(_ id: String, kid: String = "kid", type: String = "habit", checks: [String]?) -> Goal {
        Goal(id: id, kidId: kid, title: id, type: type, target: 7, checks: checks, progress: nil)
    }
    private func action(_ id: String) throws -> FamilyAction {
        let json = """
        {"id":"\(id)","familyId":"family","title":"Action","status":"open","assigneeType":"family","sourceType":"manual","createdAt":"2026-09-01T00:00:00Z"}
        """
        return try JSONDecoder().decode(FamilyAction.self, from: Data(json.utf8))
    }
}
