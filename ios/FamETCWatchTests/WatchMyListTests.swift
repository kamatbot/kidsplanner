import XCTest
@testable import FamETCWatch

private final class ChoreCredentials: WatchCredentialStore {
    var value: WatchCredential? = WatchCredential(kind: .bearerToken, value: "kid-token", role: "kid")
    func credential() throws -> WatchCredential? { value }
}

private final class ChorePersistence: WatchPersistence {
    var state: WatchPersistedState?
    func load() -> WatchPersistedState? { state }
    func save(_ state: WatchPersistedState) { self.state = state }
    func clear() { state = nil }
}

private final class ChoreAPI: WatchAPIClient, WatchContextClient, WatchChoreClient {
    var context = WatchContext(profile: WatchProfile(role: "kid", userId: "u", familyId: "f", kidId: "own", name: "Maya"), events: [])
    var chores: [WatchChore] = []
    var submitError: Error?
    var fetchChoresError: Error?
    var submitted: [String] = []

    func fetchContext() async throws -> WatchContext { context }
    func fetchActions() async throws -> [WatchAction] { [] }
    func fetchHomework() async throws -> [WatchHomework] { [] }
    func fetchShopping() async throws -> [WatchShoppingItem] { throw WatchAPIError.forbidden }
    func updateActionStatus(_ id: String, status: String) async throws -> WatchAction { throw WatchAPIError.http(404, "missing") }
    func updateHomeworkStatus(_ id: String, status: String) async throws -> WatchHomework { throw WatchAPIError.http(404, "missing") }
    func updateHomeworkChecklistStep(_ id: String, index: Int, done: Bool) async throws -> WatchHomework { throw WatchAPIError.http(404, "missing") }
    func updateShoppingDone(_ id: String, done: Bool) async throws -> WatchShoppingItem { throw WatchAPIError.http(404, "missing") }

    func fetchChores() async throws -> [WatchChore] {
        if let fetchChoresError { throw fetchChoresError }
        return chores
    }
    func submitChore(_ id: String) async throws -> WatchChore {
        submitted.append(id)
        if let submitError { throw submitError }
        guard let index = chores.firstIndex(where: { $0.id == id }) else { throw WatchAPIError.http(400, "Chore not found.") }
        chores[index].status = "submitted"
        return chores[index]
    }
}

final class WatchMyListTests: XCTestCase {
    private let now = WatchPlanDate.date("2026-09-07", "10:00")!
    private func snapshot(role: String = "kid") -> WatchSnapshot {
        var value = WatchSnapshot(updatedAt: now)
        value.context = WatchContext(profile: WatchProfile(role: role, userId: "u", familyId: "f", kidId: "own", name: "Maya"), events: [])
        return value
    }

    func testChoresDecodeFromTheFamsSummary() throws {
        let json = """
        {"kidId":"own","isParent":false,"kids":[{"id":"own","name":"Maya"}],"balance":12.5,
         "chores":[{"id":"c1","title":"Tidy room","amount":5,"status":"pending","createdAt":"2026-09-07T08:00:00.000Z"},
                   {"id":"c2","title":"Dishes","amount":3.0,"status":"submitted","createdAt":"2026-09-06T08:00:00.000Z","submittedAt":"2026-09-07T09:00:00.000Z"}],
         "goal":null}
        """
        let chores = try JSONDecoder().decode(WatchChoreFamsResponse.self, from: Data(json.utf8)).chores
        XCTAssertEqual(chores.map(\.id), ["c1", "c2"])
        XCTAssertEqual(chores.map(\.amount), [5, 3])
        XCTAssertTrue(chores[0].isOpen)
        XCTAssertFalse(chores[1].isOpen)
        XCTAssertEqual(chores[1].submittedAt, "2026-09-07T09:00:00.000Z")
        let empty = try JSONDecoder().decode(WatchChoreFamsResponse.self, from: Data(#"{"kidId":null,"kids":[],"isParent":true}"#.utf8))
        XCTAssertTrue(empty.chores.isEmpty)
        let submitted = try JSONDecoder().decode(WatchChoreSubmitResponse.self, from: Data(#"{"chore":{"id":"c1","title":"Tidy room","amount":5,"status":"submitted"}}"#.utf8))
        XCTAssertEqual(submitted.chore.status, "submitted")
    }

    func testSnapshotCachesChoresAndOldCachesStillDecode() throws {
        var value = snapshot()
        value.chores = [WatchChore(id: "c1", title: "Tidy room", amount: 5)]
        let decoded = try JSONDecoder().decode(WatchSnapshot.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(decoded.chores, value.chores)
        let old = try JSONDecoder().decode(WatchSnapshot.self, from: Data(#"{"actions":[],"homework":[],"shopping":[]}"#.utf8))
        XCTAssertNil(old.chores)
        let mutation = try JSONDecoder().decode(WatchMutation.self, from: JSONEncoder().encode(WatchMutation(kind: .choreSubmit, resourceID: "c1")))
        XCTAssertEqual(mutation.kind, .choreSubmit)
    }

    func testOpenTodoCountCoversTodayHomeworkActionsAndPendingChores() {
        var value = snapshot()
        value.homework = [
            WatchHomework(id: "today", kidId: "own", title: "Maths", dueDate: "2026-09-07", status: "todo"),
            WatchHomework(id: "late", kidId: "own", title: "Late", dueDate: "2026-09-05", status: "in_progress"),
            WatchHomework(id: "tomorrow", kidId: "own", title: "Science", dueDate: "2026-09-08", status: "todo"),
            WatchHomework(id: "sibling", kidId: "other", title: "Not mine", dueDate: "2026-09-07", status: "todo"),
            WatchHomework(id: "done", kidId: "own", title: "Spelling", dueDate: "2026-09-07", status: "done"),
            WatchHomework(id: "snoozed", kidId: "own", title: "Later", dueDate: "2026-09-07", status: "snoozed"),
        ]
        value.actions = [
            WatchAction(id: "bins", familyId: nil, title: "Bins", status: "todo", dueDate: "2026-09-07", dueTime: "18:00"),
            WatchAction(id: "undated", familyId: nil, title: "Feed cat", status: "todo"),
            WatchAction(id: "derived", familyId: nil, title: "Maths", status: "todo", dueDate: "2026-09-07", sourceType: "homework", sourceId: "today"),
            WatchAction(id: "brother", familyId: nil, title: "His job", status: "todo", dueDate: "2026-09-07", assigneeType: "kid", assigneeId: "other"),
            WatchAction(id: "future", familyId: nil, title: "Later", status: "todo", dueDate: "2026-09-09"),
        ]
        value.chores = [
            WatchChore(id: "c1", title: "Tidy room", amount: 5),
            WatchChore(id: "c2", title: "Dishes", amount: 3, status: "submitted", submittedAt: "2026-09-07T12:00:00Z"),
            WatchChore(id: "c3", title: "Old", amount: 3, status: "approved", approvedAt: "2026-09-01T09:00:00Z"),
        ]
        let items = WatchMyList.items(snapshot: value, now: now)
        XCTAssertEqual(items.filter { !$0.isDone }.map(\.id), ["homework:late", "homework:today", "action:bins", "action:undated", "fams:c1"])
        XCTAssertEqual(items.filter(\.isDone).map(\.id).sorted(), ["fams:c2", "homework:done"])
        XCTAssertEqual(WatchMyList.openCount(snapshot: value, now: now), 5)
        XCTAssertEqual(items.first { $0.id == "fams:c1" }?.famsAmount, 5)
        XCTAssertEqual(items.first { $0.id == "action:bins" }?.kind, .chore)
        XCTAssertTrue(items.first { $0.id == "fams:c2" }?.awaitingApproval == true)
        // Fams chores are kid-only.
        value.context?.profile.role = "parent"
        XCTAssertFalse(WatchMyList.items(snapshot: value, now: now).contains { $0.kind == .fams })
    }

    func testDoneSummaryCountsProgressFamsAndNext() {
        var value = snapshot()
        value.homework = [WatchHomework(id: "h", kidId: "own", title: "Maths", dueDate: "2026-09-07", dueTime: "15:00", status: "todo")]
        value.chores = [WatchChore(id: "c1", title: "Tidy room", amount: 5, status: "submitted", submittedAt: "2026-09-07T12:00:00Z")]
        let completed = WatchMyList.item(for: WatchChore(id: "c1", title: "Tidy room", amount: 5))
        let summary = WatchMyList.summary(after: completed, snapshot: value, now: now)
        XCTAssertEqual(summary.done, 1)
        XCTAssertEqual(summary.total, 2)
        XCTAssertEqual(summary.famsAmount, 5)
        XCTAssertEqual(summary.next, "Maths")
        XCTAssertEqual(summary.approver, "a parent")
    }

    @MainActor
    func testStoreFetchesChoresAndSubmitsThroughTheDurableOutbox() async throws {
        let api = ChoreAPI()
        api.chores = [WatchChore(id: "c1", title: "Tidy room", amount: 5)]
        let persistence = ChorePersistence()
        let store = WatchStore(api: api, credentials: ChoreCredentials(), persistence: persistence, initialState: WatchPersistedState())
        await store.refresh()
        XCTAssertEqual(store.snapshot.chores?.map(\.id), ["c1"])
        XCTAssertEqual(store.openTodoCount, 1)

        // Offline: the submit is saved and shown before the request fails.
        api.submitError = WatchAPIError.transport("offline")
        let summary = await store.completeMyListItem(WatchMyList.item(for: api.chores[0]))
        XCTAssertEqual(summary?.famsAmount, 5)
        XCTAssertEqual(store.snapshot.chores?.first?.status, "submitted")
        XCTAssertEqual(store.openTodoCount, 0)
        XCTAssertEqual(persistence.state?.outbox.map(\.kind), [.choreSubmit])
        XCTAssertEqual(store.pendingMutationCount, 1)

        // A refresh that still shows "pending" keeps the queued submit applied.
        await store.refresh()
        XCTAssertEqual(store.snapshot.chores?.first?.status, "submitted")

        api.submitError = nil
        await store.refresh()
        XCTAssertEqual(store.pendingMutationCount, 0)
        XCTAssertEqual(api.chores.first?.status, "submitted")

        // An approved chore (400) is dropped instead of blocking later work.
        api.chores.append(WatchChore(id: "c2", title: "Dishes", amount: 2))
        await store.refresh()
        api.submitError = WatchAPIError.http(400, "Chore already approved.")
        await store.submitChore(store.snapshot.chores!.first { $0.id == "c2" }!)
        XCTAssertEqual(store.pendingMutationCount, 0)
    }

    @MainActor
    func testParentsNeverFetchChoresAndComplicationCarriesNoTitles() async throws {
        let api = ChoreAPI()
        api.context.profile.role = "parent"
        api.chores = [WatchChore(id: "c1", title: "Tidy room", amount: 5)]
        let store = WatchStore(api: api, credentials: ChoreCredentials(), persistence: ChorePersistence(), initialState: WatchPersistedState())
        await store.refresh()
        XCTAssertNil(store.snapshot.chores)

        var value = snapshot()
        value.homework = [WatchHomework(id: "h", kidId: "own", title: "Secret essay", dueDate: "2026-09-07", dueTime: "15:00", status: "todo")]
        let kidStore = WatchStore(api: ChoreAPI(), credentials: ChoreCredentials(), persistence: ChorePersistence(),
                                  initialState: WatchPersistedState(snapshot: value))
        let aggregate = kidStore.complicationSnapshot(now: now)
        XCTAssertEqual(aggregate.todoTotal, 1)
        XCTAssertEqual(aggregate.todoDone, 0)
        XCTAssertEqual(aggregate.nextKind, "homework")
        XCTAssertEqual(aggregate.nextDueAt, WatchPlanDate.date("2026-09-07", "15:00"))
        let json = String(decoding: try JSONEncoder().encode(aggregate), as: UTF8.self)
        XCTAssertFalse(json.contains("Secret"))
        XCTAssertFalse(json.contains("title"))
        let old = try JSONDecoder().decode(FamETCWatchComplicationSnapshot.self, from: Data(#"{"urgentCount":1,"homeworkCount":0,"shoppingCount":0}"#.utf8))
        XCTAssertEqual(old.todoTotal, 0)
        XCTAssertNil(old.nextKind)
    }
}
