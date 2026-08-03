import Foundation

// MARK: - Domain models
//
// Mirrors server.js's lib/family.js and lib/chat.js response shapes exactly.
// Kept intentionally small — this is the whole Fam ETC domain model.

struct User: Codable, Identifiable {
    let id: String
    let email: String
    var name: String?
    var role: String? = nil    // "parent" | "kid" (matches server publicProfile)
    var kidId: String? = nil   // set when role == "kid" — the kid profile id
}

/// A parent member of a family, with a display name resolved server-side.
/// Mirrors `publicFamily().parents` (server lib/family.js).
struct Parent: Codable, Identifiable {
    let id: String
    var name: String?
}

struct Kid: Codable, Identifiable {
    let id: String
    var name: String
    var grade: String
    var color: String
    let createdAt: String
    // NOTE: no `email` field — kids never get one, per privacy requirement.
}

struct Family: Codable, Identifiable {
    let id: String
    var name: String
    let inviteCode: String
    var parentIds: [String]
    var parents: [Parent]? = nil   // id + display name for each parent (optional for cache back-compat)
    var kids: [Kid]
    let createdAt: String
}

/// A structured chat card: family homework/event references are tappable;
/// trip-* cards are informational timeline updates with category styling.
struct ChatCard: Codable {
    let type: String   // "homework" | "event" | "trip-flight" | ...
    let id: String
    var title: String?
}

/// A GIF attached to a chat message (Giphy). Mirrors the server's `media` shape
/// so a GIF sent from the web renders in the native app too.
struct ChatMedia: Codable {
    let type: String       // "gif"
    var url: String?
    var previewUrl: String?
    var width: Int?
    var height: Int?
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let familyId: String
    let senderType: String   // "parent" | "kid"
    let senderId: String
    var postedByUserId: String?
    var text: String
    var card: ChatCard?
    var media: ChatMedia? = nil
    let createdAt: String
    var deleted: Bool
    var deletedBy: String?
    var flagged: Bool
    var flagReason: String?
    var flaggedBy: String?
    /// Trips (docs/TRIPS-PLAN.md): "family" or "trip:<tripId>". Optional so old
    /// cached/decoded messages (pre-Trips) keep decoding — treat a missing value
    /// as the family room.
    var roomId: String? = nil
    /// Server-resolved sender display name — set for trip rooms, where the
    /// sender may be a guest the client can't resolve via `family.parents`/
    /// `family.kids`. Optional/back-compat; family-room messages may also carry
    /// it (harmless — `AppStore.senderName(for:)` prefers it when present).
    var senderName: String? = nil
}

/// The room id for the always-present family chat thread (docs/TRIPS-PLAN.md).
/// Every existing family-chat call site defaults to this room, so a build with
/// no trips behaves exactly as before.
let familyRoomId = "family"

/// One chat room (`GET /api/chat/rooms`): the family thread, or a per-trip
/// thread scoped `"trip:<tripId>"`. Drives the iOS Chat tab's room list once a
/// user has more than the family room.
struct ChatRoom: Decodable, Identifiable {
    let roomId: String
    var tripId: String? = nil
    var title: String
    var memberCount: Int? = nil

    var id: String { roomId }
}

/// A pending kid sign-in request awaiting a parent's approval. Mirrors the
/// server's publicForParent shape (lib/kid-access.js): a kid entered the family
/// invite code + a name on their device; approving creates the kid profile and
/// lets them register a passkey.
struct KidAccessRequest: Codable, Identifiable {
    let id: String
    var name: String
    var deviceLabel: String?
    let createdAt: String
}

/// A calendar event from a subscribed school feed (read-only). Mirrors the
/// objects returned by `/api/calendar/sync` (lib/school-feeds.collectFromCache).
struct CalendarEvent: Codable, Identifiable {
    var uid: String?
    var title: String
    var start: String?     // ISO-8601 (or all-day date)
    var end: String?
    var allDay: Bool?
    var location: String?
    var feedLabel: String?
    var kidId: String?
    var isDeadline: Bool?
    var type: String?      // "event" | "deadline"

    var id: String { uid ?? "\(feedLabel ?? "")|\(title)|\(start ?? "")" }
}

/// A manually-added family appointment (`/api/calendar/events`), server-synced
/// across the family. Distinct from read-only school-feed `CalendarEvent`s.
///
/// The server expands a recurring series into occurrences (lib/events.js
/// `expandRecurring`): every occurrence shares the series' `id`, and carries
/// `seriesId`/`recurring`/`occurrenceDate` plus `date`/`endDate` shifted to
/// that occurrence. Non-recurring events keep the plain shape with those
/// fields nil.
struct FamilyEvent: Codable, Identifiable {
    let id: String
    var title: String
    var date: String      // YYYY-MM-DD
    var time: String?     // HH:mm
    var endTime: String?
    var endDate: String?      // YYYY-MM-DD — multi-day span end (nil = single day)
    var notes: String?
    var category: String?
    var kidId: String?
    var repeatRule: String?   // "none" | "daily" | "weekly" | "biweekly" | "monthly" (server key "repeat")
    var repeatUntil: String?  // YYYY-MM-DD
    var seriesId: String?     // set on expanded occurrences — the series' event id
    var recurring: Bool?      // true on expanded occurrences
    var occurrenceDate: String?  // this occurrence's date (== date) on expanded occurrences
    /// True when the signed-in user created this event OR is a parent (server-computed,
    /// GET /api/calendar/events). Optional for cache/back-compat — treat nil as false
    /// (not editable/deletable) since the app always round-trips through the server.
    var canEdit: Bool?

    /// True for a recurring series or any of its expanded occurrences.
    var isRecurring: Bool { recurring == true || (repeatRule ?? "none") != "none" }

    private enum CodingKeys: String, CodingKey {
        case id, title, date, time, endTime, endDate, notes, category, kidId
        case repeatRule = "repeat"
        case repeatUntil, seriesId, recurring, occurrenceDate, canEdit
    }
}

/// A homework item (`/api/homework`). Kids see their own; parents see the family's.
struct HomeworkItem: Codable, Identifiable {
    let id: String
    var kidId: String?
    var title: String
    var subject: String?
    var dueDate: String    // YYYY-MM-DD
    var dueTime: String?   // HH:mm
    var status: String     // "todo" | "in_progress" | "done"
    var effortMin: Int?

    var isDone: Bool { status == "done" }
}

/// A GIF result from the Giphy proxy (`/api/gifs/*`).
struct GifResult: Codable, Identifiable {
    let id: String
    var previewUrl: String
    var url: String
    var width: Int?
    var height: Int?
}

/// A ref pointer attached to a note back to the thing it was pinned from
/// (a quote, a chat message, a news item, etc). Mirrors `lib/notes.js`.
struct NoteRef: Codable {
    var kind: String
    var id: String
    var context: String?
}

/// A parent/kid reflection or pinned snippet (`/api/notes`). Mirrors
/// `lib/notes.js`'s note shape.
struct Note: Codable, Identifiable {
    let id: String
    var authorType: String   // "kid" | "parent"
    var authorId: String
    var date: String         // YYYY-MM-DD
    var body: String
    var source: String       // "manual" | "quote" | "sat" | "chat" | "social" | "news"
    var ref: NoteRef?
}

struct NotesResponse: Codable { var notes: [Note] }
struct NoteResponse: Codable { var note: Note }

/// A single word bank entry (`/api/wordbank`). Mirrors `lib/wordbank.js`.
struct WordBankEntry: Codable, Identifiable {
    var word: String
    var state: String   // "learning" | "mastered" | "known"
    var seenCount: Int
    var correctCount: Int

    var id: String { word }
}

struct WordStats: Codable {
    var learning: Int
    var mastered: Int
    var known: Int
}

struct WordBankResponse: Codable { var words: [WordBankEntry]; var stats: WordStats }
struct WordEntryResponse: Codable { var entry: WordBankEntry }

struct WordQuizQuestion: Codable {
    var word: String
    var prompt: String
    var options: [String]
    var answerIndex: Int
}

struct WordQuizResponse: Codable {
    var questions: [WordQuizQuestion]
    var needMore: Bool? = nil
}

/// A single brain teaser question served for the day (`/api/brainteaser/today`).
/// Mirrors `lib/brainteaser.js`.
struct BrainTeaserQ: Codable, Identifiable {
    var qid: String
    var q: String
    var options: [String]
    var answerIndex: Int
    var resurfaced: Bool? = nil

    var id: String { qid }
}

struct BrainTeaserTodayResponse: Codable {
    var date: String
    var count: Int
    var questions: [BrainTeaserQ]
}

// MARK: - Response wrappers (thin, match server.js route shapes)

struct FamiliesResponse: Codable { var families: [Family] }
struct GifsResponse: Codable { var gifs: [GifResult] }
struct CalendarSyncResponse: Codable { var events: [CalendarEvent]?; var lastSyncAt: String?; var throttled: Bool? }
struct FamilyEventsResponse: Codable { var events: [FamilyEvent] }
struct FamilyEventResponse: Codable { var event: FamilyEvent }
struct HomeworkResponse: Codable { var homework: [HomeworkItem] }
struct HomeworkItemResponse: Codable { var homework: HomeworkItem }
struct FamilyResponse: Codable { var family: Family }
struct FamilyKidResponse: Codable { var family: Family; var kid: Kid }
struct KidAccessRequestsResponse: Codable { var requests: [KidAccessRequest] }
struct MessagesResponse: Codable { var messages: [ChatMessage] }
struct MessageResponse: Codable { var message: ChatMessage }
struct OKResponse: Codable { var ok: Bool }

struct UploadResponse: Codable {
    var ok: Bool
    var filename: String
    var size: Int
    var mimetype: String
}

struct BillingStatusResponse: Codable {
    var status: String?
    var plan: String?
    var currentPeriodEnd: String?
}
struct BillingCheckoutResponse: Codable { var url: String? }
struct BillingPortalResponse: Codable { var url: String? }

struct HealthResponse: Codable { var ok: Bool?; var status: String? }
struct MeResponse: Codable { var user: User? }

// MARK: - Meals (parent-gated: /api/meals/*, /api/ai/parse)
//
// Mirrors the server's meals shapes. Parent-only feature — kid sessions never
// call these endpoints (AppStore.loadMeals guards on isParent).

/// `category` ∈ produce, protein, dairy, grain, pantry, frozen, spice, other.
/// `level` ∈ "plenty" | "some" | "low".
struct PantryItem: Codable, Identifiable {
    let id: String
    var name: String
    var category: String
    var level: String
    var unitHint: String? = nil
    var expiresOn: String? = nil
    var updatedAt: String? = nil
    var updatedBy: String? = nil
}

/// `slot` is usually "dinner"; unknown/extra server fields are ignored by Codable.
struct MenuEntry: Codable, Identifiable {
    let id: String
    var date: String     // YYYY-MM-DD
    var slot: String? = nil
    var title: String
    var note: String? = nil
    var recipeId: String? = nil
    var createdAt: String? = nil
    var cookedAt: String? = nil

    var isCooked: Bool { cookedAt != nil }
}

struct ShoppingItem: Codable, Identifiable {
    let id: String
    var name: String
    var category: String? = nil
    var qty: String? = nil
    var checked: Bool
}

struct MealsTargets: Codable {
    var proteinGPerMeal: Int? = nil
    var fiberGPerMeal: Int? = nil
}

struct MealsPrefs: Codable {
    var dinnerTime: String? = nil
    var cuisines: [String]? = nil
    var avoid: [String]? = nil
    var diets: [String]? = nil
    var targets: MealsTargets? = nil
}

/// `GET /api/meals` response body — pantryEvents is server-internal audit data
/// the app doesn't render, so it's left undeclared (Codable ignores unknown keys).
struct MealsState: Codable {
    var pantry: [PantryItem] = []
    var menu: [MenuEntry] = []
    var shopping: [ShoppingItem] = []
    var prefs: MealsPrefs? = nil
}

/// One item detected from a pantry photo (`POST /api/ai/parse`, kind:"pantry") —
/// reviewed/edited by the user before bulk-adding to the pantry. `id` is local-only
/// (not sent to/from the server) so the review list can identify rows for editing.
struct ScannedPantryItem: Codable, Identifiable {
    var id = UUID()
    var name: String
    var category: String
    var levelGuess: String
    var unitHint: String? = nil

    private enum CodingKeys: String, CodingKey { case name, category, levelGuess, unitHint }
}

struct PantryItemResponse: Codable { var item: PantryItem }
struct PantryItemsResponse: Codable { var items: [PantryItem] }
struct MenuEntryResponse: Codable { var entry: MenuEntry }
struct ShoppingItemResponse: Codable { var item: ShoppingItem }
struct AIParsePantryResponse: Codable { var items: [ScannedPantryItem] }
