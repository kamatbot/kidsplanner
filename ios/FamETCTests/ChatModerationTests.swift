import XCTest
@testable import FamETC

final class ChatModerationTests: XCTestCase {
    private func msg(type: String = "kid", deleted: Bool = false) -> ChatMessage {
        ChatMessage(id: "m1", familyId: "f", senderType: type, senderId: "u2", postedByUserId: nil,
                    text: "hi", card: nil, createdAt: "2026-01-01T00:00:00Z", deleted: deleted,
                    deletedBy: nil, flagged: false, flagReason: nil, flaggedBy: nil)
    }

    func testReportRules() {
        XCTAssertTrue(ChatModeration.canReport(msg(), isMine: false, roomId: "family"))
        XCTAssertTrue(ChatModeration.canReport(msg(), isMine: false, roomId: "trip:t1"))
        XCTAssertFalse(ChatModeration.canReport(msg(), isMine: true, roomId: "family"))
        XCTAssertFalse(ChatModeration.canReport(msg(deleted: true), isMine: false, roomId: "family"))
        XCTAssertFalse(ChatModeration.canReport(msg(type: "agent"), isMine: false, roomId: "family"))
        XCTAssertFalse(ChatModeration.canReport(msg(), isMine: false, roomId: "hermes"))
    }

    func testDeleteRules() {
        XCTAssertTrue(ChatModeration.canDelete(msg(), isParent: true, roomId: "family"))
        XCTAssertFalse(ChatModeration.canDelete(msg(), isParent: false, roomId: "family"))
        XCTAssertFalse(ChatModeration.canDelete(msg(deleted: true), isParent: true, roomId: "family"))
        XCTAssertFalse(ChatModeration.canDelete(msg(), isParent: true, roomId: "hermes"))
    }
}

@MainActor
final class ChatMutationSessionTests: XCTestCase {
    private final class Mutations: ChatMutationService {
        var complete: () async throws -> ChatMessage = { throw APIError.unauthenticated }
        var send: (String, String?) async throws -> ChatMessage = { _, _ in throw URLError(.networkConnectionLost) }
        func sendChatMessage(text: String, card: [String: Any]?, media: [String: Any]?, senderType: String, senderId: String, roomId: String, clientMessageId: String?, expectedContext: [String: String]?) async throws -> ChatMessage {
            try await send(roomId, clientMessageId)
        }
        func deleteChatMessage(_ id: String, roomId: String) async throws -> ChatMessage { try await complete() }
        func flagChatMessage(_ id: String, reason: String, roomId: String) async throws -> ChatMessage { try await complete() }
        func performHermesNudgeAction(messageId: String, action: String) async throws -> (message: ChatMessage, followUps: [ChatMessage]) {
            let message = try await complete()
            return (message, [message])
        }
    }

    func testUncertainSendKeepsRetryIDUntilSuccessAndScopesItToPayloadRoomAndAccount() async {
        let service = Mutations()
        let store = AppStore(chatMutationService: service)
        store.me = User(id: "before", email: "a@example.com", name: "Before", role: "parent")
        var ids: [String] = []
        var fail = true
        service.send = { _, id in
            ids.append(try XCTUnwrap(id))
            if fail { throw URLError(.networkConnectionLost) }
            return self.message("Confirmed")
        }
        _ = await store.send(text: "First")
        fail = false
        _ = await store.send(text: "First")
        XCTAssertEqual(ids[0], ids[1])
        _ = await store.send(text: "First")
        XCTAssertNotEqual(ids[1], ids[2], "Successful send ends retry identity")
        fail = true
        _ = await store.send(text: "First")
        _ = await store.send(text: "Changed")
        XCTAssertNotEqual(ids[3], ids[4])
        _ = await store.send(text: "Changed", roomId: "trip:other")
        XCTAssertNotEqual(ids[4], ids[5])
        store.me = User(id: "after", email: "b@example.com", name: "After", role: "parent")
        _ = await store.send(text: "Changed", roomId: "trip:other")
        XCTAssertNotEqual(ids[5], ids[6])
    }

    func testGifRetryUsesSameIDAndAChangedSelectionUsesAnother() async {
        let service = Mutations()
        let store = AppStore(chatMutationService: service)
        var ids: [String] = []
        service.send = { _, id in
            ids.append(try XCTUnwrap(id))
            throw URLError(.networkConnectionLost)
        }
        var gif = GifResult(id: "one", previewUrl: "https://media.giphy.com/one.gif", url: "https://media.giphy.com/one.gif", width: 80, height: 80)
        await store.sendGif(gif)
        await store.sendGif(gif)
        XCTAssertEqual(ids[0], ids[1])
        gif.url = "https://media.giphy.com/two.gif"
        await store.sendGif(gif)
        XCTAssertNotEqual(ids[1], ids[2])
    }

    private func message(_ text: String) -> ChatMessage {
        ChatMessage(id: "same-id", familyId: "f", senderType: "parent", senderId: "parent",
                    postedByUserId: nil, text: text, card: nil, createdAt: "2026-01-01T00:00:00Z",
                    deleted: false, deletedBy: nil, flagged: false, flagReason: nil, flaggedBy: nil)
    }

    private func mutate(_ action: String, store: AppStore) async {
        switch action {
        case "delete": await store.deleteMessage("same-id")
        case "flag": await store.flagMessage("same-id", reason: "Report")
        default: await store.performHermesNudgeAction("same-id", action: "dismiss")
        }
    }

    func testOldAccountMutationCannotReplaceMessagesOrAppendPrivateFollowUps() async {
        for action in ["delete", "flag", "nudge"] {
            let service = Mutations()
            let store = AppStore(chatMutationService: service)
            store.me = User(id: "before", email: "a@example.com", name: "Before", role: "parent")
            let nextMessage = message("New account")
            service.complete = {
                store.me = User(id: "after", email: "b@example.com", name: "After", role: "parent")
                store.messagesByRoom = [familyRoomId: [nextMessage], "hermes": [nextMessage]]
                return self.message("Old account private content")
            }
            await mutate(action, store: store)
            XCTAssertEqual(store.messagesByRoom[familyRoomId], [nextMessage], action)
            XCTAssertEqual(store.messagesByRoom["hermes"], [nextMessage], action)
        }
    }

    func testOldAccountMutationFailureCannotExpireTheNewSession() async {
        for action in ["delete", "flag", "nudge"] {
            let service = Mutations()
            let store = AppStore(chatMutationService: service)
            store.me = User(id: "before", email: "a@example.com", name: "Before", role: "parent")
            service.complete = {
                store.me = User(id: "after", email: "b@example.com", name: "After", role: "parent")
                throw APIError.unauthenticated
            }
            await mutate(action, store: store)
            XCTAssertFalse(store.needsAuth, action)
            XCTAssertNil(store.syncError, action)
        }
    }
}
