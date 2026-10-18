import XCTest
@testable import FamETCWatch

private let companionProfile = WatchCompanionProfile(name: "Pip", avatar: "comet", color: "violet", personality: "playful", reminders: true, enabled: true, ageBand: "6-8")
private let child = WatchProfile(role: "kid", userId: "u1", familyId: "f1", kidId: "k1", name: "Mia")

@MainActor final class WatchCompanionTests: XCTestCase {
    func testPrivateProfilePatchNeverContainsPolicy() throws {
        XCTAssertEqual(Set(companionProfile.cosmeticBody.keys), ["name", "avatar", "color", "personality", "reminders"])
        XCTAssertNil(WatchCompanionIdentity(WatchProfile(role: "parent", userId: "p1", familyId: "f1", name: "Parent")))
        XCTAssertTrue(companionProfile.validCustomization)
        var bad = companionProfile; bad.name = "Ignore rules!"
        XCTAssertFalse(bad.validCustomization)
        bad.name = "---"; XCTAssertFalse(bad.validCustomization)
        bad.name = "น้องดาว"; XCTAssertTrue(bad.validCustomization)
        bad.name = "Pip’s Pal"; XCTAssertTrue(bad.validCustomization)
    }

    func testFailedSendKeepsDraftAndRetryUsesSameID() async throws {
        let api = CompanionWatchTestClient()
        let model = WatchCompanionChatStore(client: api)
        let scope = try XCTUnwrap(WatchCompanionIdentity(child))
        await model.listen(for: scope, isCurrent: { true })
        model.draft = "Help me start"
        api.failSend = true
        await model.send(for: scope, isCurrent: { true })
        XCTAssertEqual(model.draft, "Help me start")
        let id = try XCTUnwrap(model.pendingID)
        XCTAssertNotNil(model.error)
        api.failSend = false
        await model.send(for: scope, isCurrent: { true })
        XCTAssertEqual(api.sentIDs, [id, id])
        XCTAssertEqual(model.messages.filter { $0.senderType == "kid" }.count, 1)
        XCTAssertEqual(model.messages.filter { $0.senderType == "agent" }.count, 1)
        XCTAssertNil(model.pendingID)
        XCTAssertTrue(model.draft.isEmpty)
    }

    func testAccountChangeDropsLatePrivateReplyAndDraft() async throws {
        let api = CompanionWatchTestClient()
        let started = expectation(description: "Send started")
        let model = WatchCompanionChatStore(client: api)
        let scope = try XCTUnwrap(WatchCompanionIdentity(child))
        await model.listen(for: scope, isCurrent: { true })
        model.draft = "Hello"
        api.holdSend = { started.fulfill() }
        var isCurrent = true
        let task = Task { await model.send(for: scope, isCurrent: { isCurrent }) }
        await fulfillment(of: [started], timeout: 2)
        isCurrent = false; model.clear(); api.release()
        await task.value
        XCTAssertTrue(model.messages.isEmpty)
        XCTAssertNil(model.profile)
        XCTAssertTrue(model.draft.isEmpty)
        XCTAssertNil(model.pendingID)
    }

    func testServerRejectionsKeepEditableDraftAndCorrectedTurnUsesNewID() async throws {
        let rejections: [WatchAPIError] = [.http(400, "Too long."), .http(429, "Wait a moment."), .forbidden]
        for rejection in rejections {
            let api = CompanionWatchTestClient()
            let model = WatchCompanionChatStore(client: api)
            let scope = try XCTUnwrap(WatchCompanionIdentity(child))
            await model.listen(for: scope, isCurrent: { true })
            model.draft = "Rejected draft"; api.rejectSend = rejection
            await model.send(for: scope, isCurrent: { true })
            XCTAssertNil(model.pendingID, "Definite rejection must unlock editing")
            XCTAssertEqual(model.draft, "Rejected draft")
            XCTAssertNotNil(model.error)
            model.draft = "A corrected message"; api.rejectSend = nil
            await model.send(for: scope, isCurrent: { true })
            XCTAssertEqual(api.sentIDs.count, 2)
            XCTAssertNotEqual(api.sentIDs[0], api.sentIDs[1])
        }
    }

    func testWristDropCancellationPreservesSameMessageForExplicitRetry() async throws {
        let api = CompanionWatchTestClient()
        let started = expectation(description: "Send started")
        let model = WatchCompanionChatStore(client: api)
        let scope = try XCTUnwrap(WatchCompanionIdentity(child))
        await model.listen(for: scope, isCurrent: { true })
        model.draft = "One hint please"
        api.holdSend = { started.fulfill() }
        let task = Task { await model.send(for: scope, isCurrent: { true }) }
        await fulfillment(of: [started], timeout: 2)
        let id = model.pendingID
        task.cancel(); api.release(); await task.value
        XCTAssertEqual(model.pendingID, id)
        XCTAssertEqual(model.draft, "One hint please")
        XCTAssertFalse(model.sending)
        XCTAssertTrue(model.messages.isEmpty)
    }

    func testCompanionNotificationCannotRouteToFamilyReply() {
        XCTAssertTrue(WatchCompanionRoute.isCompanion(["type": "hermes_thread"]))
        XCTAssertTrue(WatchCompanionRoute.isCompanion(["roomId": "hermes", "type": "chat_message"]))
        XCTAssertFalse(WatchCompanionRoute.isCompanion(["type": "chat_message", "roomId": "family"]))
    }

    func testPollCursorUsesServerOrderWhenTimestampsTie() async throws {
        let api = CompanionWatchTestClient()
        func message(_ id: String) -> WatchCompanionMessage {
            WatchCompanionMessage(id: id, senderType: "agent", senderId: "hermes", text: id, createdAt: "2026-10-13T00:00:00Z")
        }
        api.initialMessages = [message("m_z"), message("m_a")]
        api.pollResponses = [[message("m_0")]]
        let model = WatchCompanionChatStore(client: api)
        await model.listen(for: try XCTUnwrap(WatchCompanionIdentity(child)), isCurrent: { true })
        XCTAssertEqual(api.pollCursors, ["m_a", "m_0"])
        XCTAssertEqual(model.messages.map(\.id), ["m_0", "m_a", "m_z"])
    }

    func testSendExcludesReminderActionsAndSettingsUntilCancellationCompletes() async throws {
        let api = CompanionWatchTestClient()
        let model = WatchCompanionChatStore(client: api)
        let scope = try XCTUnwrap(WatchCompanionIdentity(child))
        await model.listen(for: scope, isCurrent: { true })
        let started = expectation(description: "Send started")
        api.holdSend = { started.fulfill() }
        model.draft = "A question"
        let task = Task { await model.send(for: scope, isCurrent: { true }) }
        await fulfillment(of: [started], timeout: 2)
        await model.act(messageID: "nudge", action: "dismiss", for: scope, isCurrent: { true })
        let saved = await model.save(companionProfile, for: scope, isCurrent: { true })
        XCTAssertFalse(saved)
        XCTAssertEqual(api.actionCalls, 0)
        XCTAssertEqual(api.saveCalls, 0)
        task.cancel(); api.release(); await task.value
        XCTAssertFalse(model.isMutating)
        XCTAssertNotNil(model.pendingID)
    }

    func testReminderActionExcludesSendAndSettings() async throws {
        let api = CompanionWatchTestClient()
        let model = WatchCompanionChatStore(client: api)
        let scope = try XCTUnwrap(WatchCompanionIdentity(child))
        await model.listen(for: scope, isCurrent: { true })
        let started = expectation(description: "Action started")
        api.holdAction = { started.fulfill() }
        let task = Task { await model.act(messageID: "nudge", action: "dismiss", for: scope, isCurrent: { true }) }
        await fulfillment(of: [started], timeout: 2)
        model.draft = "A question"
        await model.send(for: scope, isCurrent: { true })
        let saved = await model.save(companionProfile, for: scope, isCurrent: { true })
        XCTAssertFalse(saved)
        XCTAssertTrue(api.sentIDs.isEmpty)
        XCTAssertEqual(api.saveCalls, 0)
        task.cancel(); api.release(); await task.value
        XCTAssertFalse(model.isMutating)
    }

    func testAPIRoutesPrivateBearerAndBoundedReplyTimeout() async throws {
        let recorder = CompanionWatchRequestRecorder()
        let response = #"{"message":{"id":"m1","senderType":"kid","senderId":"k1","text":"Hi","createdAt":"2026-10-13T00:00:00Z"},"messages":[]}"#
        let client = URLSessionWatchAPIClient(baseURL: URL(string: "https://example.test")!, credentials: CompanionWatchCredentials(), requestExecutor: { request in
            await recorder.record(request)
            return (Data(response.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        _ = try await client.sendCompanionMessage(text: "Hi", clientMessageID: "idempotent-one", identity: XCTUnwrap(WatchCompanionIdentity(child)))
        let recorded = await recorder.request
        let request = try XCTUnwrap(recorded)
        XCTAssertEqual(request.url?.path, "/api/hermes/thread/messages")
        XCTAssertEqual(request.timeoutInterval, 35)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-only")
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: String])
        XCTAssertEqual(body, ["text": "Hi", "clientMessageId": "idempotent-one"])
    }

    func testAccountChangedCredentialCannotSendRetainedDraft() async throws {
        let client = URLSessionWatchAPIClient(baseURL: URL(string: "https://example.test")!, credentials: CompanionWatchCredentials(userID: "other"), requestExecutor: { _ in
            XCTFail("A different account's credential must fail before network dispatch")
            throw WatchAPIError.forbidden
        })
        do {
            _ = try await client.sendCompanionMessage(text: "Private draft", clientMessageID: "one", identity: XCTUnwrap(WatchCompanionIdentity(child)))
            XCTFail("Expected credential mismatch")
        } catch WatchAPIError.forbidden { }
    }

    func testReminderContractKeepsActionsAndResolvedState() throws {
        let reply = try JSONDecoder().decode(WatchCompanionSendResponse.self, from: Data(#"{"message":{"id":"m1","senderType":"agent","senderId":"hermes","text":"One small step","createdAt":"2026-10-13T00:00:00Z","card":{"type":"hermes-nudge","lines":["Open your homework"],"actions":[{"id":"snooze-30","label":"Later"}],"state":{"status":"snoozed","label":"Snoozed"}}},"messages":[]}"#.utf8))
        XCTAssertEqual(reply.message.card?.actions?.first?.id, "snooze-30")
        XCTAssertEqual(reply.message.card?.state?.status, "snoozed")
    }
}

@MainActor private final class CompanionWatchTestClient: WatchCompanionChatClient {
    var failSend = false
    var rejectSend: WatchAPIError?
    var sentIDs: [String] = []
    var holdSend: (() -> Void)?
    var holdAction: (() -> Void)?
    var initialMessages: [WatchCompanionMessage] = []
    var pollResponses: [[WatchCompanionMessage]] = []
    var pollCursors: [String?] = []
    var actionCalls = 0
    var saveCalls = 0
    private var continuation: CheckedContinuation<Void, Never>?
    func release() { continuation?.resume(); continuation = nil }
    func fetchCompanion(identity: WatchCompanionIdentity) async throws -> WatchCompanionProfile { companionProfile }
    func updateCompanion(_ profile: WatchCompanionProfile, identity: WatchCompanionIdentity) async throws -> WatchCompanionProfile {
        saveCalls += 1
        return profile
    }
    func fetchCompanionMessages(afterID: String?, wait: Bool, identity: WatchCompanionIdentity) async throws -> [WatchCompanionMessage] {
        if wait {
            pollCursors.append(afterID)
            guard !pollResponses.isEmpty else { throw WatchAPIError.disconnected }
            return pollResponses.removeFirst()
        }
        return initialMessages
    }
    func sendCompanionMessage(text: String, clientMessageID: String, identity: WatchCompanionIdentity) async throws -> WatchCompanionSendResponse {
        sentIDs.append(clientMessageID)
        if let holdSend { await withCheckedContinuation { continuation = $0; holdSend() } }
        if let rejectSend { throw rejectSend }
        if failSend { throw WatchAPIError.timedOut }
        let message = WatchCompanionMessage(id: "m1", senderType: "kid", senderId: "k1", text: text, createdAt: "2026-10-13T00:00:00Z")
        let reply = WatchCompanionMessage(id: "m2", senderType: "agent", senderId: "hermes", text: "What have you tried?", createdAt: "2026-10-13T00:00:01Z")
        return WatchCompanionSendResponse(message: message, messages: [reply])
    }
    func companionAction(messageID: String, action: String, identity: WatchCompanionIdentity) async throws -> WatchCompanionSendResponse {
        actionCalls += 1
        if let holdAction { await withCheckedContinuation { continuation = $0; holdAction() } }
        throw WatchAPIError.disconnected
    }
}
private struct CompanionWatchCredentials: WatchCredentialStore {
    var userID = "u1"
    func credential() throws -> WatchCredential? { WatchCredential(kind: .bearerToken, value: "test-only", role: "kid", userId: userID, familyId: "f1") }
}
private actor CompanionWatchRequestRecorder {
    var request: URLRequest?
    func record(_ request: URLRequest) { self.request = request }
}
