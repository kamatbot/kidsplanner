import XCTest
@testable import FamETC

final class StudentSupportTests: XCTestCase {
    func testTimerPauseRestartDoesNotCountPausedTime() throws {
        var timer = SupportTimer(remaining: 600)
        let start = Date(timeIntervalSince1970: 1_000)
        timer.resume(at: start)
        timer.pause(at: start.addingTimeInterval(40))
        XCTAssertEqual(timer.seconds(at: start.addingTimeInterval(200)), 560)
        let restored = try JSONDecoder().decode(SupportTimer.self, from: JSONEncoder().encode(timer))
        XCTAssertEqual(restored.seconds(at: start.addingTimeInterval(300)), 560)
        timer.resume(at: start.addingTimeInterval(400))
        XCTAssertEqual(timer.seconds(at: start.addingTimeInterval(960)), 0)
        XCTAssertEqual(timer.seconds(at: start.addingTimeInterval(2_000)), 0)
    }

    func testCommandPersistsScopeRevisionAndExplicitState() throws {
        let scope = SupportScope(userID: "u", familyID: "f", kidID: "k")
        let command = SupportCommand(id: "retry-stable-id", scope: scope, expectedRevision: 3, type: "packing_item", payload: try JSONSerialization.data(withJSONObject: ["date": "2026-10-06", "itemId": "book", "status": "packed"]))
        let restored = try JSONDecoder().decode(SupportCommand.self, from: JSONEncoder().encode(command))
        XCTAssertEqual(restored.scope, scope)
        XCTAssertEqual(restored.body["expectedRevision"] as? Int, 3)
        XCTAssertEqual(restored.body["commandId"] as? String, "retry-stable-id")
        XCTAssertEqual((restored.body["payload"] as? [String: String])?["status"], "packed")
    }

    @MainActor func testAccountSwitchClearsProtectedRecoveryFileAndMemory() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let model = StudentSupportStore(file: file)
        model.accountChanged(userID: "old", familyID: "family")
        model.select(SupportScope(userID: "old", familyID: "family", kidID: "kid"))
        model.timer = SupportTimer(remaining: 300)
        model.saveTimer()
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        model.accountChanged(userID: "new", familyID: "family")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertNil(model.scope)
        XCTAssertNil(model.snapshot)
        XCTAssertTrue(model.pending.isEmpty)
    }

    @MainActor func testCacheNeverLoadsForOtherChild() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let model = StudentSupportStore(file: file)
        model.select(SupportScope(userID: "u", familyID: "f", kidID: "one"))
        model.timer = SupportTimer(remaining: 123)
        model.saveTimer()
        let next = StudentSupportStore(file: file)
        next.select(SupportScope(userID: "u", familyID: "f", kidID: "two"))
        XCTAssertEqual(next.timer.remaining, 600)
        XCTAssertTrue(next.pending.isEmpty)
    }
}

private final class SupportTestService: StudentSupportService {
    var value = supportFixture()
    var error: Error? = APIError.transport(URLError(.notConnectedToInternet))
    var received: [String] = []
    var applied = Set<String>()
    var loseNextReply = false
    var hold = false
    var continuation: CheckedContinuation<StudentSupportSnapshot, Error>?
    func studentSupport(kidID: String) async throws -> StudentSupportSnapshot { value }
    func studentSupportCommand(_ command: SupportCommand) async throws -> StudentSupportSnapshot {
        received.append(command.id)
        if hold { return try await withCheckedThrowingContinuation { continuation = $0 } }
        if let error { throw error }
        if applied.insert(command.id).inserted { value.apply(command); value.revision += 1 }
        if loseNextReply { loseNextReply = false; throw APIError.transport(URLError(.networkConnectionLost)) }
        return value
    }
}

private func supportFixture() -> StudentSupportSnapshot {
    StudentSupportSnapshot(schemaVersion: 1, familyId: "f", kidId: "k", enabled: true, revision: 0,
        timezone: "Asia/Bangkok", today: "2026-10-05", refreshedAt: "2026-10-05T10:00:00Z",
        preferences: SupportPreferences(quietStart: "21:00", quietEnd: "07:00", homeworkTime: "16:30", packingTime: "19:30", morningTime: "07:00", focusMinutes: 10),
        materialRules: [], routines: [],
        packing: SupportPacking(date: "2026-10-06", coverage: "verified", items: [SupportPackingItem(id: "book", title: "Book", reasons: ["Maths"], phase: "evening", status: "needed")], complete: false),
        occurrences: [SupportOccurrence(id: "routine-date", routineId: "routine", date: "2026-10-05", title: "Walk dog", time: "17:00", steps: [SupportOccurrenceStep(id: "leash", title: "Get leash", done: false)], status: "open")], homeworkPlans: [])
}

extension StudentSupportTests {
    @MainActor func testOfflineChecksSurviveRestartAndRetryUsesSameCommandID() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let service = SupportTestService()
        let model = StudentSupportStore(file: file, service: service)
        let scope = SupportScope(userID: "u", familyID: "f", kidID: "k")
        model.select(scope); await model.refresh()
        await model.send("packing_item", ["date": "2026-10-06", "itemId": "book", "status": "packed"])
        await model.send("routine_step", ["occurrenceId": "routine-date", "stepId": "leash", "done": true])
        XCTAssertEqual(model.snapshot?.packing.items.first?.status, "packed")
        XCTAssertEqual(model.snapshot?.occurrences.first?.steps.first?.done, true)
        XCTAssertEqual(model.acknowledged?.revision, 0)
        let ids = model.pending.map(\.id)
        let restored = StudentSupportStore(file: file, service: service)
        restored.select(scope)
        XCTAssertEqual(restored.pending.map(\.id), ids)
        XCTAssertEqual(restored.snapshot?.packing.items.first?.status, "packed")
        XCTAssertEqual(restored.snapshot?.occurrences.first?.steps.first?.done, true)
        service.error = nil
        await restored.sync(); await restored.sync()
        XCTAssertTrue(restored.pending.isEmpty)
        XCTAssertEqual(service.applied.count, 2)
        XCTAssertEqual(restored.acknowledged?.revision, 2)
        XCTAssertEqual(restored.snapshot?.occurrences.first?.steps.first?.done, true)
        XCTAssertTrue(service.received.allSatisfy { ids.contains($0) })
    }

    @MainActor func testLostAcknowledgementRetriesWithoutDuplicateApplication() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let service = SupportTestService(); service.error = nil; service.loseNextReply = true
        let model = StudentSupportStore(file: file, service: service)
        model.select(SupportScope(userID: "u", familyID: "f", kidID: "k")); await model.refresh()
        await model.send("packing_item", ["date": "2026-10-06", "itemId": "book", "status": "packed"])
        XCTAssertEqual(model.pending.count, 1)
        await model.sync()
        XCTAssertTrue(model.pending.isEmpty)
        XCTAssertEqual(service.received.count, 2)
        XCTAssertEqual(Set(service.received).count, 1)
        XCTAssertEqual(service.applied.count, 1)
        XCTAssertEqual(model.acknowledged?.revision, 1)
    }

    @MainActor func testConflictPreservesIntentUntilExplicitDiscard() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let service = SupportTestService(); service.error = APIError.http(409, "Changed")
        let model = StudentSupportStore(file: file, service: service)
        model.select(SupportScope(userID: "u", familyID: "f", kidID: "k")); await model.refresh()
        await model.send("packing_item", ["date": "2026-10-06", "itemId": "book", "status": "packed"])
        XCTAssertTrue(model.conflict); XCTAssertEqual(model.pending.count, 1)
        await model.sync(); XCTAssertEqual(service.received.count, 1)
        XCTAssertEqual(model.snapshot?.packing.items.first?.status, "packed")
        await model.discardAndReload()
        XCTAssertFalse(model.conflict); XCTAssertTrue(model.pending.isEmpty)
        XCTAssertEqual(model.snapshot?.packing.items.first?.status, "needed")
    }

    @MainActor func testLateResponseAfterResetCannotRestoreAnotherAccount() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let service = SupportTestService(); service.hold = true
        let model = StudentSupportStore(file: file, service: service)
        model.select(SupportScope(userID: "u", familyID: "f", kidID: "k")); await model.refresh()
        let task = Task { await model.send("packing_item", ["date": "2026-10-06", "itemId": "book", "status": "packed"]) }
        while service.continuation == nil { await Task.yield() }
        model.reset()
        service.continuation?.resume(returning: service.value)
        await task.value
        XCTAssertNil(model.snapshot); XCTAssertNil(model.scope); XCTAssertTrue(model.pending.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    @MainActor func testDiskFailureDoesNotShowUnsavedCheck() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let file = directory.appendingPathComponent("cache")
        defer { try? FileManager.default.removeItem(at: directory) }
        let service = SupportTestService()
        let model = StudentSupportStore(file: file, service: service)
        model.select(SupportScope(userID: "u", familyID: "f", kidID: "k")); await model.refresh()
        try FileManager.default.removeItem(at: directory)
        try Data().write(to: directory) // Parent is now a file, so durable writes must fail.
        await model.send("packing_item", ["date": "2026-10-06", "itemId": "book", "status": "packed"])
        XCTAssertTrue(model.pending.isEmpty)
        XCTAssertEqual(model.snapshot?.packing.items.first?.status, "needed")
        XCTAssertTrue(service.received.isEmpty)
    }
}

extension StudentSupportTests {
    @MainActor func testPartialIdentityHydrationPreservesOfflineQueueAndTimer() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let service = SupportTestService()
        let scope = SupportScope(userID: "u", familyID: "f", kidID: "k")
        let original = StudentSupportStore(file: file, service: service)
        original.select(scope); await original.refresh()
        await original.send("packing_item", ["date": "2026-10-06", "itemId": "book", "status": "packed"])
        original.timer = SupportTimer(remaining: 123); original.saveTimer()
        let restored = StudentSupportStore(file: file, service: service)
        restored.accountChanged(userID: "u", familyID: nil)
        restored.accountChanged(userID: "u", familyID: "f")
        restored.select(scope)
        XCTAssertEqual(restored.pending.map(\.id), original.pending.map(\.id))
        XCTAssertEqual(restored.snapshot?.packing.items.first?.status, "packed")
        XCTAssertEqual(restored.timer.remaining, 123)
    }

    @MainActor func testColdStartDifferentConfirmedIdentityPurgesPersistedState() throws {
        for identity in [("other-user", "f"), ("u", "other-family")] {
            let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: file) }
            let original = StudentSupportStore(file: file)
            original.select(SupportScope(userID: "u", familyID: "f", kidID: "k"))
            original.timer = SupportTimer(remaining: 123); original.saveTimer()
            let restored = StudentSupportStore(file: file)
            restored.accountChanged(userID: identity.0, familyID: nil)
            restored.accountChanged(userID: identity.0, familyID: identity.1)
            XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
            XCTAssertNil(restored.scope)
            XCTAssertTrue(restored.pending.isEmpty)
        }
    }
}

extension StudentSupportTests {
    func testNowPrioritizesDueRoutineAndHonorsSnooze() {
        var snapshot = supportFixture()
        let now = ISO8601DateFormatter().date(from: "2026-10-05T10:01:00Z")!
        if case .routine(let value) = SupportNowChoice.choose(snapshot: snapshot, homework: [], now: now) {
            XCTAssertEqual(value.id, "routine-date")
        } else { XCTFail("Due routine should be the concrete next action") }
        snapshot.occurrences[0].status = "snoozed"
        snapshot.occurrences[0].snoozedUntil = "2026-10-05T10:15:00Z"
        if case .none = SupportNowChoice.choose(snapshot: snapshot, homework: [], now: now) {} else { XCTFail("Do not prompt during snooze") }
    }
    func testNowPrefersTodaysPlanOverDueOrderAndExcludesSibling() {
        var snapshot = supportFixture(); snapshot.occurrences = []
        let own = HomeworkItem(id: "planned", kidId: "k", title: "Own", dueDate: "2026-10-08", status: "todo")
        let other = HomeworkItem(id: "sibling", kidId: "other", title: "Private", dueDate: "2026-10-01", status: "todo")
        snapshot.homeworkPlans = [SupportHomeworkPlan(homeworkId: "planned", nextStep: "Open book", plannedDate: "2026-10-05", workFinished: false, handInMethod: "unknown", submission: "unknown")]
        let now = ISO8601DateFormatter().date(from: "2026-10-05T10:01:00Z")!
        if case .homework(let item, let reason) = SupportNowChoice.choose(snapshot: snapshot, homework: [other, own], now: now) {
            XCTAssertEqual(item.id, "planned"); XCTAssertEqual(reason, "You planned a next step for today.")
        } else { XCTFail("Own planned task should be next") }
    }
}

extension StudentSupportTests {
    func testPackingOldCacheDoesNotImplyConfirmedRequirements() throws {
        let data = Data(#"{"date":"2026-10-06","coverage":"verified","items":[],"complete":true}"#.utf8)
        var packing = try JSONDecoder().decode(SupportPacking.self, from: data)
        XCTAssertNil(packing.requirementsConfirmed)
        XCTAssertNotNil(packing.parentWarning)
        packing.requirementsConfirmed = true
        XCTAssertNil(packing.parentWarning)
        packing.coverage = "stale"
        packing.message = "The source needs refreshing."
        XCTAssertEqual(packing.parentWarning, "The source needs refreshing.")
        packing.coverage = "verified"
        packing.requirementsConfirmed = false
        packing.message = "Science supplies have not been agreed."
        XCTAssertEqual(packing.parentWarning, "Science supplies have not been agreed.")
    }
}
