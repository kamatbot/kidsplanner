import XCTest
@testable import FamETC

/// Regression tests for the TestFlight build-24 crash: `mergeIncoming` built
/// its index with `Dictionary(uniqueKeysWithValues:)`, which TRAPS when
/// `messages` holds a duplicate id (an optimistic send-append racing a
/// long-poll delta). The merge must tolerate and collapse duplicates instead.
@MainActor
final class ChatMergeTests: XCTestCase {

    private func msg(_ id: String, text: String = "hi", at: String = "2026-01-01T10:00:00.000Z") -> ChatMessage {
        ChatMessage(id: id, familyId: "f1", senderType: "parent", senderId: "u1",
                    postedByUserId: nil, text: text, card: nil, media: nil,
                    createdAt: at, deleted: false, deletedBy: nil,
                    flagged: false, flagReason: nil, flaggedBy: nil)
    }

    func testMergeSurvivesDuplicateIdsInExistingMessages() {
        let store = AppStore()
        // The exact pre-crash state: same id twice in the live array.
        store.messages = [msg("m1"), msg("m1", text: "dupe"), msg("m2", at: "2026-01-01T10:01:00.000Z")]
        store.mergeIncoming([msg("m3", at: "2026-01-01T10:02:00.000Z")])   // build 24 crashed here
        XCTAssertEqual(store.messages.map(\.id), ["m1", "m2", "m3"], "duplicates must collapse, order by createdAt")
    }

    func testMergeDedupesOverlappingDelta() {
        let store = AppStore()
        store.messages = [msg("m1"), msg("m2", at: "2026-01-01T10:01:00.000Z")]
        store.mergeIncoming([msg("m2", text: "updated", at: "2026-01-01T10:01:00.000Z"),
                             msg("m3", at: "2026-01-01T10:02:00.000Z")])
        XCTAssertEqual(store.messages.map(\.id), ["m1", "m2", "m3"])
        XCTAssertEqual(store.messages[1].text, "updated", "fresh copy wins for an existing id")
    }
}
