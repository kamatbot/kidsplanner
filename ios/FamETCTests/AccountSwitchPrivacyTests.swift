import XCTest
@testable import FamETC

/// Shared-device privacy: when the signed-in user id changes without an explicit
/// sign-out (re-auth overlay, backup-code sign-in), nothing from the previous
/// account — chat (incl. the private Hermes thread), notes, pending deep links —
/// may survive for the next one.
@MainActor
final class AccountSwitchPrivacyTests: XCTestCase {

    private func msg(_ id: String) -> ChatMessage {
        ChatMessage(id: id, familyId: "f1", senderType: "parent", senderId: "u1",
                    postedByUserId: nil, text: "private", card: nil, media: nil,
                    createdAt: "2026-01-01T10:00:00.000Z", deleted: false, deletedBy: nil,
                    flagged: false, flagReason: nil, flaggedBy: nil)
    }

    private func note(_ id: String) -> Note {
        Note(id: id, authorType: "parent", authorId: "u1", date: "2026-01-01", body: "mine", source: "manual", ref: nil)
    }

    private func seed(_ store: AppStore) {
        store.me = User(id: "u1", email: "a@x.com", name: "A", role: "parent")
        store.messagesByRoom = [familyRoomId: [msg("m1")], "hermes": [msg("h1")]]
        store.notes = [note("n1")]
        store.pendingChatRoomId = "trip:1"
        store.pendingHermesOpen = .goals
    }

    func testAccountSwitchClearsPreviousUsersData() {
        let store = AppStore()
        seed(store)
        store.me = User(id: "u2", email: "b@x.com", name: "B", role: "kid", kidId: "k1")
        XCTAssertTrue(store.messagesByRoom.isEmpty, "all rooms incl. private hermes thread must be dropped")
        XCTAssertTrue(store.notes.isEmpty)
        XCTAssertNil(store.pendingChatRoomId)
        XCTAssertNil(store.pendingHermesOpen)
        XCTAssertEqual(store.me?.id, "u2", "the newly fetched user is kept")
    }

    func testSameUserRefreshKeepsData() {
        let store = AppStore()
        seed(store)
        store.me = User(id: "u1", email: "a@x.com", name: "A renamed", role: "parent")
        XCTAssertEqual(store.messagesByRoom["hermes"]?.count, 1)
        XCTAssertEqual(store.notes.count, 1)
    }
}
