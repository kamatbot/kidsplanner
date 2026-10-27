import XCTest
@testable import FamETC

/// Family chat read receipts: wire decoding, per-room endpoints, and the
/// "Seen by" line under the newest message of mine.
@MainActor
final class ReadReceiptsTests: XCTestCase {

    private func msg(_ id: String, by userId: String, at: String) -> ChatMessage {
        ChatMessage(id: id, familyId: "f1", senderType: "parent", senderId: userId,
                    postedByUserId: userId, text: id, card: nil, media: nil,
                    createdAt: at, deleted: false, deletedBy: nil,
                    flagged: false, flagReason: nil, flaggedBy: nil)
    }

    func testMessagesResponseDecodesWithAndWithoutReads() throws {
        let old = #"{"messages":[]}"#
        XCTAssertNil(try JSONDecoder().decode(MessagesResponse.self, from: Data(old.utf8)).reads)
        let new = #"{"messages":[],"reads":[{"userId":"u2","name":"Dad","messageId":"m1","messageCreatedAt":"2026-10-27T10:00:00.000Z","readAt":"2026-10-27T10:05:00.000Z"}]}"#
        let reads = try JSONDecoder().decode(MessagesResponse.self, from: Data(new.utf8)).reads
        XCTAssertEqual(reads, [ChatRead(userId: "u2", name: "Dad", messageId: "m1", messageCreatedAt: "2026-10-27T10:00:00.000Z", readAt: "2026-10-27T10:05:00.000Z")])
    }

    func testReadPathPerRoom() {
        XCTAssertEqual(APIClient.chatReadPath(for: familyRoomId), "/api/chat/read")
        XCTAssertEqual(APIClient.chatReadPath(for: "trip:abc"), "/api/trips/abc/chat/read")
        XCTAssertNil(APIClient.chatReadPath(for: "hermes"), "the private Hermes room has no receipts")
    }

    func testSeenByListsOthersWhoReachedMyNewestMessage() {
        let store = AppStore()
        store.me = User(id: "u1", email: "a@x.com", name: "Mom", role: "parent")
        store.messagesByRoom[familyRoomId] = [
            msg("a", by: "u1", at: "2026-10-27T10:00:00.000Z"),
            msg("b", by: "u2", at: "2026-10-27T10:01:00.000Z"),
            msg("c", by: "u1", at: "2026-10-27T10:02:00.000Z"),
        ]
        XCTAssertNil(store.seenBy(in: familyRoomId), "nothing until someone reads it")
        store.readsByRoom[familyRoomId] = [
            ChatRead(userId: "u2", name: "Dad Kamat", messageId: "c", messageCreatedAt: "2026-10-27T10:02:00.000Z"),
            ChatRead(userId: "k1", name: "Arya", messageId: "b", messageCreatedAt: "2026-10-27T10:01:00.000Z"),
            ChatRead(userId: "u1", name: "Mom", messageId: "c", messageCreatedAt: "2026-10-27T10:02:00.000Z"),
        ]
        let seen = store.seenBy(in: familyRoomId)
        XCTAssertEqual(seen?.messageId, "c")
        XCTAssertEqual(seen?.text, "Seen by Dad")
    }
}

/// Emoji reactions: wire decoding (including the `updated` side channel)
/// and the fixed five.
final class ChatReactionsTests: XCTestCase {
    func testDecodesReactionsAndUpdated() throws {
        let json = #"{"messages":[],"updated":[{"id":"m1","familyId":"f1","senderType":"parent","senderId":"u1","text":"hi","createdAt":"2026-10-27T10:00:00.000Z","deleted":false,"flagged":false,"reactions":[{"key":"fire","userIds":["u2"],"names":["Arya"]}]}]}"#
        let r = try JSONDecoder().decode(MessagesResponse.self, from: Data(json.utf8))
        XCTAssertEqual(r.updated?.first?.reactions, [ChatReaction(key: "fire", userIds: ["u2"], names: ["Arya"])])
        let old = #"{"id":"m2","familyId":"f1","senderType":"parent","senderId":"u1","text":"hi","createdAt":"2026-10-27T10:00:00.000Z","deleted":false,"flagged":false}"#
        XCTAssertNil(try JSONDecoder().decode(ChatMessage.self, from: Data(old.utf8)).reactions)
    }

    func testFixedFiveReactions() {
        XCTAssertEqual(ChatReaction.all.map(\.key), ["thumbsup", "heart", "laugh", "wow", "sad", "pray", "fire", "party"])
        XCTAssertEqual(ChatReaction.emoji(for: "heart"), "❤️")
        XCTAssertNil(ChatReaction.emoji(for: "poop"))
    }
}
