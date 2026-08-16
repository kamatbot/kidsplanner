import XCTest
@testable import FamETC

final class BuzzTests: XCTestCase {

    func testLegacyChatMessageWithoutBuzzDecodesAsNonBuzz() throws {
        let message = try decodeMessage(buzz: nil)

        XCTAssertNil(message.buzz)
        XCTAssertFalse(message.isBuzz)
    }

    func testCurrentChatMessageWithBuzzTrueDecodesAsBuzz() throws {
        let message = try decodeMessage(buzz: true)

        XCTAssertEqual(message.buzz, true)
        XCTAssertTrue(message.isBuzz)
    }

    func testChatBuzzRoutesUseExactRoomEndpointsAndEncodeTripId() {
        XCTAssertEqual(APIClient.chatBuzzPath(for: familyRoomId), "/api/chat/buzz")
        XCTAssertEqual(
            APIClient.chatBuzzPath(for: "trip:trip/id with spaces?and#fragment"),
            "/api/trips/trip%2Fid%20with%20spaces%3Fand%23fragment/chat/buzz"
        )
    }

    private func decodeMessage(buzz: Bool?) throws -> ChatMessage {
        var payload: [String: Any] = [
            "id": "buzz-test",
            "familyId": "family-test",
            "senderType": "parent",
            "senderId": "user-test",
            "text": "Meet at the gate",
            "card": NSNull(),
            "createdAt": "2026-08-14T10:00:00.000Z",
            "deleted": false,
            "deletedBy": NSNull(),
            "flagged": false,
            "flagReason": NSNull(),
            "flaggedBy": NSNull(),
        ]
        if let buzz { payload["buzz"] = buzz }
        let data = try JSONSerialization.data(withJSONObject: payload)
        return try JSONDecoder().decode(ChatMessage.self, from: data)
    }
}
