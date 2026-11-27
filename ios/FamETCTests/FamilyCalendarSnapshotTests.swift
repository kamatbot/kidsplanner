import XCTest
@testable import FamETC

final class FamilyCalendarSnapshotTests: XCTestCase {
    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private var family: Family {
        Family(id: "f1", name: "Family", inviteCode: nil, parentIds: ["u-parent"],
            kids: [Kid(id: "k1", name: "Mina", grade: "6", color: "#6F43D6", createdAt: "2026-01-01T00:00:00Z"),
                   Kid(id: "k2", name: "Leo", grade: "3", color: "bad", createdAt: "2026-01-01T00:00:00Z")],
            createdAt: "2026-01-01T00:00:00Z")
    }

    private let parent = User(id: "u-parent", email: "p@example.com", name: "P", role: "parent")

    func testBuildsUpcomingEventsInOrderAndDropsPastOnes() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-16T12:00:00Z"))
        let school = [
            CalendarEvent(uid: "past", title: "Assembly", start: "2026-09-16T09:00:00Z", end: "2026-09-16T10:00:00Z",
                allDay: false, kidId: "k1"),
            CalendarEvent(uid: "later", title: "Swim", start: "2026-09-16T15:00:00Z", end: "2026-09-16T16:00:00Z",
                allDay: false, kidId: "k1"),
            CalendarEvent(uid: "far", title: "Trip", start: "2026-10-30", allDay: true, kidId: nil),
        ]
        let manual = [
            FamilyEvent(id: "e1", title: "  Family   dinner ", date: "2026-09-16", time: "18:30", kidId: nil),
            FamilyEvent(id: "e2", title: "Book fair", date: "2026-09-17", time: nil, kidId: "k2"),
        ]
        let snapshot = FamilyCalendarSnapshotBuilder.build(user: parent, family: family, events: school,
            familyEvents: manual, now: now, calendar: utc)

        XCTAssertEqual(snapshot.events.map(\.title), ["Swim", "Family dinner", "Book fair"])
        XCTAssertEqual(snapshot.events.first?.memberID, "k1")
        XCTAssertTrue(snapshot.events[2].allDay)
        XCTAssertEqual(snapshot.members.map(\.name), ["Mina", "Leo"])
        XCTAssertNil(snapshot.members[1].colorHex)
    }

    func testMemberFilterKeepsFamilyWideEvents() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-16T12:00:00Z"))
        let manual = [
            FamilyEvent(id: "a", title: "Mina only", date: "2026-09-16", time: "15:00", kidId: "k1"),
            FamilyEvent(id: "b", title: "Leo only", date: "2026-09-16", time: "16:00", kidId: "k2"),
            FamilyEvent(id: "c", title: "Everyone", date: "2026-09-16", time: "17:00", kidId: nil),
        ]
        let snapshot = FamilyCalendarSnapshotBuilder.build(user: parent, family: family, events: [],
            familyEvents: manual, now: now, calendar: utc)
        XCTAssertEqual(snapshot.upcoming(at: now, memberID: "k1", calendar: utc).map(\.title), ["Mina only", "Everyone"])
        XCTAssertEqual(snapshot.upcoming(at: now, calendar: utc).count, 3)
    }

    func testKidSnapshotListsOnlyThemselvesAsMember() {
        let kid = User(id: "u-kid", email: "", name: "Mina", role: "kid", kidId: "k1")
        let snapshot = FamilyCalendarSnapshotBuilder.build(user: kid, family: family, events: [], familyEvents: [],
            now: Date(), calendar: utc)
        XCTAssertEqual(snapshot.members.map(\.id), ["k1"])
    }

    func testSnapshotRoundTripsThroughStore() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { FamilyCalendarSnapshotStore.clear(url: url) }
        let snapshot = FamilyCalendarSnapshot(accountID: "u", familyID: "f", generatedAt: Date(timeIntervalSince1970: 1000),
            members: [], events: [FamilyCalendarEvent(id: "1", title: "T", dayKey: "2026-09-16", endDayKey: nil,
                start: Date(timeIntervalSince1970: 2000), end: nil, allDay: false, memberID: nil)])
        FamilyCalendarSnapshotStore.save(snapshot, url: url)
        XCTAssertEqual(FamilyCalendarSnapshotStore.load(url: url), snapshot)
    }

    func testCalendarRouteRoundTrips() throws {
        let url = try XCTUnwrap(FamilyCalendarRoute.url(dayKey: "2026-09-17"))
        XCTAssertEqual(FamilyCalendarRoute.dayKey(from: url), .some("2026-09-17"))
        let noDay = try XCTUnwrap(FamilyCalendarRoute.url(dayKey: nil))
        XCTAssertEqual(FamilyCalendarRoute.dayKey(from: noDay), .some(nil))
        XCTAssertNil(FamilyCalendarRoute.dayKey(from: URL(string: "https://evil.example/?famRoute=calendar")!))
        XCTAssertNil(FamilyCalendarRoute.dayKey(from: URL(string: "https://www.fametc.com/?famRoute=today&childId=k1")!))
    }
}
