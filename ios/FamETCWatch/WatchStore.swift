import Combine
import Foundation
import WidgetKit

enum WatchConnectionState: Equatable {
    case disconnected
    case cached
    case refreshing
    case connected
    case offline

    var label: String {
        switch self {
        case .disconnected: return "Disconnected"
        case .cached: return "Saved on watch"
        case .refreshing: return "Refreshing"
        case .connected: return "Up to date"
        case .offline: return "Offline — changes saved"
        }
    }
}

private struct WatchSectionResult<Value> {
    let value: Value?
    let error: Error?
}

private func captureWatchSection<Value>(
    _ operation: @escaping () async throws -> Value
) async -> WatchSectionResult<Value> {
    do {
        return WatchSectionResult(value: try await operation(), error: nil)
    } catch {
        return WatchSectionResult(value: nil, error: error)
    }
}

/// Main-actor state for the standalone My next surface. The store has three
/// important ordering guarantees:
///
/// 1. cache + outbox are loaded before the first refresh;
/// 2. an optimistic mutation is persisted before its request is attempted;
/// 3. a failed request leaves its ledger entry in place for a later explicit
///    foreground refresh.
@MainActor
final class WatchStore: ObservableObject {
    static let shared = WatchStore()
    @Published private(set) var snapshot: WatchSnapshot
    @Published private(set) var focusSession: WatchFocusSession?
    @Published private(set) var connection: WatchConnectionState
    @Published private(set) var lastError: String?
    @Published private(set) var pendingMutationCount: Int

    @Published private(set) var reminderStatus = "Turn on gentle reminders"
    @Published private(set) var needsConnection = false
    private var connectionEpoch = 0

    private let api: WatchAPIClient
    private let credentials: WatchCredentialStore
    private let persistence: WatchPersistence
    private var outbox: [WatchMutation]
    private var isRefreshing = false
    private var isDraining = false
    private var foregroundRefreshUsed = false

    init(api: WatchAPIClient = URLSessionWatchAPIClient(),
         credentials: WatchCredentialStore = KeychainWatchCredentialStore(),
         persistence: WatchPersistence = FileWatchPersistence(),
         initialState: WatchPersistedState? = nil) {
        self.api = api
        self.credentials = credentials
        self.persistence = persistence

        let restored = initialState ?? persistence.load()
        self.snapshot = restored?.snapshot ?? WatchSnapshot()
        self.focusSession = restored?.focusSession
        self.outbox = restored?.outbox ?? []
        self.pendingMutationCount = self.outbox.count
        self.connection = restored == nil ? .disconnected : .cached
        self.lastError = nil
    }

    var urgentActions: [WatchAction] { snapshot.urgentActions }
    var openHomework: [WatchHomework] { snapshot.openHomework }
    var openShopping: [WatchShoppingItem] { snapshot.openShopping }
    var focusHomework: WatchHomework? { snapshot.focusHomework }

    func focusRemaining(at date: Date = Date()) -> TimeInterval {
        focusSession?.remaining(at: date) ?? 0
    }

    func focusIsComplete(at date: Date = Date()) -> Bool {
        focusSession?.isComplete(at: date) ?? false
    }

    func focusCompletionNeedsAcknowledgement(at date: Date = Date()) -> Bool {
        guard let focusSession else { return false }
        return focusSession.isComplete(at: date) && !focusSession.completionAcknowledged
    }

    func endForegroundSession() {
        foregroundRefreshUsed = false
    }

    /// Call once when the watch becomes active. There is intentionally no
    /// timer, long poll, background loop, or WatchConnectivity dependency.
    func refreshForForeground() async {
        guard !foregroundRefreshUsed else { return }
        foregroundRefreshUsed = true
        await refresh()
    }

    /// Pull-to-refresh and a foreground activation share this one bounded path.
    func refresh(replayMutations: Bool = true) async {
        guard !isRefreshing else { return }
        isRefreshing = true
        let epoch = connectionEpoch
        connection = .refreshing
        lastError = nil
        defer { if epoch == connectionEpoch { isRefreshing = false } }

        guard credentialIsAvailable() else {
            connection = .disconnected
            return
        }

        var contextFresh = !(api is WatchContextClient)
        if let contextClient = api as? WatchContextClient {
            do {
                let context = try await withWatchTimeout(seconds: 8) { try await contextClient.fetchContext() }
                guard epoch == connectionEpoch else { return }
                if let previous = snapshot.context?.profile,
                   previous.userId != context.profile.userId || previous.familyId != context.profile.familyId {
                    resetLocalState()
                    needsConnection = true
                    lastError = "The watch account changed. Please reconnect."
                    return
                }
                snapshot.context = context
                contextFresh = true
            } catch {
                guard epoch == connectionEpoch else { return }
                if case WatchAPIError.unauthenticated = error {
                    resetLocalState()
                    needsConnection = true
                    lastError = "Reconnect this watch with a new FamETC code."
                    return
                }
                // Keep the last role-scoped context when offline; never replace
                // it with empty data or claim that stale lessons are fresh.
                lastError = error.localizedDescription
            }
        }
        guard epoch == connectionEpoch else { return }

        // Mutations are sent in creation order before the read. If a request
        // fails, the entry remains durable and is reapplied below to any
        // successfully fetched section.
        if replayMutations { _ = await drainOutbox() }
        guard epoch == connectionEpoch else { return }

        do {
            let sections = try await withWatchTimeout(seconds: 8) { [api] in
                async let actions = captureWatchSection { try await api.fetchActions() }
                async let homework = captureWatchSection { try await api.fetchHomework() }
                async let shopping = captureWatchSection { try await api.fetchShopping() }
                return await (actions, homework, shopping)
            }

            guard epoch == connectionEpoch else { return }
            let actionResult = sections.0
            let homeworkResult = sections.1
            let shoppingResult = sections.2
            // Revocation wins over a concurrently successful section.
            if [actionResult.error, homeworkResult.error, shoppingResult.error].contains(where: {
                if case WatchAPIError.unauthenticated? = $0 { return true }
                return false
            }) { throw WatchAPIError.unauthenticated }
            var successfulSections = 0
            var errors: [Error] = []

            if let actions = actionResult.value {
                snapshot.actions = actions
                successfulSections += 1
            } else if let error = actionResult.error {
                errors.append(error)
            }
            if let homework = homeworkResult.value {
                snapshot.homework = homework
                successfulSections += 1
            } else if let error = homeworkResult.error {
                errors.append(error)
            }
            if let shopping = shoppingResult.value {
                snapshot.shopping = shopping
                successfulSections += 1
            } else if let error = shoppingResult.error {
                // Meals is parent-gated on the server. Keep any cached list for
                // a kid or a partially provisioned credential instead of
                // turning an otherwise useful My next refresh into a failure.
                if !isForbidden(error) { errors.append(error) }
            }

            guard successfulSections > 0 else {
                throw errors.first ?? WatchAPIError.transport("No watch data was refreshed.")
            }

            snapshot = applyingPendingMutations(to: snapshot)
            if contextFresh { snapshot.updatedAt = Date() }
            persist()

            if let error = errors.first {
                lastError = error.localizedDescription
                connection = .offline
            } else if lastError != nil {
                connection = .offline
            } else if outbox.isEmpty {
                connection = .connected
            } else {
                connection = .offline
            }
        } catch is CancellationError {
            guard epoch == connectionEpoch else { return }
            // A cancelled foreground task is not an error and the durable
            // cache/outbox remain exactly as they were.
            if outbox.isEmpty { connection = .cached }
        } catch {
            guard epoch == connectionEpoch else { return }
            handleNetworkError(error)
        }
    }

    func completeAction(_ action: WatchAction) async {
        guard !action.isDone else { return }
        let mutation = WatchMutation(
            kind: .actionStatus,
            resourceID: action.id,
            stringValue: "done"
        )
        await enqueue(mutation)
    }

    func toggleHomework(_ item: WatchHomework) async {
        let mutation = WatchMutation(
            kind: .homeworkStatus,
            resourceID: item.id,
            stringValue: item.isDone ? "todo" : "done"
        )
        await enqueue(mutation)
    }

    func toggleShopping(_ item: WatchShoppingItem) async {
        let mutation = WatchMutation(
            kind: .shoppingDone,
            resourceID: item.id,
            boolValue: !item.done
        )
        await enqueue(mutation)
    }

    /// Start the one local focus block the watch can hold. The focus record is
    /// saved synchronously before the optional status mutation can touch the
    /// network, so suspension at any point still restores the block.
    func startFocus(on homework: WatchHomework, checklistIndex: Int? = nil) async {
        guard focusSession == nil else { return }

        let selectedIndex: Int?
        if let checklistIndex, homework.checklist.indices.contains(checklistIndex) {
            selectedIndex = checklistIndex
        } else {
            selectedIndex = homework.firstIncompleteChecklistIndex
        }
        focusSession = WatchFocusSession(
            homeworkID: homework.id,
            checklistIndex: selectedIndex,
            titleSnapshot: homework.title
        )
        // Persist focus before awaiting status replay or checking credentials.
        persist()

        guard let current = snapshot.homework.first(where: { $0.id == homework.id }),
              current.status == "todo",
              !outbox.contains(where: { $0.kind == .homeworkStatus && $0.resourceID == homework.id }) else {
            return
        }

        await enqueue(WatchMutation(
            kind: .homeworkStatus,
            resourceID: homework.id,
            stringValue: "in_progress"
        ))
    }

    /// Convenience spelling for callers that already use the noun-first form.
    func startFocus(homework: WatchHomework, checklistIndex: Int? = nil) async {
        await startFocus(on: homework, checklistIndex: checklistIndex)
    }

    /// Mark one explicit checklist index done. Desired state is carried in the
    /// outbox instead of a toggle, making timeout/replay safe.
    func markHomeworkStepDone(_ homework: WatchHomework, index: Int) async {
        guard homework.checklist.indices.contains(index), !homework.checklist[index].done else { return }
        await enqueueHomeworkStepDone(homework, index: index)
    }

    func markSelectedStepDone() async {
        guard let focusSession,
              let index = focusSession.checklistIndex,
              let homework = snapshot.homework.first(where: { $0.id == focusSession.homeworkID }) else {
            return
        }
        guard homework.checklist.indices.contains(index), !homework.checklist[index].done else { return }
        // `enqueue` persists the optimistic step and outbox before invoking
        // this callback. Ending focus here makes the root advance immediately,
        // including when the request must wait for a later offline retry.
        await enqueueHomeworkStepDone(homework, index: index) { [weak self] in
            self?.endFocus()
        }
    }

    /// Acknowledgement is a durable one-shot gate for the completion haptic.
    /// The view plays the haptic only when this returns true.
    @discardableResult
    func acknowledgeFocusCompletion(at date: Date = Date()) -> Bool {
        guard var session = focusSession,
              session.isComplete(at: date),
              !session.completionAcknowledged else {
            return false
        }
        session.completionAcknowledged = true
        focusSession = session
        persist()
        return true
    }

    func endFocus() {
        guard focusSession != nil else { return }
        focusSession = nil
        persist()
    }

    /// Explicit assignment completion remains separate from both focus timer
    /// expiry and checklist progress. Neither of those events auto-completes
    /// homework.
    func finishAssignment(_ homework: WatchHomework) async {
        guard !homework.isDone else { return }
        if focusSession?.homeworkID == homework.id {
            endFocus()
        }
        await enqueue(WatchMutation(
            kind: .homeworkStatus,
            resourceID: homework.id,
            stringValue: "done"
        ))
    }

    func isPending(_ id: String, kind: WatchMutationKind) -> Bool {
        outbox.contains { $0.resourceID == id && $0.kind == kind }
    }

    private func enqueue(_ mutation: WatchMutation,
                         afterPersist: (() -> Void)? = nil) async {
        apply(mutation, to: &snapshot)
        outbox.append(mutation)
        pendingMutationCount = outbox.count
        // This write is intentionally before credential lookup and before the
        // first call into URLSession.
        persist()
        afterPersist?()

        guard credentialIsAvailable() else {
            connection = .disconnected
            return
        }
        _ = await drainOutbox()
    }

    private func enqueueHomeworkStepDone(_ homework: WatchHomework,
                                         index: Int,
                                         afterPersist: (() -> Void)? = nil) async {
        await enqueue(WatchMutation(
            kind: .homeworkChecklistStep,
            resourceID: homework.id,
            boolValue: true,
            index: index
        ), afterPersist: afterPersist)
    }

    @discardableResult
    private func drainOutbox() async -> Bool {
        guard !isDraining, !outbox.isEmpty else { return outbox.isEmpty }
        guard credentialIsAvailable() else {
            connection = .disconnected
            return false
        }

        isDraining = true
        let epoch = connectionEpoch
        defer { if epoch == connectionEpoch { isDraining = false } }

        // Always operate on the head entry. A later mutation must not overtake
        // an earlier one if the watch was offline between two taps.
        while let entry = outbox.first {
            do {
                switch entry.kind {
                case .actionStatus:
                    let status = entry.stringValue ?? "done"
                    let updated = try await withWatchTimeout(seconds: 8) { [api] in
                        try await api.updateActionStatus(entry.resourceID, status: status)
                    }
                    guard epoch == connectionEpoch else { return false }
                    replace(updated)
                case .homeworkStatus:
                    let status = entry.stringValue ?? "done"
                    let updated = try await withWatchTimeout(seconds: 8) { [api] in
                        try await api.updateHomeworkStatus(entry.resourceID, status: status)
                    }
                    guard epoch == connectionEpoch else { return false }
                    replace(updated)
                case .shoppingDone:
                    let done = entry.boolValue ?? true
                    let updated = try await withWatchTimeout(seconds: 8) { [api] in
                        try await api.updateShoppingDone(entry.resourceID, done: done)
                    }
                    guard epoch == connectionEpoch else { return false }
                    replace(updated)
                case .homeworkChecklistStep:
                    guard let index = entry.index else { throw WatchAPIError.decoding("Checklist mutation has no index.") }
                    let done = entry.boolValue ?? true
                    let updated = try await withWatchTimeout(seconds: 8) { [api] in
                        try await api.updateHomeworkChecklistStep(entry.resourceID, index: index, done: done)
                    }
                    guard epoch == connectionEpoch else { return false }
                    replace(updated)
                }

                outbox.removeFirst()
                pendingMutationCount = outbox.count
                persist()
            } catch is CancellationError {
                return false
            } catch {
                guard epoch == connectionEpoch else { return false }
                handleNetworkError(error)
                return false
            }
        }

        if !isRefreshing {
            connection = .connected
            lastError = nil
        }
        return true
    }

    private func credentialIsAvailable() -> Bool {
        do {
            guard let credential = try credentials.credential(), !credential.value.isEmpty else {
                return false
            }
            return true
        } catch {
            lastError = WatchAPIError.credential(error.localizedDescription).localizedDescription
            return false
        }
    }

    private func applyingPendingMutations(to source: WatchSnapshot) -> WatchSnapshot {
        var result = source
        for mutation in outbox {
            apply(mutation, to: &result)
        }
        return result
    }

    private func apply(_ mutation: WatchMutation, to snapshot: inout WatchSnapshot) {
        switch mutation.kind {
        case .actionStatus:
            guard let index = snapshot.actions.firstIndex(where: { $0.id == mutation.resourceID }) else { return }
            snapshot.actions[index].status = mutation.stringValue ?? "done"
        case .homeworkStatus:
            guard let index = snapshot.homework.firstIndex(where: { $0.id == mutation.resourceID }) else { return }
            snapshot.homework[index].status = mutation.stringValue ?? "done"
        case .shoppingDone:
            guard let index = snapshot.shopping.firstIndex(where: { $0.id == mutation.resourceID }) else { return }
            snapshot.shopping[index].done = mutation.boolValue ?? true
        case .homeworkChecklistStep:
            guard let homeworkIndex = snapshot.homework.firstIndex(where: { $0.id == mutation.resourceID }),
                  let checklistIndex = mutation.index,
                  snapshot.homework[homeworkIndex].checklist.indices.contains(checklistIndex) else { return }
            snapshot.homework[homeworkIndex].checklist[checklistIndex].done = mutation.boolValue ?? true
        }
    }

    private func replace(_ action: WatchAction) {
        guard let index = snapshot.actions.firstIndex(where: { $0.id == action.id }) else { return }
        snapshot.actions[index] = action
    }

    private func replace(_ homework: WatchHomework) {
        guard let index = snapshot.homework.firstIndex(where: { $0.id == homework.id }) else { return }
        snapshot.homework[index] = homework
    }

    private func replace(_ shopping: WatchShoppingItem) {
        guard let index = snapshot.shopping.firstIndex(where: { $0.id == shopping.id }) else { return }
        snapshot.shopping[index] = shopping
    }

    func resetLocalState() {
        connectionEpoch += 1
        isRefreshing = false
        isDraining = false
        foregroundRefreshUsed = false
        snapshot = WatchSnapshot()
        outbox = []
        focusSession = nil
        pendingMutationCount = 0
        connection = .disconnected
        needsConnection = false
        lastError = nil
        persistence.clear()
        WatchComplicationSnapshotStore.save(.empty)
        WidgetCenter.shared.reloadAllTimelines()
        Task { await WatchReminders.shared.clear() }
    }

    func enableReminders() async {
        let granted = await WatchReminders.shared.authorize()
        if granted { WatchPushRegistrationService.shared.requestAuthorizationAndRegister() }
        reminderStatus = await WatchReminders.shared.refresh(snapshot: snapshot, focus: focusSession)
    }

    private func persist() {
        let savedSnapshot = snapshot
        let savedFocus = focusSession
        let epoch = connectionEpoch
        Task {
            guard epoch == connectionEpoch else { return }
            let status = await WatchReminders.shared.refresh(snapshot: savedSnapshot, focus: savedFocus)
            guard epoch == connectionEpoch else { return }
            reminderStatus = status
        }
        persistence.save(WatchPersistedState(
            snapshot: snapshot,
            outbox: outbox,
            focusSession: focusSession
        ))
        WatchComplicationSnapshotStore.save(FamETCWatchComplicationSnapshot(
            urgentCount: snapshot.urgentActions.count,
            homeworkCount: snapshot.openHomework.count,
            shoppingCount: snapshot.openShopping.count,
            updatedAt: snapshot.updatedAt,
            focusActive: focusSession != nil && !(focusSession?.isComplete() ?? true),
            focusEndsAt: focusSession?.endsAt
        ))
        WidgetCenter.shared.reloadTimelines(ofKind: "FamETCWatchComplication")
    }

    private func isForbidden(_ error: Error) -> Bool {
        if case WatchAPIError.forbidden = error { return true }
        return false
    }

    private func handleNetworkError(_ error: Error) {
        if case WatchAPIError.unauthenticated = error {
            resetLocalState()
            needsConnection = true
            connection = .disconnected
        } else if case WatchAPIError.disconnected = error {
            connection = .disconnected
        } else if case WatchAPIError.credential = error {
            connection = .disconnected
        } else {
            connection = .offline
        }
        lastError = error.localizedDescription
    }
}

private func withWatchTimeout<Value>(
    seconds: UInt64,
    operation: @escaping () async throws -> Value
) async throws -> Value {
    try await withThrowingTaskGroup(of: Value.self) { group in
        group.addTask {
            try await operation()
        }
        group.addTask {
            try await Task.sleep(nanoseconds: seconds * 1_000_000_000)
            throw WatchAPIError.timedOut
        }
        defer { group.cancelAll() }
        guard let result = try await group.next() else {
            throw WatchAPIError.timedOut
        }
        return result
    }
}
