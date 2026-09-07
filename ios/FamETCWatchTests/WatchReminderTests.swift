import XCTest
@testable import FamETCWatch

final class WatchReminderTests: XCTestCase {
    private let now = WatchPlanDate.date("2026-09-07", "10:00")!
    private func snapshot(role: String = "kid") -> WatchSnapshot {
        var value = WatchSnapshot(updatedAt: now)
        value.context = WatchContext(profile: WatchProfile(role: role, userId: "u", familyId: "f", kidId: "own", name: "Maya"), events: [])
        return value
    }
    private func work(_ id: String, kid: String? = "own", time: String? = nil, status: String = "todo") -> WatchHomework {
        WatchHomework(id: id, kidId: kid, title: id, dueDate: "2026-09-07", dueTime: time, status: status)
    }
    private func action(_ id: String, source: String? = nil) -> WatchAction {
        WatchAction(id: id, familyId: nil, title: id, status: "todo", dueDate: "2026-09-07", dueTime: "15:30", sourceType: source == nil ? nil : "homework", sourceId: source)
    }
    func testKidScopeSharedEventsAndDeadlineTimes() {
        var value = snapshot()
        value.homework = [work("own"), work("other", kid: "sibling")]
        value.actions = [action("task")]
        value.context?.events = [WatchEvent(id: "shared", title: "Football", date: "2026-09-07", time: "11:00", allDay: false, isTimetable: false), WatchEvent(id: "private", title: "Sibling", date: "2026-09-07", time: "12:00", allDay: false, kidId: "sibling", isTimetable: false)]
        let plan = WatchReminderPlan.make(snapshot: value, focus: nil, now: now)
        XCTAssertEqual(plan.map(\.id), ["fam_watch_event_shared", "fam_watch_action_task", "fam_watch_homework_own"])
        XCTAssertEqual(plan.map(\.fireAt), ["10:50", "15:30", "17:00"].map { WatchPlanDate.date("2026-09-07", $0)! })
        XCTAssertEqual(plan.first?.title, "Football")
        XCTAssertEqual(plan.first?.body, "Starts in 10 minutes")
        value.context?.profile.role = "parent"
        XCTAssertEqual(WatchReminderPlan.make(snapshot: value, focus: nil, now: now).count, 5)
    }
    func testCompletedSnoozedRemovedAndDerivedWorkDisappear() {
        var value = snapshot()
        value.homework = [work("done", status: "done"), work("snoozed", status: "snoozed"), work("open")]
        value.actions = [action("done-copy", source: "done"), action("snooze-copy", source: "snoozed"), action("open-copy", source: "open")]
        XCTAssertEqual(WatchReminderPlan.make(snapshot: value, focus: nil, now: now).map(\.id), ["fam_watch_homework_open"])
        value.homework = []
        value.actions = [action("duplicate-a", source: "same"), action("duplicate-b", source: "same")]
        XCTAssertEqual(WatchReminderPlan.make(snapshot: value, focus: nil, now: now).map(\.id), ["fam_watch_homework_same"])
        value.actions = []
        XCTAssertTrue(WatchReminderPlan.make(snapshot: value, focus: nil, now: now).isEmpty)
        var done = action("done"); done.status = "done"
        var snoozed = action("snoozed"); snoozed.status = "snoozed"
        value.actions = [done, snoozed]
        XCTAssertTrue(WatchReminderPlan.make(snapshot: value, focus: nil, now: now).isEmpty)
    }
    func testMissingStaleUnknownAndFutureIdentitySnapshotFailClosed() {
        var value = snapshot()
        value.homework = [work("task")]
        for date in [nil, now.addingTimeInterval(-48 * 3600), now.addingTimeInterval(60)] {
            value.updatedAt = date
            XCTAssertTrue(WatchReminderPlan.make(snapshot: value, focus: nil, now: now).isEmpty)
        }
        value.updatedAt = now
        value.context?.profile.role = "unknown"
        XCTAssertTrue(WatchReminderPlan.make(snapshot: value, focus: nil, now: now).isEmpty)
        value.context?.profile.role = "kid"
        value.context?.profile.kidId = nil
        XCTAssertTrue(WatchReminderPlan.make(snapshot: value, focus: nil, now: now).isEmpty)
        value.context = nil
        XCTAssertTrue(WatchReminderPlan.make(snapshot: value, focus: nil, now: now).isEmpty)
    }
    func testQuietHoursHorizonPastAndExplicitFocus() {
        let evening = WatchPlanDate.date("2026-09-07", "20:00")!
        var value = snapshot(); value.updatedAt = evening
        value.homework = [work("late", time: "21:00"), work("past", time: "19:00")]
        let session = WatchFocusSession(homeworkID: "late", titleSnapshot: "Read", startedAt: evening, duration: 2 * 3600)
        let plan = WatchReminderPlan.make(snapshot: value, focus: session, now: evening)
        XCTAssertEqual(plan.count, 1)
        XCTAssertEqual(plan.first?.fireAt, session.endsAt)
        value.updatedAt = nil
        XCTAssertEqual(WatchReminderPlan.make(snapshot: value, focus: session, now: evening).count, 1)
        XCTAssertTrue(WatchReminderPlan.make(snapshot: value, focus: session, now: session.endsAt).isEmpty)
        var acknowledged = session; acknowledged.completionAcknowledged = true
        XCTAssertTrue(WatchReminderPlan.make(snapshot: value, focus: acknowledged, now: evening).isEmpty)
        value.updatedAt = evening
        value.homework = [WatchHomework(id: "far", title: "Later", dueDate: "2026-09-10", status: "todo"), WatchHomework(id: "early", title: "Early", dueDate: "2026-09-08", dueTime: "06:59", status: "todo"), WatchHomework(id: "seven", title: "Seven", dueDate: "2026-09-08", dueTime: "07:00", status: "todo")]
        XCTAssertEqual(WatchReminderPlan.make(snapshot: value, focus: nil, now: evening).map(\.id), ["fam_watch_homework_seven"])
    }
    func testCapReservesFocusAndRepeatedSourcesStayUnique() {
        var value = snapshot()
        value.homework = (0..<30).map { work(String($0)) }
        value.homework.append(value.homework[0])
        let focus = WatchFocusSession(homeworkID: "0", titleSnapshot: "Focus", startedAt: now)
        let plan = WatchReminderPlan.make(snapshot: value, focus: focus, now: now)
        XCTAssertEqual(plan.count, 24)
        XCTAssertEqual(Set(plan.map(\.id)).count, 24)
        XCTAssertTrue(plan.contains { $0.id == "fam_watch_focus_" + focus.id.uuidString })
    }
}
