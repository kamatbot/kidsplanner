import XCTest
@testable import FamETC

@MainActor final class FamsTests: XCTestCase {
    func testWalletContractAndProgressClamping() throws {
        let data = Data(#"{"kidId":"arya","isParent":false,"balance":500,"totalEarned":500,"weekly":{"earned":301,"limit":300,"weekStart":"2026-09-07"},"goal":{"name":"Board","target":400},"schoolPoints":{"current":10,"highWater":10,"resetPending":false},"chores":[],"transactions":[{"id":"1","amount":500,"reason":"School house points","createdAt":"2026-09-12"}],"completedLessons":[]}"#.utf8)
        let wallet = try JSONDecoder().decode(FamsWallet.self, from: data)
        XCTAssertEqual(wallet.weeklyFraction, 1)
        XCTAssertEqual(wallet.goalFraction, 1)
        XCTAssertEqual(wallet.transactions.first?.amount, 500)
    }
    func testOnlyNewServerAwardCelebrates() async throws {
        let model = FamsStore(service: FamsPreviewService())
        await model.load(kidId: "arya")
        let lesson = try XCTUnwrap(model.lessons.first { $0.id == "buffer" })
        XCTAssertFalse(lesson.completed)
        let wrong = await model.answer(lesson, option: "0", kidId: "arya")
        XCTAssertFalse(wrong!.correct)
        XCTAssertEqual(model.celebration, 0)
        let first = await model.answer(lesson, option: "1", kidId: "arya")
        XCTAssertEqual(first?.awarded, 2)
        XCTAssertEqual(model.wallet?.balance, 682)
        XCTAssertEqual(model.celebration, 1)
        let repeated = await model.answer(lesson, option: "1", kidId: "arya")
        XCTAssertEqual(repeated?.awarded, 0)
        XCTAssertEqual(model.celebration, 1)
    }
    func testChoreSubmissionDoesNotCreditReward() async {
        let model = FamsStore(service: FamsPreviewService())
        await model.load(kidId: "arya")
        await model.submit(model.wallet!.chores[0], kidId: "arya")
        XCTAssertEqual(model.wallet?.chores[0].status, "submitted")
        XCTAssertEqual(model.wallet?.balance, 680)
        XCTAssertEqual(model.celebration, 0)
    }
    func testAccountChangeDiscardsLateWallet() async {
        let model = FamsStore(service: DelayedFamsService())
        let task = Task { await model.load(kidId: "arya") }
        await Task.yield()
        model.clear()
        await task.value
        XCTAssertNil(model.wallet)
        XCTAssertTrue(model.lessons.isEmpty)
        XCTAssertFalse(model.loading)
    }
    func testSavedAnswerSurvivesBalanceRefreshFailure() async throws {
        let model = FamsStore(service: FailingRefreshService())
        await model.load(kidId: "arya")
        let lesson = try XCTUnwrap(model.lessons.first { $0.id == "buffer" })
        XCTAssertFalse(lesson.completed)
        let result = await model.answer(lesson, option: "1", kidId: "arya")
        XCTAssertTrue(result!.correct)
        XCTAssertEqual(model.lessons.first { $0.id == "buffer" }?.completed, true)
        XCTAssertEqual(model.celebration, 1)
        XCTAssertNotNil(model.error)
    }
    func testAccountChangeDiscardsLateLessonAnswer() async throws {
        let started = expectation(description: "Lesson answer is in flight")
        let service = HeldAnswerFamsService(onAnswerStarted: { started.fulfill() })
        let model = FamsStore(service: service)
        await model.load(kidId: "arya")
        let lesson = try XCTUnwrap(model.lessons.first { $0.id == "buffer" })
        XCTAssertFalse(lesson.completed)
        let task = Task { await model.answer(lesson, option: "1", kidId: "arya") }
        await fulfillment(of: [started], timeout: 2)

        model.clear()
        service.releaseAnswer()
        let result = await task.value

        XCTAssertNil(result)
        XCTAssertNil(model.wallet)
        XCTAssertTrue(model.lessons.isEmpty)
        XCTAssertNil(model.feedback)
        XCTAssertEqual(model.earned, 0)
        XCTAssertEqual(model.celebration, 0)
        XCTAssertEqual(service.walletReads, 1, "A stale answer must not refresh the old wallet")
    }
}

@MainActor private final class HeldAnswerFamsService: FamsService {
    let fixture = FamsPreviewService()
    let onAnswerStarted: () -> Void
    private var answerContinuation: CheckedContinuation<Void, Never>?
    private(set) var walletReads = 0
    init(onAnswerStarted: @escaping () -> Void) { self.onAnswerStarted = onAnswerStarted }
    func famsWallet(kidId: String) async throws -> FamsWallet {
        walletReads += 1
        return try await fixture.famsWallet(kidId: kidId)
    }
    func famsLessons(kidId: String) async throws -> [FamsLesson] { try await fixture.famsLessons(kidId: kidId) }
    func answerFamsLesson(kidId: String, lessonId: String, answerId: String) async throws -> FamsAnswer {
        await withCheckedContinuation { continuation in
            answerContinuation = continuation
            onAnswerStarted()
        }
        return try await fixture.answerFamsLesson(kidId: kidId, lessonId: lessonId, answerId: answerId)
    }
    func releaseAnswer() { answerContinuation?.resume(); answerContinuation = nil }
    func submitFamsChore(kidId: String, choreId: String) async throws { fatalError("Not used") }
    func saveFamsGoal(kidId: String, name: String, target: Int) async throws { fatalError("Not used") }
}

@MainActor private final class DelayedFamsService: FamsService {
    let fixture = FamsPreviewService()
    func famsWallet(kidId: String) async throws -> FamsWallet {
        try await Task.sleep(for: .milliseconds(50))
        return try await fixture.famsWallet(kidId: kidId)
    }
    func famsLessons(kidId: String) async throws -> [FamsLesson] { try await fixture.famsLessons(kidId: kidId) }
    func answerFamsLesson(kidId: String, lessonId: String, answerId: String) async throws -> FamsAnswer { fatalError("Not used") }
    func submitFamsChore(kidId: String, choreId: String) async throws { fatalError("Not used") }
    func saveFamsGoal(kidId: String, name: String, target: Int) async throws { fatalError("Not used") }
}
@MainActor private final class FailingRefreshService: FamsService {
    let fixture = FamsPreviewService()
    var reads = 0
    func famsWallet(kidId: String) async throws -> FamsWallet {
        reads += 1
        if reads > 1 { throw URLError(.notConnectedToInternet) }
        return try await fixture.famsWallet(kidId: kidId)
    }
    func famsLessons(kidId: String) async throws -> [FamsLesson] { try await fixture.famsLessons(kidId: kidId) }
    func answerFamsLesson(kidId: String, lessonId: String, answerId: String) async throws -> FamsAnswer { try await fixture.answerFamsLesson(kidId: kidId, lessonId: lessonId, answerId: answerId) }
    func submitFamsChore(kidId: String, choreId: String) async throws { fatalError("Not used") }
    func saveFamsGoal(kidId: String, name: String, target: Int) async throws { fatalError("Not used") }
}
