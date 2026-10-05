import Foundation
import Observation

protocol StudentSupportService {
    func studentSupport(kidID: String) async throws -> StudentSupportSnapshot
    func studentSupportCommand(_ command: SupportCommand) async throws -> StudentSupportSnapshot
}
extension APIClient: StudentSupportService {}

@MainActor @Observable final class StudentSupportStore {
    static let shared = StudentSupportStore()
    private(set) var acknowledged: StudentSupportSnapshot?
    var snapshot: StudentSupportSnapshot? {
        guard var projected = acknowledged else { return nil }
        for command in pending { projected.apply(command) }
        return projected
    }
    private(set) var pending: [SupportCommand] = []
    private(set) var scope: SupportScope?
    private(set) var busy = false
    private(set) var conflict = false
    var message: String?
    var timer = SupportTimer()
    private var generation = UUID()
    private var account: String?
    private var family: String?
    private struct Saved: Codable {
        var scope: SupportScope; var snapshot: StudentSupportSnapshot?
        var pending: [SupportCommand]; var timer: SupportTimer; var conflict: Bool
    }
    private let file: URL
    private let service: any StudentSupportService
    init(file: URL? = nil, service: any StudentSupportService = APIClient.shared) {
        self.service = service
        self.file = file ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("fam_student_support.json")
    }
    func accountChanged(userID: String?, familyID: String?) {
        guard let userID else { reset(); return }
        // AppStore restores user before family. A missing family during hydration
        // is not evidence of a switch; compare only confirmed identity parts.
        let savedScope = persistedScope()
        let previousUser = account ?? scope?.userID ?? savedScope?.userID
        let previousFamily = family ?? scope?.familyID ?? savedScope?.familyID
        let userChanged = previousUser.map { $0 != userID } ?? false
        let familyChanged = familyID.map { confirmed in
            previousFamily.map { $0 != confirmed } ?? false
        } ?? false
        if userChanged || familyChanged { reset() }
        account = userID
        if let familyID { family = familyID }
    }
    private func persistedScope() -> SupportScope? {
        guard let data = try? Data(contentsOf: file),
              let saved = try? JSONDecoder().decode(Saved.self, from: data) else { return nil }
        return saved.scope
    }
    func reset() {
        generation = UUID(); busy = false; acknowledged = nil; pending = []; scope = nil
        timer = SupportTimer(); conflict = false; message = nil; account = nil; family = nil
        try? FileManager.default.removeItem(at: file)
    }
    func recoverableKidID(userID: String, familyID: String) -> String? {
        guard let data = try? Data(contentsOf: file),
              let saved = try? JSONDecoder().decode(Saved.self, from: data),
              saved.scope.userID == userID, saved.scope.familyID == familyID else { return nil }
        return saved.scope.kidID
    }
    func select(_ newScope: SupportScope) {
        guard scope != newScope else { return }
        guard pending.isEmpty else { message = "Sync or discard pending changes before selecting another student."; return }
        generation = UUID(); busy = false; acknowledged = nil; pending = []; conflict = false
        timer = SupportTimer(); message = nil; scope = newScope
        if let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode(Saved.self, from: data), saved.scope == newScope {
            acknowledged = saved.snapshot; pending = saved.pending; timer = saved.timer; conflict = saved.conflict
            message = "Saved on this device. Refresh to check for changes."
        }
    }
    private func save() throws {
        guard let scope else { return }
        let data = try JSONEncoder().encode(Saved(scope: scope, snapshot: acknowledged, pending: pending, timer: timer, conflict: conflict))
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: file, options: [.atomic, .completeFileProtection])
        var url = file; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }
    func saveTimer() { do { try save() } catch { message = "Timer could not be saved on this device." } }
    func refresh() async {
        guard !busy, let scope else { return }
        if !pending.isEmpty { await sync(); return }
        let epoch = generation; busy = true
        defer { if generation == epoch { busy = false } }
        do {
            let fresh = try await service.studentSupport(kidID: scope.kidID)
            guard generation == epoch, fresh.familyId == scope.familyID, fresh.kidId == scope.kidID else { return }
            acknowledged = fresh; message = nil; try save()
        } catch { if generation == epoch { message = "Could not refresh. Saved information may be out of date. \(error.localizedDescription)" } }
    }
    func send(_ type: String, _ payload: [String: Any]) async {
        guard !conflict, let scope, let acknowledged else { return }
        do {
            let command = SupportCommand(id: UUID().uuidString, scope: scope,
                expectedRevision: acknowledged.revision + pending.count, type: type,
                payload: try JSONSerialization.data(withJSONObject: payload))
            pending.append(command)
            do { try save() } catch { pending.removeLast(); throw error }
            await sync()
        } catch { message = "Change was not saved: \(error.localizedDescription)" }
    }
    func sync() async {
        guard !busy, !conflict, let scope else { return }
        let epoch = generation; busy = true
        defer { if generation == epoch { busy = false } }
        while let command = pending.first {
            guard command.scope == scope else { conflict = true; message = "Account mismatch. Discard saved changes before continuing."; return }
            do {
                let fresh = try await service.studentSupportCommand(command)
                guard generation == epoch, fresh.familyId == scope.familyID, fresh.kidId == scope.kidID else { return }
                let previous = acknowledged
                let oldPending = pending
                acknowledged = fresh; pending.removeFirst()
                if !pending.isEmpty && fresh.revision != command.expectedRevision + 1 {
                    conflict = true; message = "Another device changed this plan. Review and discard remaining saved changes before trying again."
                } else { message = pending.isEmpty ? nil : "Syncing saved changes…" }
                do { try save() } catch {
                    acknowledged = previous; pending = oldPending
                    throw error
                }
                if conflict { return }
            } catch {
                guard generation == epoch else { return }
                if case APIError.http(409, _) = error { conflict = true }
                message = conflict ? "This plan changed on another device. Your pending changes have not been overwritten. Discard them and reload to review the current plan." : "Saved changes are waiting to sync. \(error.localizedDescription)"
                try? save(); return
            }
        }
    }
    func discardAndReload() async {
        guard !busy else { return }
        let previous = pending; let wasConflict = conflict
        pending = []; conflict = false
        do { try save(); await refresh() } catch {
            pending = previous; conflict = wasConflict; message = error.localizedDescription
        }
    }
}
