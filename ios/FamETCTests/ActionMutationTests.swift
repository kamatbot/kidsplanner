import XCTest
@testable import FamETC

@MainActor
final class ActionMutationTests: XCTestCase {
    private final class HeldService: FamilyActionService {
        let started: XCTestExpectation
        var continuation: CheckedContinuation<FamilyAction, Error>?
        init(started: XCTestExpectation) { self.started = started }
        func familyActions() async throws -> [FamilyAction] { [] }
        func updateFamilyAction(_ id: String, status: String, snoozedUntil: String?) async throws -> FamilyAction {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                started.fulfill()
            }
        }
    }

    func testCancelledCompletionAndSnoozeCannotRestoreActionAfterSignOut() async {
        for snooze in [false, true] {
            let started = expectation(description: "Mutation suspended")
            let service = HeldService(started: started)
            let store = makeStore(service)
            let original = item()
            store.actions = [original]
            let pending = Task {
                if snooze { await store.snoozeAction(original, preset: .tomorrow) }
                else { await store.completeAction(original) }
            }
            await fulfillment(of: [started], timeout: 2)
            XCTAssertEqual(store.actions.first?.status, snooze ? "snoozed" : "done")
            store.signedOut()
            service.continuation?.resume(throwing: CancellationError())
            await pending.value
            XCTAssertTrue(store.actions.isEmpty)
            XCTAssertNil(store.actionError)
            XCTAssertNil(store.me)
            XCTAssertTrue(store.completingActionIDs.isEmpty)
        }
    }

    func testLateSuccessCannotOverwriteAnotherAccountOrReleaseItsLock() async {
        for snooze in [false, true] {
            let started = expectation(description: "Mutation suspended")
            let service = HeldService(started: started)
            let store = makeStore(service)
            let original = item()
            store.actions = [original]
            let pending = Task {
                if snooze { await store.snoozeAction(original, preset: .tomorrow) }
                else { await store.completeAction(original) }
            }
            await fulfillment(of: [started], timeout: 2)
            store.me = User(id: "parent-2", email: "other@example.invalid", role: "parent")
            var replacement = original
            replacement.title = "New account snapshot"
            store.actions = [replacement]
            store.actionError = "New account error"
            store.completingActionIDs = [original.id]
            var response = original
            response.status = snooze ? "snoozed" : "done"
            service.continuation?.resume(returning: response)
            await pending.value
            XCTAssertEqual(store.actions.first?.title, replacement.title)
            XCTAssertEqual(store.actions.first?.status, "open")
            XCTAssertEqual(store.actionError, "New account error")
            XCTAssertTrue(store.completingActionIDs.contains(original.id))
        }
    }

    func testLateFailureCannotContaminateReturnedSameAccountSession() async {
        let started = expectation(description: "Mutation suspended")
        let service = HeldService(started: started)
        let store = makeStore(service)
        let original = item()
        store.actions = [original]
        let pending = Task { await store.completeAction(original) }
        await fulfillment(of: [started], timeout: 2)
        let previousUser = store.me
        store.me = User(id: "parent-2", email: "other@example.invalid", role: "parent")
        store.me = previousUser
        store.actions = []
        service.continuation?.resume(throwing: APIError.unauthenticated)
        await pending.value
        XCTAssertTrue(store.actions.isEmpty)
        XCTAssertNil(store.actionError)
        XCTAssertFalse(store.needsAuth)
    }

    private func makeStore(_ service: HeldService) -> AppStore {
        let store = AppStore(actionService: service)
        store.me = User(id: "parent-1", email: "parent@example.invalid", role: "parent")
        store.family = Family(id: "family", name: "Test", inviteCode: nil,
                              parentIds: ["parent-1", "parent-2"], kids: [], createdAt: "2026-09-26T00:00:00Z")
        return store
    }
    private func item() -> FamilyAction {
        FamilyAction(id: "action", familyId: "family", title: "Original", notes: nil,
                     status: "open", dueDate: "2026-09-26", dueTime: nil,
                     assigneeType: "family", assigneeId: nil, kidId: nil, sourceType: "manual",
                     sourceId: nil, createdBy: "parent-1", createdAt: "2026-09-26T00:00:00Z",
                     updatedAt: nil, snoozedUntil: nil)
    }
}
