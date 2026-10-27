import XCTest
import UserNotifications
import WatchKit
@testable import FamETCWatch

final class WatchAlarmTests: XCTestCase {
    private let now = WatchPlanDate.date("2026-09-07", "10:00")!
    private func at(_ time: String, _ day: String = "2026-09-07") -> Date { WatchPlanDate.date(day, time)! }
    private func snapshot(homework: [WatchHomework] = [], actions: [WatchAction] = []) -> WatchSnapshot {
        var value = WatchSnapshot(actions: actions, homework: homework, updatedAt: now)
        value.context = WatchContext(profile: WatchProfile(role: "kid", userId: "u", familyId: "f", kidId: "own", name: "Maya"), events: [])
        return value
    }
    private func work(_ id: String, time: String = "15:00") -> WatchHomework {
        WatchHomework(id: id, kidId: "own", title: "Maths " + id, dueDate: "2026-09-07", dueTime: time, status: "todo")
    }
    private func chore(_ id: String, time: String = "16:00") -> WatchAction {
        WatchAction(id: id, familyId: nil, title: "Feed cat", status: "todo", dueDate: "2026-09-07", dueTime: time)
    }

    func testStrongRemindersScheduleFiveFollowUpsTwoMinutesApart() {
        let plan = WatchReminderPlan.make(snapshot: snapshot(homework: [work("1")]), focus: nil, now: now)
        XCTAssertEqual(plan.map(\.id), ["fam_watch_homework_1"] + (1...5).map { "fam_watch_homework_1_f\($0)" })
        XCTAssertEqual(plan.map(\.fireAt), (0...5).map { at("15:00").addingTimeInterval(Double($0) * 120) })
        XCTAssertEqual(plan.map(\.buzz), [1, 2, 3, 4, 5, 6])
        XCTAssertTrue(plan.allSatisfy { $0.seriesID == "fam_watch_homework_1" && $0.homeworkID == "1" && $0.snoozesLeft == 2 })
        XCTAssertEqual(plan.first?.dueAt, at("15:00"))
    }

    func testFollowUpsContinueAfterTheFirstBuzzAndStopAtQuietHours() {
        // Two re-alerts already passed: the remaining three stay scheduled.
        let later = at("15:05")
        var value = snapshot(homework: [work("1")]); value.updatedAt = later
        XCTAssertEqual(WatchReminderPlan.make(snapshot: value, focus: nil, now: later).map(\.followUp), [3, 4, 5])
        // A 20:56 reminder keeps only the re-alerts before 21:00.
        let evening = at("20:00")
        value = snapshot(homework: [work("2", time: "20:56")]); value.updatedAt = evening
        XCTAssertEqual(WatchReminderPlan.make(snapshot: value, focus: nil, now: evening).map(\.followUp), [0, 1])
    }

    func testAcknowledgementCancelsTheWholeSeriesButNotANewDeadline() {
        var ledger = WatchAlarmLedger()
        ledger.acknowledge("fam_watch_homework_1", dueAt: at("15:00"))
        XCTAssertTrue(WatchReminderPlan.make(snapshot: snapshot(homework: [work("1")]), focus: nil, now: now, ledger: ledger).isEmpty)
        // A moved deadline is a new occurrence.
        XCTAssertEqual(WatchReminderPlan.make(snapshot: snapshot(homework: [work("1", time: "16:00")]), focus: nil, now: now, ledger: ledger).count, 6)
    }

    func testSnoozeMovesTheSeriesFiveMinutesAndIsLimitedToTwo() {
        var ledger = WatchAlarmLedger()
        let due = at("16:00")
        let first = at("16:01")
        XCTAssertTrue(ledger.snooze("fam_watch_action_c", dueAt: due, now: first))
        let value = snapshot(actions: [chore("c")])
        var plan = WatchReminderPlan.make(snapshot: value, focus: nil, now: first, ledger: ledger)
        XCTAssertEqual(plan.first?.fireAt, at("16:06"))
        XCTAssertEqual(plan.first?.buzz, 2)
        XCTAssertEqual(plan.first?.snoozesLeft, 1)
        XCTAssertEqual(plan.first?.kind, .chore)
        XCTAssertEqual(plan.first?.actionID, "c")
        XCTAssertTrue(ledger.snooze("fam_watch_action_c", dueAt: due, now: at("16:07")))
        XCTAssertFalse(ledger.snooze("fam_watch_action_c", dueAt: due, now: at("16:13")))
        XCTAssertEqual(ledger.snoozesLeft("fam_watch_action_c", dueAt: due), 0)
        plan = WatchReminderPlan.make(snapshot: value, focus: nil, now: at("16:08"), ledger: ledger)
        XCTAssertEqual(plan.first?.fireAt, at("16:12"))
        XCTAssertEqual(plan.first?.snoozesLeft, 0)
        XCTAssertEqual(WatchReminders.content(for: plan[0]).categoryIdentifier, WatchAlarmNotifications.choreFinalCategory)
        // Snoozing an acknowledged reminder is refused.
        ledger.acknowledge("fam_watch_action_c", dueAt: due)
        XCTAssertFalse(ledger.snooze("fam_watch_action_c", dueAt: due, now: at("16:14")))
    }

    func testFollowUpsCountAgainstTheBudgetAndTheSoonestWin() {
        let homework = (0..<6).map { work(String($0), time: String(format: "%02d:00", 11 + $0)) }
        let plan = WatchReminderPlan.make(snapshot: snapshot(homework: homework), focus: nil, now: now)
        XCTAssertEqual(plan.count, WatchReminderPlan.budget)
        XCTAssertEqual(Set(plan.map(\.seriesID)).count, 4)
        XCTAssertEqual(plan.last?.fireAt, at("14:10"))
    }

    func testDueAlarmShowsTheRingingReminderWithItsBuzzCount() {
        let value = snapshot(homework: [work("1")], actions: [chore("c", time: "15:30")])
        XCTAssertNil(WatchReminderPlan.dueAlarm(snapshot: value, ledger: WatchAlarmLedger(), now: at("14:59")))
        let ringing = WatchReminderPlan.dueAlarm(snapshot: value, ledger: WatchAlarmLedger(), now: at("15:04"))
        XCTAssertEqual(ringing?.seriesID, "fam_watch_homework_1")
        XCTAssertEqual(ringing?.buzz, 3)
        XCTAssertNil(WatchReminderPlan.dueAlarm(snapshot: value, ledger: WatchAlarmLedger(), now: at("15:20")))
        var ledger = WatchAlarmLedger()
        ledger.acknowledge("fam_watch_homework_1", dueAt: at("15:00"))
        XCTAssertNil(WatchReminderPlan.dueAlarm(snapshot: value, ledger: ledger, now: at("15:04")))
        XCTAssertEqual(WatchReminderPlan.dueAlarm(snapshot: value, ledger: ledger, now: at("15:31"))?.seriesID, "fam_watch_action_c")
        XCTAssertEqual(WatchAlarmView.ordinal(3), "3rd")
        XCTAssertEqual(WatchAlarmView.ordinal(12), "12th")
    }

    func testStrongNotificationContentIsTimeSensitiveWithActions() {
        let plan = WatchReminderPlan.make(snapshot: snapshot(homework: [work("1")]), focus: nil, now: now)
        let content = WatchReminders.content(for: plan[0])
        XCTAssertEqual(content.interruptionLevel, .timeSensitive)
        XCTAssertEqual(content.categoryIdentifier, WatchAlarmNotifications.homeworkCategory)
        let reference = WatchAlarmNotifications.Reference(userInfo: content.userInfo)
        XCTAssertEqual(reference?.seriesID, "fam_watch_homework_1")
        XCTAssertEqual(reference?.dueAt, at("15:00"))
        XCTAssertEqual(reference?.homeworkID, "1")
        let categories = WatchAlarmNotifications.categories
        let homework = categories.first { $0.identifier == WatchAlarmNotifications.homeworkCategory }
        XCTAssertEqual(homework?.actions.map(\.identifier), [WatchAlarmNotifications.startAction, WatchAlarmNotifications.snoozeAction])
        let final = categories.first { $0.identifier == WatchAlarmNotifications.choreFinalCategory }
        XCTAssertEqual(final?.actions.map(\.identifier), [WatchAlarmNotifications.doneAction])
        // Events stay ordinary.
        let event = WatchReminder(id: "fam_watch_event_x", title: "Football", body: "", fireAt: now)
        XCTAssertEqual(WatchReminders.content(for: event).categoryIdentifier, "")
    }

    func testLedgerRoundTripsAndPrunes() {
        let suite = "fametc.alarm.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var ledger = WatchAlarmLedger()
        ledger.snooze("a", dueAt: Date(), now: Date())
        ledger.acknowledge("old", dueAt: Date().addingTimeInterval(-3 * 24 * 3600))
        WatchAlarmLedgerStore.save(ledger, defaults: defaults)
        let loaded = WatchAlarmLedgerStore.load(defaults: defaults)
        XCTAssertNotNil(loaded.entries["a"])
        XCTAssertNil(loaded.entries["old"])
        WatchAlarmLedgerStore.clear(defaults: defaults)
        XCTAssertTrue(WatchAlarmLedgerStore.load(defaults: defaults).entries.isEmpty)
    }

    func testDelegateHandlesSmartAlarmSessions() {
        XCTAssertTrue(FamETCWatchExtensionDelegate().responds(to: NSSelectorFromString("handleExtendedRuntimeSession:")))
    }
}
