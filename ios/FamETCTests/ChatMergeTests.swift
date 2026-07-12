import XCTest
@testable import FamETC

/// Regression tests for the TestFlight build-24 crash: send paths blind-
/// appended a message the long-poll had already merged, `persist()` wrote the
/// duplicate id into the disk cache, and `Dictionary(uniqueKeysWithValues:)`
/// inside `mergeIncoming` trapped on the next merge — or on the next LAUNCH,
/// via the poisoned cache (AppStore.swift:306 in the symbolicated log).
/// Every message source must now land through one deduplicating path.
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

    /// Fresh copy replaces the stale one for an existing id.
    func testMergeDedupesOverlappingDelta() {
        let store = AppStore()
        store.messages = [msg("m1"), msg("m2", at: "2026-01-01T10:01:00.000Z")]
        store.mergeIncoming([msg("m2", text: "updated", at: "2026-01-01T10:01:00.000Z"),
                             msg("m3", at: "2026-01-01T10:02:00.000Z")])
        XCTAssertEqual(store.messages.map(\.id), ["m1", "m2", "m3"])
        XCTAssertEqual(store.messages[1].text, "updated", "fresh copy wins for an existing id")
    }
}
