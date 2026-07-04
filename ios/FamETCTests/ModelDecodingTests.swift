import XCTest
@testable import FamETC

/// Guards the hand-written Codable layer against drift from server.js's actual
/// response shapes (lib/family.js publicFamily, lib/chat.js sendMessage/listMessages).
final class ModelDecodingTests: XCTestCase {

    private let chatPayload = """
    {
      "messages": [
        {
          "id": "m_1",
          "familyId": "f_1",
          "senderType": "parent",
          "senderId": "u_1",
          "postedByUserId": "u_1",
          "text": "Don't forget soccer practice at 5!",
          "card": null,
          "createdAt": "2026-07-03T12:00:00.000Z",
          "deleted": false,
          "deletedBy": null,
          "flagged": false,
          "flagReason": null,
          "flaggedBy": null
        },
        {
          "id": "m_2",
          "familyId": "f_1",
          "senderType": "kid",
          "senderId": "k_1",
          "postedByUserId": "u_1",
          "text": "Ok!",
          "card": { "type": "event", "id": "e_1", "title": "Soccer practice" },
          "createdAt": "2026-07-03T12:05:00.000Z",
          "deleted": false,
          "deletedBy": null,
          "flagged": false,
          "flagReason": null,
          "flaggedBy": null
        }
      ]
    }
    """

    func testDecodesMessagesResponse() throws {
        let r = try JSONDecoder().decode(MessagesResponse.self, from: Data(chatPayload.utf8))
        XCTAssertEqual(r.messages.count, 2)
        XCTAssertEqual(r.messages[0].senderType, "parent")
        XCTAssertEqual(r.messages[1].senderType, "kid")
        XCTAssertEqual(r.messages[1].card?.type, "event")
        XCTAssertEqual(r.messages[1].card?.title, "Soccer practice")
        XCTAssertNil(r.messages[0].card)
        XCTAssertFalse(r.messages[0].deleted)
    }

    func testChatMessageEncodeDecodeRoundTrip() throws {
        let original = ChatMessage(
            id: "m_99",
            familyId: "f_1",
            senderType: "parent",
            senderId: "u_1",
            postedByUserId: "u_1",
            text: "Round trip test",
            card: ChatCard(type: "homework", id: "h_1", title: "Math worksheet"),
            createdAt: "2026-07-03T12:00:00.000Z",
            deleted: false,
            deletedBy: nil,
            flagged: false,
            flagReason: nil,
            flaggedBy: nil
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(ChatMessage.self, from: data)
        XCTAssertEqual(decoded.id, original.id)
        XCTAssertEqual(decoded.text, original.text)
        XCTAssertEqual(decoded.card?.id, original.card?.id)
        XCTAssertEqual(decoded.card?.title, original.card?.title)
    }

    func testDecodesMessageWithGifMedia() throws {
        let payload = """
        {
          "message": {
            "id": "m_3", "familyId": "f_1", "senderType": "parent", "senderId": "u_1",
            "postedByUserId": "u_1", "text": "", "card": null,
            "media": { "type": "gif", "url": "https://giphy.com/x.gif", "previewUrl": "https://giphy.com/x-preview.gif", "width": 200, "height": 150 },
            "createdAt": "2026-07-04T09:00:00.000Z",
            "deleted": false, "deletedBy": null, "flagged": false, "flagReason": null, "flaggedBy": null
          }
        }
        """
        let r = try JSONDecoder().decode(MessageResponse.self, from: Data(payload.utf8))
        XCTAssertEqual(r.message.media?.type, "gif")
        XCTAssertEqual(r.message.media?.previewUrl, "https://giphy.com/x-preview.gif")
        XCTAssertEqual(r.message.media?.width, 200)
    }

    func testDecodesFamilyWithParentsNames() throws {
        let payload = """
        {
          "family": {
            "id": "f_1", "name": "The Smiths", "inviteCode": "ABC123",
            "parentIds": ["u_1", "u_2"],
            "parents": [ { "id": "u_1", "name": "Mona" }, { "id": "u_2", "name": null } ],
            "kids": [], "createdAt": "2026-07-01T00:00:00.000Z"
          }
        }
        """
        let r = try JSONDecoder().decode(FamilyResponse.self, from: Data(payload.utf8))
        XCTAssertEqual(r.family.parents?.count, 2)
        XCTAssertEqual(r.family.parents?.first?.name, "Mona")
        XCTAssertNil(r.family.parents?[1].name)
    }

    func testDecodesMeWithRoleAndKidId() throws {
        let payload = """
        { "user": { "id": "u_kid", "email": "", "name": "Arya", "role": "kid", "kidId": "k_9" } }
        """
        let r = try JSONDecoder().decode(MeResponse.self, from: Data(payload.utf8))
        XCTAssertEqual(r.user?.role, "kid")
        XCTAssertEqual(r.user?.kidId, "k_9")
    }

    func testDecodesFamilyResponseWithKidsNoEmailField() throws {
        let payload = """
        {
          "family": {
            "id": "f_1",
            "name": "The Smiths",
            "inviteCode": "ABC123",
            "parentIds": ["u_1"],
            "kids": [
              { "id": "k_1", "name": "Ava", "grade": "3", "color": "#6C63FF", "createdAt": "2026-07-01T00:00:00.000Z" }
            ],
            "createdAt": "2026-07-01T00:00:00.000Z"
          }
        }
        """
        let r = try JSONDecoder().decode(FamilyResponse.self, from: Data(payload.utf8))
        XCTAssertEqual(r.family.kids.count, 1)
        XCTAssertEqual(r.family.kids[0].name, "Ava")
        XCTAssertEqual(r.family.inviteCode, "ABC123")
    }
}
