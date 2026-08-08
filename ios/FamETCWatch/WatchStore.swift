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
    @Published private(set) var snapshot: WatchSnapshot
    @Published private(set) var connection: WatchConnectionState
    @Published private(set) var lastError: String?
    @Published private(set) var pendingMutationCount: Int

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
        self.outbox = restored?.outbox ?? []
        self.pendingMutationCount = self.outbox.count
        self.connection = restored == nil ? .disconnected : .cached
        self.lastError = nil
    }

    var urgentActions: [WatchAction] { snapshot.urgentActions }
    var openHomework: [WatchHomework] { snapshot.openHomework }
    var openShopping: [WatchShoppingItem] { snapshot.openShopping }

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
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        connection = .refreshing
        lastError = nil
        defer { isRefreshing = false }

        guard credentialIsAvailable() else {
            connection = .disconnected
            return
        }

        // Mutations are sent in creation order before the read. If a request
        // fails, the entry remains durable and is reapplied below to any
        // successfully fetched section.
        _ = await drainOutbox()

        do {
            let sections = try await withWatchTimeout(seconds: 8) { [api] in
                async let actions = captureWatchSection { try await api.fetchActions() }
                async let homework = captureWatchSection { try await api.fetchHomework() }
                async let shopping = captureWatchSection { try await api.fetchShopping() }
                return await (actions, homework, shopping)
            }

            let actionResult = sections.0
            let homeworkResult = sections.1
            let shoppingResult = sections.2
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
            snapshot.updatedAt = Date()
            persist()

            if let error = errors.first {
                lastError = error.localizedDescription
                connection = .offline
            } else if outbox.isEmpty {
                connection = .connected
            } else {
                connection = .offline
            }
        } catch is CancellationError {
            // A cancelled foreground task is not an error and the durable
            // cache/outbox remain exactly as they were.
            if outbox.isEmpty { connection = .cached }
        } catch {
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

    func isPending(_ id: String, kind: WatchMutationKind) -> Bool {
        outbox.contains { $0.resourceID == id && $0.kind == kind }
    }

    private func enqueue(_ mutation: WatchMutation) async {
        apply(mutation, to: &snapshot)
        outbox.append(mutation)
        pendingMutationCount = outbox.count
        // This write is intentionally before credential lookup and before the
        // first call into URLSession.
        persist()

        guard credentialIsAvailable() else {
            connection = .disconnected
            return
        }
        _ = await drainOutbox()
    }

    @discardableResult
    private func drainOutbox() async -> Bool {
        guard !isDraining, !outbox.isEmpty else { return outbox.isEmpty }
        guard credentialIsAvailable() else {
            connection = .disconnected
            return false
        }

        isDraining = true
        defer { isDraining = false }

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
                    replace(updated)
                case .homeworkStatus:
                    let status = entry.stringValue ?? "done"
                    let updated = try await withWatchTimeout(seconds: 8) { [api] in
                        try await api.updateHomeworkStatus(entry.resourceID, status: status)
                    }
                    replace(updated)
                case .shoppingDone:
                    let done = entry.boolValue ?? true
                    let updated = try await withWatchTimeout(seconds: 8) { [api] in
                        try await api.updateShoppingDone(entry.resourceID, done: done)
                    }
                    replace(updated)
                }

                outbox.removeFirst()
                pendingMutationCount = outbox.count
                persist()
            } catch is CancellationError {
                return false
            } catch {
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

    private func persist() {
        persistence.save(WatchPersistedState(snapshot: snapshot, outbox: outbox))
        WatchComplicationSnapshotStore.save(FamETCWatchComplicationSnapshot(
            urgentCount: snapshot.urgentActions.count,
            homeworkCount: snapshot.openHomework.count,
            shoppingCount: snapshot.openShopping.count,
            updatedAt: snapshot.updatedAt
        ))
        WidgetCenter.shared.reloadTimelines(ofKind: "FamETCWatchComplication")
    }

    private func isForbidden(_ error: Error) -> Bool {
        if case WatchAPIError.forbidden = error { return true }
        return false
    }

    private func handleNetworkError(_ error: Error) {
        if case WatchAPIError.unauthenticated = error {
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
