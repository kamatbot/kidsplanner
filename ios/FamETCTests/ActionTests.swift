import XCTest
@testable import FamETC

final class ActionModelDecodingTests: XCTestCase {
    func testDecodesFamilyActionResponse() throws {
        let payload = """
        {
          "action": {
            "id": "a_1",
            "familyId": "f_1",
            "title": "Pack soccer bag",
            "notes": "Bring cleats and water",
            "status": "open",
            "dueDate": "2026-08-08",
            "dueTime": "16:00",
            "assigneeType": "kid",
            "assigneeId": "k_1",
            "kidId": "k_1",
            "sourceType": "calendar",
            "sourceId": "event-private-id",
            "createdBy": "u_1",
            "createdAt": "2026-08-01T00:00:00.000Z",
            "updatedAt": "2026-08-01T00:00:00.000Z",
            "snoozedUntil": null
          }
        }
        """

        let response = try JSONDecoder().decode(FamilyActionResponse.self, from: Data(payload.utf8))
        XCTAssertEqual(response.action.id, "a_1")
        XCTAssertEqual(response.action.title, "Pack soccer bag")
        XCTAssertEqual(response.action.status, "open")
        XCTAssertEqual(response.action.assigneeType, "kid")
        XCTAssertEqual(response.action.kidId, "k_1")
        XCTAssertEqual(response.action.sourceType, "calendar")
        XCTAssertNil(response.action.snoozedUntil)
    }
}

final class ActionQueueTests: XCTestCase {
    private let now = DateFmt.ymd.date(from: "2026-08-08")!

    private func action(
        _ id: String,
        title: String = "Action",
        status: String = "open",
        dueDate: String? = nil,
        dueTime: String? = nil,
        assigneeType: String = "family",
        assigneeId: String? = nil,
        kidId: String? = nil,
        createdAt: String = "2026-08-01T00:00:00.000Z"
    ) -> FamilyAction {
        FamilyAction(id: id, familyId: "f1", title: title, notes: nil, status: status,
                     dueDate: dueDate, dueTime: dueTime, assigneeType: assigneeType,
                     assigneeId: assigneeId, kidId: kidId, sourceType: "manual",
                     sourceId: nil, createdBy: "u1", createdAt: createdAt,
                     updatedAt: nil, snoozedUntil: nil)
    }

    func testTopActiveMatchesWebShelvesAndExcludesCompleted() {
        let items = [
            action("shared", dueDate: nil),
            action("later", dueDate: "2026-09-01"),
            action("next", dueDate: "2026-08-10"),
            action("today", dueDate: "2026-08-08", dueTime: "09:00"),
            action("overdue", dueDate: "2026-08-07", dueTime: "18:00"),
            action("done", status: "done", dueDate: "2026-08-07")
        ]

        XCTAssertEqual(ActionQueue.topActive(items, now: now).map(\.id), ["overdue", "today", "next"])
        XCTAssertEqual(ActionQueue.sortActive(items, now: now).map(\.id), ["overdue", "today", "next", "later", "shared"])
    }

    func testDueAndCreatedAtBreakTiesDeterministically() {
        let older = action("older", dueDate: "2026-08-08", dueTime: "10:00", createdAt: "2026-08-01T00:00:00.000Z")
        let newer = action("newer", dueDate: "2026-08-08", dueTime: "10:00", createdAt: "2026-08-02T00:00:00.000Z")

        XCTAssertEqual(ActionQueue.sortActive([newer, older], now: now).map(\.id), ["older", "newer"])
        XCTAssertEqual(ActionQueue.dueLabel(for: action("overdue", dueDate: "2026-08-07"), now: now), "Overdue")
        XCTAssertEqual(ActionQueue.dueLabel(for: action("none"), now: now), "No date")
    }

    func testSnoozePresetsMatchWebLocalTimes() {
        let calendar = Calendar.current
        let day = DateFmt.ymd.date(from: "2026-08-08")!
        let now = calendar.date(bySettingHour: 10, minute: 15, second: 0, of: day)!
        let late = calendar.date(bySettingHour: 23, minute: 30, second: 0, of: day)!
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let laterToday = parser.date(from: ActionQueue.snoozeUntil(.laterToday, now: now))!
        XCTAssertEqual(calendar.component(.hour, from: laterToday), 12)
        XCTAssertEqual(calendar.component(.minute, from: laterToday), 0)

        let tomorrow = parser.date(from: ActionQueue.snoozeUntil(.tomorrow, now: now))!
        XCTAssertEqual(calendar.dateComponents([.day], from: tomorrow), calendar.dateComponents([.day], from: calendar.date(byAdding: .day, value: 1, to: now)!))
        XCTAssertEqual(calendar.component(.hour, from: tomorrow), 9)

        let nextWeek = parser.date(from: ActionQueue.snoozeUntil(.nextWeek, now: now))!
        XCTAssertEqual(calendar.dateComponents([.day], from: nextWeek), calendar.dateComponents([.day], from: calendar.date(byAdding: .day, value: 7, to: now)!))
        XCTAssertEqual(calendar.component(.hour, from: nextWeek), 9)

        let lateToday = parser.date(from: ActionQueue.snoozeUntil(.laterToday, now: late))!
        XCTAssertEqual(calendar.dateComponents([.year, .month, .day], from: lateToday), calendar.dateComponents([.year, .month, .day], from: late))
        XCTAssertEqual(calendar.component(.hour, from: lateToday), 23)
        XCTAssertEqual(calendar.component(.minute, from: lateToday), 59)
    }
}

@MainActor
final class ActionStoreTests: XCTestCase {
    private enum TestError: Error { case failed }

    private final class FakeActionService: FamilyActionService {
        var items: [FamilyAction]
        var updateError: Error?
        var updatedIDs: [String] = []
        var updatedSnoozes: [String: String?] = [:]

        init(items: [FamilyAction]) { self.items = items }

        func familyActions() async throws -> [FamilyAction] { items }

        func updateFamilyAction(_ id: String, status: String, snoozedUntil: String?) async throws -> FamilyAction {
            if let updateError { throw updateError }
            updatedIDs.append(id)
            updatedSnoozes[id] = snoozedUntil
            guard let index = items.firstIndex(where: { $0.id == id }) else { throw TestError.failed }
            items[index].status = status
            items[index].snoozedUntil = snoozedUntil
            return items[index]
        }
    }

    private func family() -> Family {
        Family(id: "f1", name: "Test Family", inviteCode: "ABC123", parentIds: ["p1"],
               parents: [Parent(id: "p1", name: "Parent")], kids: [
                   Kid(id: "k1", name: "Ava", grade: "3", color: "#000000", createdAt: "2026-01-01T00:00:00.000Z"),
                   Kid(id: "k2", name: "Ben", grade: "5", color: "#111111", createdAt: "2026-01-01T00:00:00.000Z")
               ], createdAt: "2026-01-01T00:00:00.000Z")
    }

    private func action(_ id: String, status: String = "open", assigneeType: String = "family", kidId: String? = nil) -> FamilyAction {
        FamilyAction(id: id, familyId: "f1", title: id, notes: "private notes that the card must not render",
                     status: status, dueDate: "2026-08-08", dueTime: nil,
                     assigneeType: assigneeType, assigneeId: kidId, kidId: kidId,
                     sourceType: "manual", sourceId: "source-private-id", createdBy: "p1",
                     createdAt: "2026-08-01T00:00:00.000Z", updatedAt: nil, snoozedUntil: nil)
    }

    func testCompletionUsesServerResponseOnSuccess() async {
        let item = action("a1")
        let service = FakeActionService(items: [item])
        let store = AppStore(actionService: service)
        store.family = family()
        store.me = User(id: "p1", email: "parent@example.com", name: "Parent", role: "parent", kidId: nil)

        await store.loadFamilyActions()
        await store.completeAction(item)

        XCTAssertEqual(store.actions.first?.status, "done")
        XCTAssertEqual(service.updatedIDs, ["a1"])
        XCTAssertTrue(store.completingActionIDs.isEmpty)
        XCTAssertNil(store.actionError)
    }

    func testCompletionRestoresPreviousActionOnFailure() async {
        let item = action("a1")
        let service = FakeActionService(items: [item])
        service.updateError = TestError.failed
        let store = AppStore(actionService: service)
        store.family = family()
        store.me = User(id: "p1", email: "parent@example.com", name: "Parent", role: "parent", kidId: nil)

        await store.loadFamilyActions()
        await store.completeAction(item)

        XCTAssertEqual(store.actions.first?.status, "open")
        XCTAssertNotNil(store.actionError)
        XCTAssertTrue(store.completingActionIDs.isEmpty)
    }

    func testKidCanCompleteOwnActionButSharedActionIsReadOnly() async {
        let shared = action("shared")
        let own = action("own", assigneeType: "kid", kidId: "k1")
        let sibling = action("sibling", assigneeType: "kid", kidId: "k2")
        let service = FakeActionService(items: [shared, own, sibling])
        let store = AppStore(actionService: service)
        store.family = family()
        store.me = User(id: "u-k1", email: "", name: "Ava", role: "kid", kidId: "k1")

        await store.loadFamilyActions()
        XCTAssertEqual(store.actions.map(\.id), ["shared", "own"])
        XCTAssertFalse(store.canCompleteAction(shared))
        XCTAssertTrue(store.canCompleteAction(own))
        XCTAssertFalse(store.canSnoozeAction(shared))
        XCTAssertTrue(store.canSnoozeAction(own))
        await store.completeAction(shared)
        XCTAssertEqual(service.updatedIDs, [])
        XCTAssertEqual(store.actions.first(where: { $0.id == "shared" })?.status, "open")
    }

    func testKidCanSnoozeOwnActionAndRestoresOnFailure() async {
        let own = action("own", assigneeType: "kid", kidId: "k1")
        let service = FakeActionService(items: [own])
        let store = AppStore(actionService: service)
        store.family = family()
        store.me = User(id: "u-k1", email: "", name: "Ava", role: "kid", kidId: "k1")

        await store.loadFamilyActions()
        await store.snoozeAction(own, preset: .tomorrow)

        XCTAssertEqual(store.actions.first?.status, "snoozed")
        XCTAssertNotNil(store.actions.first?.snoozedUntil)
        XCTAssertEqual(service.updatedIDs, ["own"])
        XCTAssertEqual(service.updatedSnoozes["own"]!, store.actions.first?.snoozedUntil)

        service.updateError = TestError.failed
        let snoozed = store.actions[0]
        await store.snoozeAction(snoozed, preset: .nextWeek)
        XCTAssertEqual(store.actions.first?.status, "snoozed")
        XCTAssertEqual(store.actions.first?.snoozedUntil, snoozed.snoozedUntil)
        XCTAssertNotNil(store.actionError)
    }

    func testParentCanSnoozeAnyAction() async {
        let sibling = action("sibling", assigneeType: "kid", kidId: "k2")
        let service = FakeActionService(items: [sibling])
        let store = AppStore(actionService: service)
        store.family = family()
        store.me = User(id: "p1", email: "parent@example.com", name: "Parent", role: "parent", kidId: nil)

        await store.loadFamilyActions()
        XCTAssertTrue(store.canSnoozeAction(sibling))
        await store.snoozeAction(sibling, preset: .laterToday)
        XCTAssertEqual(service.updatedIDs, ["sibling"])
        XCTAssertEqual(store.actions.first?.status, "snoozed")
    }

    func testKidCalendarVisibilityIncludesSharedAndOwnButExcludesSiblingEvents() {
        let store = AppStore(actionService: FakeActionService(items: []))
        store.family = family()
        store.me = User(id: "u-k1", email: "", name: "Ava", role: "kid", kidId: "k1")
        store.events = [
            CalendarEvent(uid: "school-shared", title: "Family event", start: "2026-08-08", end: nil,
                          allDay: true, location: nil, feedLabel: nil, kidId: nil, isDeadline: false, type: "event"),
            CalendarEvent(uid: "school-own", title: "Ava event", start: "2026-08-08", end: nil,
                          allDay: true, location: nil, feedLabel: nil, kidId: "k1", isDeadline: false, type: "event"),
            CalendarEvent(uid: "school-sibling", title: "Ben event", start: "2026-08-08", end: nil,
                          allDay: true, location: nil, feedLabel: nil, kidId: "k2", isDeadline: false, type: "event")
        ]
        store.familyEvents = [
            FamilyEvent(id: "family-shared", title: "Family event", date: "2026-08-08", time: nil,
                        endTime: nil, endDate: nil, notes: nil, category: nil, kidId: nil,
                        repeatRule: nil, repeatUntil: nil, seriesId: nil, recurring: nil,
                        occurrenceDate: nil, canEdit: nil),
            FamilyEvent(id: "family-own", title: "Ava event", date: "2026-08-08", time: nil,
                        endTime: nil, endDate: nil, notes: nil, category: nil, kidId: "k1",
                        repeatRule: nil, repeatUntil: nil, seriesId: nil, recurring: nil,
                        occurrenceDate: nil, canEdit: nil),
            FamilyEvent(id: "family-sibling", title: "Ben event", date: "2026-08-08", time: nil,
                        endTime: nil, endDate: nil, notes: nil, category: nil, kidId: "k2",
                        repeatRule: nil, repeatUntil: nil, seriesId: nil, recurring: nil,
                        occurrenceDate: nil, canEdit: nil)
        ]

        XCTAssertEqual(store.visibleEvents.map(\.id), ["school-shared", "school-own"])
        XCTAssertEqual(store.visibleFamilyEvents.map(\.id), ["family-shared", "family-own"])
    }
}
