import XCTest
@testable import FamETCWatch

final class WatchPlanTests: XCTestCase {
    func testImminentLessonBeatsOverdueHomeworkButLaterLessonDoesNot() {
        let now = WatchPlanDate.date("2026-09-07", "10:00")!
        let homework = WatchHomework(id: "hw", title: "Read chapter", dueDate: "2026-09-06", status: "todo")
        var snapshot = WatchSnapshot(homework: [homework])
        let profile = WatchProfile(role: "kid", userId: "u", familyId: "f", kidId: "k", name: "Maya")
        var event = WatchEvent(id: "e", title: "Math", date: "2026-09-07", time: "10:10", allDay: false, isTimetable: true)
        snapshot.context = WatchContext(profile: profile, events: [event])
        XCTAssertEqual(snapshot.moments(at: now).first?.id, "event:e")
        event.time = "11:00"
        snapshot.context?.events = [event]
        XCTAssertEqual(snapshot.moments(at: now).first?.id, "homework:hw")
    }
    func testEndedLessonsAndDoneHomeworkLeaveGlanceAndLegacyCacheDecodes() throws {
        let now = WatchPlanDate.date("2026-09-07", "12:00")!
        var snapshot = WatchSnapshot(homework: [WatchHomework(id: "h", title: "Done", dueDate: "2026-09-07", status: "done")])
        snapshot.context = WatchContext(profile: WatchProfile(role: "kid", userId: "u", familyId: "f", name: "Maya"), events: [WatchEvent(id: "e", title: "Math", date: "2026-09-07", time: "09:00", endTime: "10:00", allDay: false, isTimetable: true)])
        XCTAssertTrue(snapshot.moments(at: now).isEmpty)
        let legacy = try JSONDecoder().decode(WatchSnapshot.self, from: Data("{\"actions\":[],\"homework\":[],\"shopping\":[]}".utf8))
        XCTAssertNil(legacy.context)
        XCTAssertFalse(legacy.isParent)
    }
}
