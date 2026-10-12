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
