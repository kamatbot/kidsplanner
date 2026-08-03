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

    /// Mirrors an expanded occurrence from lib/events.js `expandRecurring`: the
    /// `repeat` JSON key (a Swift keyword) maps to `repeatRule`, and the
    /// recurrence-only fields (seriesId/recurring/occurrenceDate/endDate) decode.
    func testDecodesFamilyEventRecurringOccurrence() throws {
        let payload = """
        {
          "event": {
            "id": "ev_1", "title": "Soccer camp", "date": "2026-07-13",
            "endDate": "2026-07-14", "time": "09:00", "endTime": null,
            "notes": null, "category": "sports", "kidId": null,
            "repeat": "weekly", "repeatUntil": "2026-08-30",
            "seriesId": "ev_1", "recurring": true, "occurrenceDate": "2026-07-13"
          }
        }
        """
        let r = try JSONDecoder().decode(FamilyEventResponse.self, from: Data(payload.utf8))
        XCTAssertEqual(r.event.repeatRule, "weekly")
        XCTAssertTrue(r.event.isRecurring)
        XCTAssertEqual(r.event.endDate, "2026-07-14")
        XCTAssertEqual(r.event.seriesId, "ev_1")
        XCTAssertEqual(r.event.occurrenceDate, "2026-07-13")
    }

    func testDecodesPlainFamilyEventWithNoRecurrenceExtras() throws {
        let payload = """
        {
          "event": {
            "id": "ev_2", "title": "Dentist", "date": "2026-07-15",
            "time": "14:00", "notes": null, "category": "other", "kidId": null
          }
        }
        """
        let r = try JSONDecoder().decode(FamilyEventResponse.self, from: Data(payload.utf8))
        XCTAssertNil(r.event.repeatRule)
        XCTAssertNil(r.event.endDate)
        XCTAssertNil(r.event.seriesId)
        XCTAssertFalse(r.event.isRecurring)
    }

    /// `canEdit` (GET /api/calendar/events) is true when this user created the
    /// event or is a parent; a kid-created event another kid can't touch omits
    /// it as false. Missing entirely (back-compat/cache) must decode to nil,
    /// which the UI treats as not-editable.
    func testDecodesFamilyEventCanEdit() throws {
        let payload = """
        {
          "event": {
            "id": "ev_3", "title": "Piano lesson", "date": "2026-07-16",
            "time": null, "notes": null, "category": "other", "kidId": null,
            "canEdit": true
          }
        }
        """
        let r = try JSONDecoder().decode(FamilyEventResponse.self, from: Data(payload.utf8))
        XCTAssertEqual(r.event.canEdit, true)
    }

    func testDecodesFamilyEventMissingCanEditAsNil() throws {
        let payload = """
        {
          "event": {
            "id": "ev_4", "title": "Someone else's event", "date": "2026-07-17",
            "time": null, "notes": null, "category": "other", "kidId": null
          }
        }
        """
        let r = try JSONDecoder().decode(FamilyEventResponse.self, from: Data(payload.utf8))
        XCTAssertNil(r.event.canEdit)
    }

    // MARK: - Trips (docs/TRIPS-PLAN.md)

    /// A trip chat message carries `roomId`/`senderName` (server can't resolve
    /// a guest's name via `family.parents`, so it's sent pre-resolved).
    func testDecodesChatMessageWithRoomIdAndSenderName() throws {
        let payload = """
        {
          "message": {
            "id": "m_5", "familyId": "f_1", "senderType": "parent", "senderId": "u_9",
            "postedByUserId": "u_9", "text": "See you at the gate!", "card": null,
            "createdAt": "2026-07-04T09:00:00.000Z",
            "deleted": false, "deletedBy": null, "flagged": false, "flagReason": null, "flaggedBy": null,
            "roomId": "trip:t_1", "senderName": "Jamie (guest)"
          }
        }
        """
        let r = try JSONDecoder().decode(MessageResponse.self, from: Data(payload.utf8))
        XCTAssertEqual(r.message.roomId, "trip:t_1")
        XCTAssertEqual(r.message.senderName, "Jamie (guest)")
    }

    /// A message from a pre-Trips server (or old cache) omits `roomId`/
    /// `senderName` entirely — both must decode to nil, never fail decoding.
    func testDecodesChatMessageMissingRoomIdAndSenderNameAsNil() throws {
        let r = try JSONDecoder().decode(MessagesResponse.self, from: Data(chatPayload.utf8))
        XCTAssertNil(r.messages[0].roomId)
        XCTAssertNil(r.messages[0].senderName)
    }

    /// `GET /api/chat/rooms` is a bare array (no wrapper object); the family
    /// entry has no `tripId`/`memberCount`, the trip entry has both.
    func testDecodesChatRoomsArray() throws {
        let payload = """
        [
          { "roomId": "family", "title": "The Smiths" },
          { "roomId": "trip:t_1", "tripId": "t_1", "title": "Lisbon 2026", "memberCount": 4 }
        ]
        """
        let rooms = try JSONDecoder().decode([ChatRoom].self, from: Data(payload.utf8))
        XCTAssertEqual(rooms.count, 2)
        XCTAssertEqual(rooms[0].roomId, "family")
        XCTAssertNil(rooms[0].tripId)
        XCTAssertEqual(rooms[1].tripId, "t_1")
        XCTAssertEqual(rooms[1].memberCount, 4)
        XCTAssertEqual(rooms[1].id, "trip:t_1")
    }

    // MARK: - Meals (parent-gated /api/meals)

    /// `GET /api/meals` — pantry/menu/shopping/prefs, per the Meals feature's
    /// server contract. `pantryEvents` is present in the real payload but
    /// undeclared on `MealsState` (server-internal audit data the app doesn't
    /// render) — Codable must ignore it rather than fail decoding.
    func testDecodesMealsState() throws {
        let payload = """
        {
          "pantry": [
            { "id": "p_1", "name": "Milk", "category": "dairy", "level": "low", "unitHint": "1 gallon", "expiresOn": "2026-08-10", "updatedAt": "2026-08-01T00:00:00.000Z", "updatedBy": "u_1" }
          ],
          "pantryEvents": [ { "type": "restock", "pantryId": "p_1" } ],
          "menu": [
            { "id": "m_1", "date": "2026-08-05", "slot": "dinner", "title": "Tacos", "note": "Kid-friendly", "createdAt": "2026-08-01T00:00:00.000Z" }
          ],
          "shopping": [
            { "id": "s_1", "name": "Eggs", "category": "dairy", "checked": false }
          ],
          "prefs": {
            "dinnerTime": "18:30",
            "cuisines": ["mexican", "italian"],
            "avoid": ["peanuts"],
            "diets": [],
            "targets": { "proteinGPerMeal": 25, "fiberGPerMeal": 8 }
          }
        }
        """
        let state = try JSONDecoder().decode(MealsState.self, from: Data(payload.utf8))
        XCTAssertEqual(state.pantry.count, 1)
        XCTAssertEqual(state.pantry[0].level, "low")
        XCTAssertEqual(state.pantry[0].unitHint, "1 gallon")
        XCTAssertEqual(state.menu.count, 1)
        XCTAssertEqual(state.menu[0].title, "Tacos")
        XCTAssertFalse(state.menu[0].isCooked)
        XCTAssertEqual(state.shopping.count, 1)
        XCTAssertFalse(state.shopping[0].checked)
        XCTAssertEqual(state.prefs?.dinnerTime, "18:30")
        XCTAssertEqual(state.prefs?.targets?.proteinGPerMeal, 25)
    }

    /// A minimal payload (empty arrays, no prefs) — the shape a brand-new family
    /// gets before adding anything — must decode without any optional exploding.
    func testDecodesEmptyMealsState() throws {
        let payload = """
        { "pantry": [], "menu": [], "shopping": [] }
        """
        let state = try JSONDecoder().decode(MealsState.self, from: Data(payload.utf8))
        XCTAssertTrue(state.pantry.isEmpty)
        XCTAssertTrue(state.menu.isEmpty)
        XCTAssertTrue(state.shopping.isEmpty)
        XCTAssertNil(state.prefs)
    }

    /// `POST /api/ai/parse` (kind:"pantry") response — the AI-detected items
    /// shown in the pantry-scan review list before the user confirms/bulk-adds.
    func testDecodesAIParsePantryResponse() throws {
        let payload = """
        {
          "items": [
            { "name": "Carrots", "category": "produce", "levelGuess": "plenty", "unitHint": "1 bag" },
            { "name": "Chicken breast", "category": "protein", "levelGuess": "some" }
          ]
        }
        """
        let r = try JSONDecoder().decode(AIParsePantryResponse.self, from: Data(payload.utf8))
        XCTAssertEqual(r.items.count, 2)
        XCTAssertEqual(r.items[0].name, "Carrots")
        XCTAssertEqual(r.items[0].levelGuess, "plenty")
        XCTAssertEqual(r.items[1].unitHint, nil)
    }

    /// A cooked menu entry carries `cookedAt`; `isCooked` must reflect it.
    func testDecodesCookedMenuEntry() throws {
        let payload = """
        {
          "entry": {
            "id": "m_2", "date": "2026-08-06", "slot": "dinner", "title": "Pasta",
            "createdAt": "2026-08-01T00:00:00.000Z", "cookedAt": "2026-08-06T19:00:00.000Z"
          }
        }
        """
        let r = try JSONDecoder().decode(MenuEntryResponse.self, from: Data(payload.utf8))
        XCTAssertTrue(r.entry.isCooked)
    }
}
