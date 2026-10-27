import XCTest
@testable import FamETC

/// Regression tests for the TestFlight build-24 crash: send paths blind-
/// appended a message the long-poll had already merged, `persist()` wrote the
/// duplicate id into the disk cache, and `Dictionary(uniqueKeysWithValues:)`
/// inside `mergeIncoming` trapped on the next merge — or on the next LAUNCH,
/// via the poisoned cache (AppStore.swift:306 in the symbolicated log).
/// Every message source must now land through one deduplicating path.
///
/// Trips (docs/TRIPS-PLAN.md) generalized `mergeIncoming`/`store.messages` to
/// be per-room (`roomId` param, default `familyRoomId`) — every test below
/// still exercises the family room via that default, so the original
/// build-24 assertions are unchanged; `testMergeIncomingIsolatesRoomsById`
/// covers the new per-room behavior itself.
@MainActor
final class ChatMergeTests: XCTestCase {

    private func msg(_ id: String, text: String = "hi", at: String = "2026-01-01T10:00:00.000Z") -> ChatMessage {
        ChatMessage(id: id, familyId: "f1", senderType: "parent", senderId: "u1",
                    postedByUserId: nil, text: text, card: nil, media: nil,
                    createdAt: at, deleted: false, deletedBy: nil,
                    flagged: false, flagReason: nil, flaggedBy: nil)
    }

    private func gifMsg(_ id: String, at: String) -> ChatMessage {
        ChatMessage(id: id, familyId: "f1", senderType: "parent", senderId: "u1",
                    postedByUserId: nil, text: "",
                    card: nil,
                    media: ChatMedia(type: "gif", url: "https://g/x.gif", previewUrl: "https://g/p.gif", width: 100, height: 100),
                    createdAt: at, deleted: false, deletedBy: nil,
                    flagged: false, flagReason: nil, flaggedBy: nil)
    }

    /// Build-24 crash state 1: a poisoned cache put duplicate ids into the
    /// live array; the next merge must collapse them, not trap.
    func testMergeSurvivesDuplicateIdsInExistingMessages() {
        let store = AppStore()
        store.messages = [msg("m1"), msg("m1", text: "dupe"), msg("m2", at: "2026-01-01T10:01:00.000Z")]
        store.mergeIncoming([msg("m3", at: "2026-01-01T10:02:00.000Z")])   // build 24 crashed here
        XCTAssertEqual(store.messages.map(\.id), ["m1", "m2", "m3"], "duplicates must collapse, order by createdAt")
    }

    /// Build-24 crash producer: the same message arriving from the long-poll
    /// delta AND the send response must not create a duplicate.
    func testSendResponseRacingLongPollDoesNotDuplicate() {
        let store = AppStore()
        store.messages = [msg("m1")]
        let sent = msg("m2", text: "mine", at: "2026-01-01T10:01:00.000Z")
        store.mergeIncoming([sent])   // long-poll wakes first with the new message
        store.mergeIncoming([sent])   // send response lands second (now also a merge, never an append)
        XCTAssertEqual(store.messages.map(\.id), ["m1", "m2"])
    }

    /// A single server response containing duplicate ids must be collapsed.
    func testDedupeCollapsesDuplicatesInsideOneResponse() {
        let deduped = AppStore.dedupe([msg("m1"), msg("m2", at: "2026-01-01T10:01:00.000Z"), msg("m1", text: "later copy")])
        XCTAssertEqual(deduped.map(\.id), ["m1", "m2"])
        XCTAssertEqual(deduped[0].text, "later copy", "last occurrence wins")
    }

    /// GIF sends had the same blind-append bug — same race, media message.
    func testGifSendRacingLongPollDoesNotDuplicate() {
        let store = AppStore()
        store.messages = [msg("m1")]
        let gif = gifMsg("m2", at: "2026-01-01T10:01:00.000Z")
        store.mergeIncoming([gif])   // long-poll delivery
        store.mergeIncoming([gif])   // send-response delivery
        XCTAssertEqual(store.messages.map(\.id), ["m1", "m2"])
        XCTAssertEqual(store.messages[1].media?.type, "gif")
    }

    private func voiceMsg(_ id: String, at: String) -> ChatMessage {
        ChatMessage(id: id, familyId: "f1", senderType: "kid", senderId: "k1",
                    postedByUserId: nil, text: "",
                    card: nil,
                    media: ChatMedia(type: "attachment", url: "/api/chat/attachments/a_v", attachmentId: "a_v",
                                     filename: "voice.m4a", mimeType: "audio/mp4", size: 4800,
                                     kind: "audio", durationMs: 6200),
                    createdAt: at, deleted: false, deletedBy: nil,
                    flagged: false, flagReason: nil, flaggedBy: nil)
    }

    /// Voice messages ride the same upload-then-send path as photos, so the
    /// send response and the long-poll can race exactly like GIFs did.
    func testVoiceSendRacingLongPollDoesNotDuplicate() {
        let store = AppStore()
        store.messages = [msg("m1")]
        let voice = voiceMsg("m2", at: "2026-01-01T10:01:00.000Z")
        store.mergeIncoming([voice])   // long-poll delivery
        store.mergeIncoming([voice])   // send-response delivery
        XCTAssertEqual(store.messages.map(\.id), ["m1", "m2"])
        XCTAssertEqual(store.messages[1].media?.kind, "audio")
        XCTAssertEqual(store.messages[1].media?.durationMs, 6200)
        XCTAssertTrue(store.messages[1].media?.isVoiceMessage == true)
    }

    /// Fresh copy replaces the stale one for an existing id.
    func testMergeDedupesOverlappingDelta() {
        let store = AppStore()
        store.messages = [msg("m1"), msg("m2", at: "2026-01-01T10:01:00.000Z")]
        store.mergeIncoming([msg("m2", text: "updated", at: "2026-01-01T10:01:00.000Z"),
                             msg("m3", at: "2026-01-01T10:02:00.000Z")])
        XCTAssertEqual(store.messages.map(\.id), ["m1", "m2", "m3"])
        XCTAssertEqual(store.messages[1].text, "updated", "fresh copy wins for an existing id")
    }

    /// Trips: a trip room's messages must never leak into (or collide with) the
    /// family room's, even when both hold a message with the same id.
    func testMergeIncomingIsolatesRoomsById() {
        let store = AppStore()
        store.mergeIncoming([msg("m1", text: "family hello")])   // defaults to the family room
        store.mergeIncoming([msg("m1", text: "trip hello")], roomId: "trip:t1")
        XCTAssertEqual(store.messages.map(\.text), ["family hello"], "family room untouched by the trip merge")
        XCTAssertEqual(store.messagesByRoom["trip:t1"]?.map(\.text), ["trip hello"])
    }

    func testUnreadCountTreatsBoundedWindowAsNewWhenSeenMessageExpired() {
        let store = AppStore()
        store.me = User(id: "me", email: "me@example.com", name: "Me", role: "parent")
        store.messagesByRoom[familyRoomId] = [
            ChatMessage(id: "m51", familyId: "f1", senderType: "parent", senderId: "other",
                        postedByUserId: "other", text: "one", card: nil, media: nil,
                        createdAt: "2026-01-01T10:01:00.000Z", deleted: false, deletedBy: nil,
                        flagged: false, flagReason: nil, flaggedBy: nil),
            ChatMessage(id: "m52", familyId: "f1", senderType: "parent", senderId: "other",
                        postedByUserId: "other", text: "two", card: nil, media: nil,
                        createdAt: "2026-01-01T10:02:00.000Z", deleted: false, deletedBy: nil,
                        flagged: false, flagReason: nil, flaggedBy: nil),
        ]
        store.lastSeenChatIdByRoom[familyRoomId] = "m1"

        XCTAssertEqual(store.unreadCount(for: familyRoomId), 2)
    }

    func testEqualTimestampsRetainReceiveOrderAfterUpsert() {
        let deduped = AppStore.dedupe([msg("z"), msg("a"), msg("z", text: "updated")])
        XCTAssertEqual(deduped.map(\.id), ["z", "a"])
        XCTAssertEqual(deduped.first?.text, "updated")
    }

    private final class ChatService: ChatMessageService {
        var receive: (String?, Bool) async throws -> [ChatMessage] = { _, _ in [] }
        var rooms: () async throws -> [ChatRoom] = { [] }
        func chatRooms() async throws -> [ChatRoom] { try await rooms() }
        func chatMessages(roomId: String, since: String?, limit: Int?, afterId: String?, wait: Bool) async throws -> [ChatMessage] {
            try await receive(afterId, wait)
        }
    }

    func testPeriodicSnapshotKeepsHistoryAndReceiveCursorWhileApplyingModeration() async {
        let service = ChatService()
        var now = Date(timeIntervalSince1970: 0)
        let store = AppStore(chatService: service, chatNow: { now })
        let complete = expectation(description: "Snapshot reconciled")
        let old = msg("old", at: "2025-01-01T00:00:00Z")
        let latest = msg("latest")
        var deleted = latest
        deleted.deleted = true
        deleted.text = ""
        deleted.flagged = true
        var calls = 0
        service.receive = { cursor, wait in
            calls += 1
            if calls == 1 { return [old, latest] }
            if calls == 2 { XCTAssertTrue(wait); now = now.addingTimeInterval(61); return [self.msg("newer", at: "2026-01-02T00:00:00Z")] }
            if calls == 3 { XCTAssertFalse(wait); XCTAssertNil(cursor); return [deleted] }
            XCTAssertTrue(wait)
            XCTAssertEqual(cursor, "newer", "Snapshot must not rewind or advance insertion cursor")
            complete.fulfill()
            try await Task.sleep(for: .seconds(60))
            return []
        }
        let loop = Task { await store.runActiveRoomLoop("trip:test") }
        defer { loop.cancel() }
        await fulfillment(of: [complete], timeout: 0.75)
        XCTAssertEqual(store.messagesByRoom["trip:test"]?.map(\.id), ["old", "latest", "newer"])
        XCTAssertTrue(store.messagesByRoom["trip:test"]?[1].deleted == true)
        XCTAssertTrue(store.messagesByRoom["trip:test"]?[1].flagged == true)
    }

    func testSnapshotCannotRestoreMessageDeletedWhileRequestWasInFlight() {
        let store = AppStore()
        let original = msg("m1")
        var deleted = original
        deleted.deleted = true
        deleted.text = ""
        store.messages = [deleted]
        store.reconcileRoomSnapshot([original], roomId: familyRoomId, before: [original])
        XCTAssertTrue(store.messages[0].deleted)
    }

    func testOldRoomDirectoryCannotEnterNewAccountOrExpireItsSession() async {
        for fails in [false, true] {
            let service = ChatService()
            let store = AppStore(chatService: service)
            store.me = User(id: "before", email: "a@example.com", name: "Before", role: "parent")
            service.rooms = {
                store.me = User(id: "after", email: "b@example.com", name: "After", role: "parent")
                if fails { throw APIError.unauthenticated }
                return [ChatRoom(roomId: "trip:private", title: "Private")]
            }
            let refreshed = await store.refreshChatRooms()
            XCTAssertFalse(refreshed)
            XCTAssertFalse(store.chatRooms.contains { $0.roomId == "trip:private" })
            XCTAssertFalse(store.needsAuth)
        }
    }

    func testEmptyRoomImmediatelyStartsLongPoll() async {
        let service = ChatService()
        let store = AppStore(chatService: service)
        let listening = expectation(description: "Empty room is listening")
        service.receive = { afterId, wait in
            if wait {
                XCTAssertNil(afterId)
                listening.fulfill()
                try await Task.sleep(for: .seconds(60))
            }
            return []
        }
        let loop = Task { await store.runActiveRoomLoop("trip:test") }
        defer { loop.cancel() }
        await fulfillment(of: [listening], timeout: 0.75)
    }

    func testReceiveRearmsImmediatelyAndSendCannotSkipCursor() async {
        let service = ChatService()
        let store = AppStore(chatService: service)
        let listening = expectation(description: "Next delta is listening without the old 2 second floor")
        var calls = 0
        service.receive = { afterId, wait in
            calls += 1
            if calls == 1 {
                XCTAssertFalse(wait)
                return [self.msg("m1")]
            }
            if calls == 2 {
                XCTAssertTrue(wait)
                XCTAssertEqual(afterId, "m1")
                // A send confirms m3 while receive is still fetching m2.
                store.mergeIncoming([self.msg("m3", at: "2026-01-01T10:02:00.000Z")], roomId: "trip:test")
                return [self.msg("m2", at: "2026-01-01T10:01:00.000Z")]
            }
            XCTAssertEqual(afterId, "m2", "Confirmed send cannot skip a receive cursor")
            listening.fulfill()
            try await Task.sleep(for: .seconds(60))
            return []
        }
        let loop = Task { await store.runActiveRoomLoop("trip:test") }
        defer { loop.cancel() }
        await fulfillment(of: [listening], timeout: 0.75)
        XCTAssertEqual(store.messagesByRoom["trip:test"]?.map(\.id), ["m1", "m2", "m3"])
    }

    func testImmediateDuplicateResponseRetainsBackoff() async {
        let service = ChatService()
        let store = AppStore(chatService: service)
        let firstPoll = expectation(description: "First long poll")
        let spun = expectation(description: "No tight loop on an older server")
        spun.isInverted = true
        var calls = 0
        service.receive = { _, _ in
            calls += 1
            if calls == 2 { firstPoll.fulfill() }
            if calls > 2 { spun.fulfill() }
            return [self.msg("m1")]
        }
        let loop = Task { await store.runActiveRoomLoop("trip:test") }
        defer { loop.cancel() }
        await fulfillment(of: [firstPoll], timeout: 0.75)
        await fulfillment(of: [spun], timeout: 0.2)
    }

    func testInitialSnapshotRetainsConcurrentConfirmedSend() async {
        let service = ChatService()
        let store = AppStore(chatService: service)
        let listening = expectation(description: "Snapshot applied")
        service.receive = { _, wait in
            if wait {
                listening.fulfill()
                try await Task.sleep(for: .seconds(60))
                return []
            }
            store.mergeIncoming([self.msg("sent", at: "2026-01-01T10:02:00.000Z")], roomId: "trip:test")
            return [self.msg("earlier")]
        }
        let loop = Task { await store.runActiveRoomLoop("trip:test") }
        defer { loop.cancel() }
        await fulfillment(of: [listening], timeout: 0.75)
        XCTAssertEqual(store.messagesByRoom["trip:test"]?.map(\.id), ["earlier", "sent"])
    }

    func testLateReceiveCannotEnterAnotherAccount() async {
        let service = ChatService()
        let store = AppStore(chatService: service)
        store.me = User(id: "before", email: "a@example.com", name: "Before", role: "parent")
        service.receive = { _, _ in
            store.me = User(id: "after", email: "b@example.com", name: "After", role: "parent")
            return [self.msg("private")]
        }
        await store.runActiveRoomLoop("trip:test")
        XCTAssertNil(store.messagesByRoom["trip:test"])
    }

    func testCancelledReceiveCannotApplyLateSnapshot() async {
        let service = ChatService()
        let store = AppStore(chatService: service)
        let started = expectation(description: "Request started")
        var response: CheckedContinuation<[ChatMessage], Never>?
        service.receive = { _, _ in
            await withCheckedContinuation { continuation in
                response = continuation
                started.fulfill()
            }
        }
        let loop = Task { await store.runActiveRoomLoop("trip:test") }
        await fulfillment(of: [started], timeout: 0.75)
        loop.cancel()
        response?.resume(returning: [msg("late")])
        await loop.value
        XCTAssertNil(store.messagesByRoom["trip:test"])
    }

    func testIdentityRefreshRearmsWaitingFamilyRoomWhileDashboardStillLoads() async {
        let service = ChatService()
        let store = AppStore(chatService: service)
        let listening = expectation(description: "Family chat listens while dashboard is refreshing")
        var requests = 0
        service.receive = { _, wait in
            requests += 1
            XCTAssertTrue(store.isRefreshing)
            if wait {
                listening.fulfill()
                try await Task.sleep(for: .seconds(60))
            }
            return []
        }
        store.isRefreshing = true
        store.activeRoomId = familyRoomId
        // Let the pre-identity loop reach its no-family suspension.
        await Task.yield()
        XCTAssertEqual(requests, 0)
        store.me = User(id: "parent", email: "parent@example.com", name: "Parent", role: "parent")
        store.family = Family(id: "f1", name: "Family", inviteCode: "ABC123", parentIds: ["parent"],
                              parents: [], kids: [], createdAt: "2026-01-01T00:00:00.000Z")
        // This is the restart boundary immediately after refresh's identity
        // requests, before awaiting its calendar/homework/notes/meals loads.
        store.restartChatLoop()
        defer { store.chatDidEnterBackground() }
        await fulfillment(of: [listening], timeout: 0.75)
        XCTAssertEqual(requests, 2, "One initial fetch and one long poll, without a second active loop")
    }

}
