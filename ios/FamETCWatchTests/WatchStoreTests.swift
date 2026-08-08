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
}
