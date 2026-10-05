import XCTest
@testable import FamETCWatch

private func supportFixture() -> WatchStudentSupport {
    WatchStudentSupport(schemaVersion: 1, familyId: "f", kidId: "k", enabled: true, revision: 0,
        timezone: "Asia/Bangkok", today: "2026-10-05", refreshedAt: "2026-10-05T03:00:00Z",
        preferences: .init(quietStart: "21:00", quietEnd: "07:00", homeworkTime: "16:30", packingTime: "19:30", morningTime: "07:00", focusMinutes: 10),
        packing: .init(date: "2026-10-06", coverage: "missing", items: [], complete: false),
        occurrences: [], homeworkPlans: [])
}
private final class SupportPersistence: WatchPersistence {
    var state: WatchPersistedState?
    var failWrites = false
    func load() -> WatchPersistedState? { state }
    func save(_ state: WatchPersistedState) { if !failWrites { self.state = state } }
    func clear() { state = nil }
}
private struct SupportCredentials: WatchCredentialStore {
    func credential() throws -> WatchCredential? { WatchCredential(value: "test") }
}
private final class SupportAPI: WatchAPIClient, WatchStudentSupportClient {
    var support = supportFixture()
    var failure: Error? = WatchAPIError.transport("offline")
    var commands: [WatchSupportCommand] = []
    var beforeSend: (() -> Void)?
    var delaySend: (() async -> Void)?
    var loseAcknowledgement = false
    var accepted: Set<String> = []
    func fetchStudentSupport() async throws -> WatchStudentSupport { support }
    func sendStudentSupport(_ command: WatchSupportCommand) async throws -> WatchStudentSupport {
        beforeSend?()
        commands.append(command)
        await delaySend?()
        if accepted.contains(command.id) { return support }
        if let failure { throw failure }
        guard command.expectedRevision == support.revision else { throw WatchAPIError.http(409, "changed") }
        support = support.projecting([command], profile: .init(role: "kid", userId: "u", familyId: "f", kidId: "k", name: "Child"))
        support.revision += 1
        accepted.insert(command.id)
        if loseAcknowledgement { loseAcknowledgement = false; throw WatchAPIError.transport("ack lost") }
        return support
    }
    func fetchActions() async throws -> [WatchAction] { [] }
    func fetchHomework() async throws -> [WatchHomework] { [] }
    func fetchShopping() async throws -> [WatchShoppingItem] { [] }
    func updateActionStatus(_ id: String, status: String) async throws -> WatchAction { throw WatchAPIError.forbidden }
    func updateHomeworkStatus(_ id: String, status: String) async throws -> WatchHomework { throw WatchAPIError.forbidden }
    func updateHomeworkChecklistStep(_ id: String, index: Int, done: Bool) async throws -> WatchHomework { throw WatchAPIError.forbidden }
    func updateShoppingDone(_ id: String, done: Bool) async throws -> WatchShoppingItem { throw WatchAPIError.forbidden }
}

@MainActor final class WatchStudentSupportTests: XCTestCase {
    private func state() -> WatchPersistedState {
        var snapshot = WatchSnapshot()
        snapshot.context = WatchContext(profile: .init(role: "kid", userId: "u", familyId: "f", kidId: "k", name: "Child"), events: [])
        snapshot.support = supportFixture()
        return WatchPersistedState(snapshot: snapshot)
    }
    func testOfflineRestartPreservesIdentityRevisionAndPersistBeforeSend() async {
        let disk = SupportPersistence(); disk.state = state()
        let api = SupportAPI()
        api.beforeSend = { XCTAssertFalse(disk.state?.supportOutbox?.isEmpty ?? true) }
        let store = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        await store.supportCommand("routine_status", .init(status: "done", occurrenceId: "r:2026-10-05"))
        await store.supportCommand("routine_step", .init(occurrenceId: "r:2026-10-05", stepId: "step", done: true))
        XCTAssertEqual(store.supportOutbox.map(\.expectedRevision), [0, 1])
        let ids = store.supportOutbox.map(\.id)
        let restored = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        XCTAssertEqual(restored.supportOutbox.map(\.id), ids)
        api.failure = nil
        await restored.refresh()
        XCTAssertTrue(restored.supportOutbox.isEmpty)
        XCTAssertEqual(restored.studentSupport?.revision, 2)
    }
    func testConflictStopsReplayAndRequiresExplicitDiscard() async {
        let disk = SupportPersistence(); disk.state = state()
        let api = SupportAPI()
        let store = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        await store.supportCommand("routine_status", .init(status: "done", occurrenceId: "r"))
        api.failure = nil; api.support.revision = 8
        await store.refresh()
        XCTAssertTrue(store.supportConflict)
        XCTAssertEqual(store.supportOutbox.count, 1)
        let calls = api.commands.count
        await store.refresh()
        XCTAssertEqual(api.commands.count, calls)
        await store.discardSupportChanges()
        XCTAssertFalse(store.supportConflict)
        XCTAssertTrue(store.supportOutbox.isEmpty)
        XCTAssertEqual(store.studentSupport?.revision, 8)
    }
    func testForeignPendingCommandCannotReplayAndResetClearsSupport() async {
        let disk = SupportPersistence(); disk.state = state()
        disk.state?.supportOutbox = [.init(userId: "other", familyId: "f", kidId: "k", expectedRevision: 0, type: "routine_status", payload: .init(status: "done", occurrenceId: "r"))]
        let api = SupportAPI(); api.failure = nil
        let store = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        await store.refresh()
        XCTAssertTrue(api.commands.isEmpty)
        XCTAssertTrue(store.supportConflict)
        store.resetLocalState()
        XCTAssertNil(store.studentSupport)
        XCTAssertTrue(store.supportOutbox.isEmpty)
        XCTAssertNil(disk.state)
    }
    func testOfflineProjectionToggleRestartAndWriteFailure() async {
        let disk = SupportPersistence(); disk.state = state()
        disk.state?.snapshot.support?.packing.items = [.init(id: "book", title: "Book", reasons: [], phase: "evening", status: "needed")]
        disk.state?.snapshot.support?.occurrences = [.init(id: "r", routineId: "routine", date: "2026-10-05", title: "Routine", time: "17:00", steps: [.init(id: "step", title: "Step", done: false)], status: "open")]
        let api = SupportAPI()
        let store = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        await store.supportCommand("packing_item", .init(date: "2026-10-06", itemId: "book", status: "packed"))
        XCTAssertEqual(store.studentSupport?.packing.items.first?.status, "packed")
        XCTAssertEqual(store.snapshot.support?.packing.items.first?.status, "needed")
        await store.supportCommand("routine_step", .init(occurrenceId: "r", stepId: "step", done: true))
        XCTAssertEqual(store.studentSupport?.occurrences.first?.steps.first?.done, true)
        let restored = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        XCTAssertEqual(restored.studentSupport?.packing.items.first?.status, "packed")
        let displayed = restored.studentSupport!.occurrences[0].steps[0].done
        await restored.supportCommand("routine_step", .init(occurrenceId: "r", stepId: "step", done: !displayed))
        XCTAssertEqual(restored.studentSupport?.occurrences.first?.steps.first?.done, false)
        XCTAssertEqual(restored.supportOutbox.suffix(2).map { $0.payload.done }, [true, false])
        let calls = api.commands.count
        let count = restored.supportOutbox.count
        disk.failWrites = true
        await restored.supportCommand("packing_item", .init(date: "2026-10-06", itemId: "book", status: "missing"))
        XCTAssertEqual(restored.supportOutbox.count, count)
        XCTAssertEqual(restored.studentSupport?.packing.items.first?.status, "packed")
        XCTAssertEqual(api.commands.count, calls)
        XCTAssertTrue(restored.supportError?.contains("not saved") == true)
    }

    func testDiscardDuringDelayedSendRetainsIntentUntilAcknowledged() async {
        let disk = SupportPersistence(); disk.state = state()
        let api = SupportAPI(); api.failure = nil
        let started = expectation(description: "send started")
        var resume: CheckedContinuation<Void, Never>?
        api.delaySend = {
            await withCheckedContinuation { continuation in resume = continuation; started.fulfill() }
        }
        let store = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        let task = Task { await store.supportCommand("routine_status", .init(status: "done", occurrenceId: "r")) }
        await fulfillment(of: [started], timeout: 2)
        await store.discardSupportChanges()
        XCTAssertEqual(store.supportOutbox.count, 1)
        XCTAssertEqual(disk.state?.supportOutbox?.count, 1)
        XCTAssertTrue(store.drainingSupport)
        resume?.resume()
        await task.value
        XCTAssertTrue(store.supportOutbox.isEmpty)
        XCTAssertEqual(store.studentSupport?.revision, 1)
    }

    func testAcknowledgementLossReusesCommandIDWithoutDoubleApply() async {
        let disk = SupportPersistence(); disk.state = state()
        let api = SupportAPI(); api.failure = nil; api.loseAcknowledgement = true
        let store = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        await store.supportCommand("routine_status", .init(status: "done", occurrenceId: "r"))
        XCTAssertEqual(api.support.revision, 1)
        XCTAssertEqual(store.supportOutbox.count, 1)
        let restored = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        await restored.refresh()
        XCTAssertTrue(restored.supportOutbox.isEmpty)
        XCTAssertEqual(api.commands.map(\.id).first, api.commands.map(\.id).last)
        XCTAssertEqual(api.accepted.count, 1)
        XCTAssertEqual(restored.studentSupport?.revision, 1)
    }

    func testAuthResetDuringDelayedSendDiscardsOldResponse() async {
        let disk = SupportPersistence(); disk.state = state()
        let api = SupportAPI(); api.failure = nil
        let started = expectation(description: "send started")
        var resume: CheckedContinuation<Void, Never>?
        api.delaySend = {
            await withCheckedContinuation { continuation in resume = continuation; started.fulfill() }
        }
        let store = WatchStore(api: api, credentials: SupportCredentials(), persistence: disk)
        let task = Task { await store.supportCommand("routine_status", .init(status: "done", occurrenceId: "r")) }
        await fulfillment(of: [started], timeout: 2)
        store.resetLocalState()
        resume?.resume()
        await task.value
        XCTAssertNil(store.studentSupport)
        XCTAssertTrue(store.supportOutbox.isEmpty)
        XCTAssertNil(disk.state)
        XCTAssertFalse(store.drainingSupport)
    }

    func testOfflinePackingNeverClearsUnmappedOrLegacyRequirements() throws {
        var support = supportFixture()
        support.packing.coverage = "verified"
        support.packing.message = "Some lessons have no material rule. Check with a parent."
        support.packing.items = [.init(id: "book", title: "Book", reasons: [], phase: "evening", status: "needed")]
        support.packing.requirementsConfirmed = false
        let profile = WatchProfile(role: "kid", userId: "u", familyId: "f", kidId: "k", name: "Child")
        let command = WatchSupportCommand(userId: "u", familyId: "f", kidId: "k", expectedRevision: 0,
            type: "packing_item", payload: .init(date: "2026-10-06", itemId: "book", status: "packed"))
        let projected = support.projecting([command], profile: profile)
        XCTAssertEqual(projected.packing.items.first?.status, "packed")
        XCTAssertFalse(projected.packing.complete)
        XCTAssertEqual(projected.packing.message, support.packing.message)
        // Older wire responses and disk caches omit the new optional field.
        support.packing.requirementsConfirmed = nil
        let legacy = try JSONDecoder().decode(WatchStudentSupport.self, from: JSONEncoder().encode(support))
        XCTAssertNil(legacy.packing.requirementsConfirmed)
        XCTAssertFalse(legacy.projecting([command], profile: profile).packing.complete)
        support.packing.requirementsConfirmed = true
        XCTAssertTrue(support.projecting([command], profile: profile).packing.complete)
    }

    func testPauseTimerRoundTripDoesNotCompleteHomework() throws {
        let start = Date(timeIntervalSince1970: 1000)
        var timer = WatchFocusSession(homeworkID: "h", titleSnapshot: "Homework", startedAt: start, duration: 300)
        timer.pausedAt = start.addingTimeInterval(60)
        let restored = try JSONDecoder().decode(WatchFocusSession.self, from: JSONEncoder().encode(timer))
        XCTAssertEqual(restored.remaining(at: start.addingTimeInterval(1000)), 240)
        XCTAssertFalse(restored.isComplete(at: start.addingTimeInterval(1000)))
        XCTAssertTrue(WatchReminderPlan.make(snapshot: WatchSnapshot(), focus: restored, now: start).isEmpty)
    }
    func testSupportCuesAreGenericOptInScopedFreshAndDoNotDuplicateHomework() {
        let now = ISO8601DateFormatter().date(from: "2026-10-05T03:00:00Z")!
        var snapshot = state().snapshot
        snapshot.updatedAt = now
        snapshot.homework = [.init(id: "h", kidId: "k", title: "Private homework title", dueDate: "2026-10-05", status: "todo")]
        XCTAssertTrue(WatchReminderPlan.make(snapshot: snapshot, focus: nil, now: now).isEmpty)
        snapshot.supportRemindersEnabled = true
        let cues = WatchReminderPlan.make(snapshot: snapshot, focus: nil, now: now)
        XCTAssertEqual(cues.map(\.id), ["fam_watch_support_homework"])
        XCTAssertTrue(cues.allSatisfy { $0.title == "My Next" && !$0.body.contains("Private") })
        snapshot.support?.preferences.quietStart = "16:00"
        snapshot.support?.preferences.quietEnd = "17:00"
        XCTAssertTrue(WatchReminderPlan.make(snapshot: snapshot, focus: nil, now: now).isEmpty)
        snapshot.support?.refreshedAt = "2026-10-01T03:00:00Z"
        XCTAssertTrue(WatchReminderPlan.make(snapshot: snapshot, focus: nil, now: now).isEmpty)
    }
}
