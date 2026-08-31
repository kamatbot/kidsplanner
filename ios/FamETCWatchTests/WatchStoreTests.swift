import XCTest
@testable import FamETCWatch

private final class TestCredentials: WatchCredentialStore {
    var value: WatchCredential?

    init(value: WatchCredential? = WatchCredential(value: "fam_sess=test")) {
        self.value = value
    }

    func credential() throws -> WatchCredential? { value }
}

private final class TestPersistence: WatchPersistence {
    var state: WatchPersistedState?
    var events: [String] = []

    func load() -> WatchPersistedState? {
        events.append("load")
        return state
    }

    func save(_ state: WatchPersistedState) {
        events.append("save")
        self.state = state
    }

    func clear() {
        events.append("clear")
        state = nil
    }
}

private final class TestAPI: WatchAPIClient {
    var actions: [WatchAction] = []
    var homework: [WatchHomework] = []
    var shopping: [WatchShoppingItem] = []
    var actionError: Error?
    var homeworkError: Error?
    var shoppingError: Error?
    var mutationError: Error?
    var events: [String] = []

    func fetchActions() async throws -> [WatchAction] {
        if let actionError { throw actionError }
        return actions
    }

    func fetchHomework() async throws -> [WatchHomework] {
        if let homeworkError { throw homeworkError }
        return homework
    }

    func fetchShopping() async throws -> [WatchShoppingItem] {
        if let shoppingError { throw shoppingError }
        return shopping
    }

    func updateActionStatus(_ id: String, status: String) async throws -> WatchAction {
        events.append("network-action")
        if let mutationError { throw mutationError }
        guard let index = actions.firstIndex(where: { $0.id == id }) else {
            throw WatchAPIError.http(404, "missing")
        }
        actions[index].status = status
        return actions[index]
    }

    func updateHomeworkStatus(_ id: String, status: String) async throws -> WatchHomework {
        events.append("network-homework")
        if let mutationError { throw mutationError }
        guard let index = homework.firstIndex(where: { $0.id == id }) else {
            throw WatchAPIError.http(404, "missing")
        }
        homework[index].status = status
        return homework[index]
    }

    func updateHomeworkChecklistStep(_ id: String, index checklistIndex: Int, done: Bool) async throws -> WatchHomework {
        events.append("network-checklist-\(checklistIndex)-\(done)")
        if let mutationError { throw mutationError }
        guard let homeworkIndex = homework.firstIndex(where: { $0.id == id }),
              homework[homeworkIndex].checklist.indices.contains(checklistIndex) else {
            throw WatchAPIError.http(404, "missing")
        }
        homework[homeworkIndex].checklist[checklistIndex].done = done
        return homework[homeworkIndex]
    }

    func updateShoppingDone(_ id: String, done: Bool) async throws -> WatchShoppingItem {
        events.append("network-shopping")
        if let mutationError { throw mutationError }
        guard let index = shopping.firstIndex(where: { $0.id == id }) else {
            throw WatchAPIError.http(404, "missing")
        }
        shopping[index].done = done
        return shopping[index]
    }
}

@MainActor
final class WatchStoreTests: XCTestCase {
    func testHomeworkProjectionsChooseOneNextAssignmentAndStep() throws {
        let later = WatchHomework(
            id: "later",
            title: "Read chapter",
            dueDate: "2026-08-12",
            status: "todo",
            checklist: [WatchChecklistItem(text: "Read", done: false)]
        )
        let first = WatchHomework(
            id: "first",
            title: "Science project",
            dueDate: "2026-08-10",
            status: "todo",
            checklist: [
                WatchChecklistItem(text: "Choose a topic", done: true),
                WatchChecklistItem(text: "Draft an outline", done: false),
                WatchChecklistItem(text: "Review sources", done: false),
            ]
        )
        let snapshot = WatchSnapshot(homework: [later, first])

        XCTAssertEqual(snapshot.focusHomework?.id, "first")
        XCTAssertEqual(snapshot.focusHomework?.completedChecklistCount, 1)
        XCTAssertEqual(snapshot.focusHomework?.firstIncompleteChecklistIndex, 1)
        XCTAssertEqual(snapshot.focusHomework?.firstIncompleteChecklistItem?.text, "Draft an outline")
    }

    func testSchemaOneCacheDefaultsChecklistFocusAndMutationIndex() throws {
        let oldJSON = """
        {"schemaVersion":1,"snapshot":{"actions":[],"homework":[{"id":"h1","title":"Essay","dueDate":"2026-08-10","status":"todo"}],"shopping":[]},"outbox":[{"id":"00000000-0000-0000-0000-000000000001","kind":"homeworkStatus","resourceID":"h1","stringValue":"in_progress","boolValue":null,"createdAt":0}]}
        """
        let state = try JSONDecoder().decode(WatchPersistedState.self, from: Data(oldJSON.utf8))
        XCTAssertEqual(state.schemaVersion, 1)
        XCTAssertNil(state.focusSession)
        XCTAssertEqual(state.snapshot.homework.first?.checklist, [])
        XCTAssertNil(state.outbox.first?.index)
    }

    func testCodableStateRoundTripsSnapshotAndOutbox() throws {
        let snapshot = WatchSnapshot(
            actions: [WatchAction(id: "a1", familyId: "f1", title: "Pack kit", notes: nil,
                                  status: "open", dueDate: "2026-08-08", dueTime: "08:00",
                                  assigneeType: "kid", assigneeId: "k1", kidId: "k1",
                                  sourceType: "manual", sourceId: nil, createdAt: nil,
                                  updatedAt: nil, snoozedUntil: nil)],
            homework: [],
            shopping: [WatchShoppingItem(id: "s1", text: "Milk", done: false)],
            updatedAt: Date(timeIntervalSince1970: 123)
        )
        let state = WatchPersistedState(
            snapshot: snapshot,
            outbox: [WatchMutation(kind: .actionStatus, resourceID: "a1", stringValue: "done")]
        )

        let data = try JSONEncoder().encode(state)
        let decoded = try JSONDecoder().decode(WatchPersistedState.self, from: data)
        XCTAssertEqual(decoded, state)
    }

    func testChecklistMutationRoundTripsIndexAndDesiredState() throws {
        let mutation = WatchMutation(
            kind: .homeworkChecklistStep,
            resourceID: "h1",
            boolValue: true,
            index: 2
        )
        let decoded = try JSONDecoder().decode(
            WatchMutation.self,
            from: JSONEncoder().encode(mutation)
        )
        XCTAssertEqual(decoded, mutation)
        XCTAssertEqual(decoded.index, 2)
        XCTAssertEqual(decoded.boolValue, true)
    }

    func testShoppingDecodesServerAndLegacyFieldNames() throws {
        let server = try JSONDecoder().decode(
            WatchShoppingItem.self,
            from: Data("{\"id\":\"s1\",\"text\":\"Milk\",\"done\":false}".utf8)
        )
        XCTAssertEqual(server.text, "Milk")
        XCTAssertFalse(server.done)

        let legacy = try JSONDecoder().decode(
            WatchShoppingItem.self,
            from: Data("{\"id\":\"s2\",\"name\":\"Eggs\",\"checked\":true}".utf8)
        )
        XCTAssertEqual(legacy.text, "Eggs")
        XCTAssertTrue(legacy.done)
    }

    func testMutationIsDurablySavedBeforeNetworkAttempt() async {
        let api = TestAPI()
        api.actions = [WatchAction(id: "a1", familyId: "f1", title: "Pack kit", notes: nil,
                                   status: "open", dueDate: nil, dueTime: nil,
                                   assigneeType: nil, assigneeId: nil, kidId: nil,
                                   sourceType: nil, sourceId: nil, createdAt: nil,
                                   updatedAt: nil, snoozedUntil: nil)]
        let credentials = TestCredentials()
        let persistence = TestPersistence()
        let store = WatchStore(
            api: api,
            credentials: credentials,
            persistence: persistence,
            initialState: WatchPersistedState(snapshot: WatchSnapshot(actions: api.actions))
        )

        await store.completeAction(store.snapshot.actions[0])

        XCTAssertEqual(store.snapshot.actions[0].status, "done")
        XCTAssertEqual(store.pendingMutationCount, 0)
        XCTAssertEqual(persistence.events.first, "save")
        XCTAssertEqual(api.events, ["network-action"])
    }

    func testFailedMutationStaysInOutboxAndUsesOfflineState() async {
        let api = TestAPI()
        api.actions = [WatchAction(id: "a1", familyId: "f1", title: "Pack kit", notes: nil,
                                   status: "open", dueDate: nil, dueTime: nil,
                                   assigneeType: nil, assigneeId: nil, kidId: nil,
                                   sourceType: nil, sourceId: nil, createdAt: nil,
                                   updatedAt: nil, snoozedUntil: nil)]
        api.mutationError = WatchAPIError.transport("offline")
        let persistence = TestPersistence()
        let store = WatchStore(
            api: api,
            credentials: TestCredentials(),
            persistence: persistence,
            initialState: WatchPersistedState(snapshot: WatchSnapshot(actions: api.actions))
        )

        await store.completeAction(store.snapshot.actions[0])

        XCTAssertEqual(store.pendingMutationCount, 1)
        XCTAssertEqual(store.connection, .offline)
        XCTAssertEqual(persistence.state?.outbox.count, 1)
        XCTAssertEqual(store.snapshot.actions[0].status, "done")
    }

    func testMissingCredentialStillPersistsOptimisticMutation() async {
        let api = TestAPI()
        api.actions = [WatchAction(id: "a1", familyId: "f1", title: "Pack kit", notes: nil,
                                   status: "open", dueDate: nil, dueTime: nil,
                                   assigneeType: nil, assigneeId: nil, kidId: nil,
                                   sourceType: nil, sourceId: nil, createdAt: nil,
                                   updatedAt: nil, snoozedUntil: nil)]
        let persistence = TestPersistence()
        let store = WatchStore(
            api: api,
            credentials: TestCredentials(value: nil),
            persistence: persistence,
            initialState: WatchPersistedState(snapshot: WatchSnapshot(actions: api.actions))
        )

        await store.completeAction(store.snapshot.actions[0])

        XCTAssertEqual(store.connection, .disconnected)
        XCTAssertEqual(store.pendingMutationCount, 1)
        XCTAssertTrue(api.events.isEmpty)
        XCTAssertEqual(persistence.state?.outbox.count, 1)
    }

    func testChecklistStepIsOptimisticDurableAndReplaysInOrder() async {
        let homework = WatchHomework(
            id: "h1",
            title: "Science project",
            dueDate: "2026-08-10",
            status: "todo",
            checklist: [
                WatchChecklistItem(text: "Choose a topic"),
                WatchChecklistItem(text: "Draft an outline"),
            ]
        )
        let api = TestAPI()
        api.homework = [homework]
        api.mutationError = WatchAPIError.transport("offline")
        let persistence = TestPersistence()
        let store = WatchStore(
            api: api,
            credentials: TestCredentials(),
            persistence: persistence,
            initialState: WatchPersistedState(snapshot: WatchSnapshot(homework: [homework]))
        )

        await store.markHomeworkStepDone(homework, index: 1)

        XCTAssertEqual(store.snapshot.homework[0].checklist[1].done, true)
        XCTAssertEqual(store.pendingMutationCount, 1)
        XCTAssertEqual(persistence.state?.outbox.first?.kind, .homeworkChecklistStep)
        XCTAssertEqual(persistence.state?.outbox.first?.index, 1)
        XCTAssertEqual(persistence.state?.outbox.first?.boolValue, true)
        XCTAssertEqual(api.events, ["network-checklist-1-true"])

        api.mutationError = nil
        await store.refresh()

        XCTAssertEqual(api.events, ["network-checklist-1-true", "network-checklist-1-true"])
        XCTAssertEqual(store.pendingMutationCount, 0)
        XCTAssertEqual(persistence.state?.outbox, [])
        XCTAssertTrue(api.homework[0].checklist[1].done)
    }

    func testFocusPersistsBeforeStatusReplayAndRestoresOneShotAcknowledgement() async {
        let homework = WatchHomework(
            id: "h1",
            title: "Science project",
            dueDate: "2026-08-10",
            status: "todo",
            checklist: [WatchChecklistItem(text: "Choose a topic")]
        )
        let api = TestAPI()
        api.homework = [homework]
        let persistence = TestPersistence()
        let store = WatchStore(
            api: api,
            credentials: TestCredentials(),
            persistence: persistence,
            initialState: WatchPersistedState(snapshot: WatchSnapshot(homework: [homework]))
        )

        await store.startFocus(on: homework, checklistIndex: 0)

        let session = try! XCTUnwrap(store.focusSession)
        XCTAssertEqual(session.homeworkID, "h1")
        XCTAssertEqual(session.checklistIndex, 0)
        XCTAssertEqual(session.titleSnapshot, "Science project")
        XCTAssertEqual(session.duration, WatchFocusSession.duration)
        XCTAssertEqual(persistence.events.first, "save")
        XCTAssertEqual(api.events, ["network-homework"])
        XCTAssertEqual(persistence.state?.focusSession?.id, session.id)

        let completedAt = session.endsAt.addingTimeInterval(1)
        XCTAssertTrue(store.focusIsComplete(at: completedAt))
        XCTAssertTrue(store.acknowledgeFocusCompletion(at: completedAt))
        XCTAssertFalse(store.acknowledgeFocusCompletion(at: completedAt))

        let restored = WatchStore(
            api: api,
            credentials: TestCredentials(),
            persistence: persistence
        )
        XCTAssertEqual(restored.focusSession?.id, session.id)
        XCTAssertTrue(restored.focusSession?.completionAcknowledged == true)
    }

    func testFocusAndStepDoNotAutoCompleteAssignment() async {
        let homework = WatchHomework(
            id: "h1",
            title: "Science project",
            dueDate: "2026-08-10",
            status: "todo",
            checklist: [WatchChecklistItem(text: "Choose a topic")]
        )
        let api = TestAPI()
        api.homework = [homework]
        let store = WatchStore(
            api: api,
            credentials: TestCredentials(value: nil),
            persistence: TestPersistence(),
            initialState: WatchPersistedState(snapshot: WatchSnapshot(homework: [homework]))
        )

        await store.startFocus(on: homework, checklistIndex: 0)
        await store.markSelectedStepDone()

        XCTAssertNotEqual(store.snapshot.homework[0].status, "done")
        XCTAssertTrue(store.snapshot.homework[0].checklist[0].done)
        XCTAssertNotNil(store.focusSession)
    }

    func testSelectedStepDoneEndsFocusAfterDurableQueueing() async {
        let homework = WatchHomework(
            id: "h1",
            title: "Science project",
            dueDate: "2026-08-10",
            status: "todo",
            checklist: [WatchChecklistItem(text: "Choose a topic")]
        )
        let persistence = TestPersistence()
        let api = TestAPI()
        api.homework = [homework]
        let store = WatchStore(
            api: api,
            credentials: TestCredentials(value: nil),
            persistence: persistence,
            initialState: WatchPersistedState(snapshot: WatchSnapshot(homework: [homework]))
        )

        await store.startFocus(on: homework, checklistIndex: 0)
        await store.markSelectedStepDone()

        XCTAssertNil(store.focusSession)
        XCTAssertTrue(store.snapshot.homework[0].checklist[0].done)
        XCTAssertEqual(store.pendingMutationCount, 2)
        XCTAssertEqual(persistence.state?.outbox.last?.kind, .homeworkChecklistStep)
    }

    func testStartingAnotherAssignmentCannotReplaceActiveFocus() async {
        let first = WatchHomework(
            id: "h1",
            title: "History essay",
            dueDate: "2026-09-02",
            status: "todo"
        )
        let second = WatchHomework(
            id: "h2",
            title: "Science report",
            dueDate: "2026-09-03",
            status: "todo"
        )
        let store = WatchStore(
            api: TestAPI(),
            credentials: TestCredentials(value: nil),
            persistence: TestPersistence(),
            initialState: WatchPersistedState(snapshot: WatchSnapshot(homework: [first, second]))
        )

        await store.startFocus(on: first)
        let originalSession = store.focusSession
        await store.startFocus(on: second)

        XCTAssertEqual(store.focusSession, originalSession)
        XCTAssertEqual(store.focusSession?.homeworkID, first.id)
        XCTAssertEqual(store.pendingMutationCount, 1)
        XCTAssertEqual(store.snapshot.homework.first(where: { $0.id == second.id })?.status, "todo")
    }
}
