import SwiftUI

@MainActor
protocol FamsService {
    func famsWallet(kidId: String) async throws -> FamsWallet
    func famsLessons(kidId: String) async throws -> [FamsLesson]
    func answerFamsLesson(kidId: String, lessonId: String, answerId: String) async throws -> FamsAnswer
    func submitFamsChore(kidId: String, choreId: String) async throws
    func saveFamsGoal(kidId: String, name: String, target: Int) async throws
}
extension APIClient: FamsService {}

@MainActor @Observable
final class FamsStore {
    private let service: any FamsService
    private var revision = 0
    var wallet: FamsWallet?
    var lessons: [FamsLesson] = []
    var loading = false
    var saving = false
    var error: String?
    var feedback: String?
    var celebration = 0
    var earned: Double = 0
    init(service: any FamsService = APIClient.shared) { self.service = service }

    func clear() {
        revision += 1; wallet = nil; lessons = []; loading = false
        error = nil; feedback = nil; earned = 0
    }
    func load(kidId: String, includeLessons: Bool = true) async {
        revision += 1; let token = revision
        if wallet?.kidId != kidId { wallet = nil; lessons = [] }
        loading = true; error = nil
        defer { if token == revision { loading = false } }
        do {
            let loaded = try await service.famsWallet(kidId: kidId)
            guard token == revision, !Task.isCancelled else { return }
            guard loaded.kidId == kidId else { error = "Rewards belong to a different child. Please try again."; return }
            wallet = loaded
            if includeLessons {
                let items = try await service.famsLessons(kidId: kidId)
                guard token == revision, !Task.isCancelled else { return }
                lessons = items
            }
        } catch { if token == revision, !Task.isCancelled { self.error = error.localizedDescription } }
        if token == revision { loading = false }
    }
    func answer(_ lesson: FamsLesson, option: String, kidId: String) async -> FamsAnswer? {
        guard !saving, wallet?.kidId == kidId else { return nil }
        saving = true; error = nil; let token = revision
        defer { saving = false }
        do {
            let result = try await service.answerFamsLesson(kidId: kidId, lessonId: lesson.id, answerId: option)
            guard token == revision, !Task.isCancelled else { return nil }
            if result.correct {
                if let index = lessons.firstIndex(where: { $0.id == lesson.id }) { lessons[index].completed = true }
                earned = max(0, result.awarded ?? 0)
                feedback = earned > 0 ? "+\(famsAmount(earned)) fams. Nicely done!" : "Lesson complete. Today’s reward may already be earned."
                if earned > 0 { celebration += 1 }
                // A successful answer stays successful even if the balance refresh fails.
                do {
                    let updated = try await service.famsWallet(kidId: kidId)
                    if token == revision, !Task.isCancelled, updated.kidId == kidId { wallet = updated }
                } catch { if token == revision { self.error = "Your answer is saved. Pull to refresh your balance." } }
            }
            return result
        } catch { if token == revision { self.error = error.localizedDescription }; return nil }
    }
    func submit(_ chore: FamsWallet.Chore, kidId: String) async {
        guard !saving, wallet?.kidId == kidId else { return }
        saving = true; let token = revision; error = nil
        defer { saving = false }
        do {
            try await service.submitFamsChore(kidId: kidId, choreId: chore.id)
            guard token == revision, !Task.isCancelled else { return }
            feedback = "Sent to your parent. Your fams arrive after approval."
            await load(kidId: kidId)
        } catch { if token == revision { self.error = error.localizedDescription } }
    }
    func saveGoal(kidId: String, name: String, target: Int) async -> Bool {
        guard !saving, wallet?.kidId == kidId else { return false }
        saving = true; let token = revision; error = nil
        defer { saving = false }
        do {
            try await service.saveFamsGoal(kidId: kidId, name: name, target: target)
            guard token == revision, !Task.isCancelled else { return false }
            await load(kidId: kidId)
            return true
        } catch { if token == revision { self.error = error.localizedDescription }; return false }
    }
}
