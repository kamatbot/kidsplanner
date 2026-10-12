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
    func testManyEventsOrderCorrectlyAndStayFast() {
        let now = WatchPlanDate.date("2026-09-07", "10:00")!
        let profile = WatchProfile(role: "kid", userId: "u", familyId: "f", kidId: "k", name: "Maya")
        // 160 events through the day; ids reversed so ordering must come from time, not input order.
        let events = (0..<160).map { i in
            WatchEvent(id: String(format: "e%03d", 159 - i), title: "E\(i)", date: "2026-09-07",
                       time: String(format: "%02d:%02d", 10 + i / 12, (i % 12) * 5), allDay: false, isTimetable: false)
        }.reversed()
        var snapshot = WatchSnapshot(homework: [WatchHomework(id: "hw", title: "Read", dueDate: "2026-09-07", dueTime: "10:03", status: "todo")])
        snapshot.context = WatchContext(profile: profile, events: Array(events))
        let ids = snapshot.moments(at: now).map(\.id)
        XCTAssertEqual(ids.count, 161)
        // Events starting by 10:15 rank first; homework (10:03) then precedes later events by time.
        XCTAssertEqual(Array(ids.prefix(5)), ["event:e159", "event:e158", "event:e157", "event:e156", "homework:hw"])
        XCTAssertEqual(snapshot.dayEvents(at: now).count, 160)
        let start = Date()
        for _ in 0..<50 { _ = snapshot.moments(at: now); _ = snapshot.dayEvents(at: now) }
        XCTAssertLessThan(Date().timeIntervalSince(start), 1.0)
    }
}
