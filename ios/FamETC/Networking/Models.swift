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

/// A homework|event reference attached to a chat message.
struct ChatCard: Codable {
    let type: String   // "homework" | "event"
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
struct FamilyEvent: Codable, Identifiable {
    let id: String
    var title: String
    var date: String      // YYYY-MM-DD
    var time: String?     // HH:mm
    var endTime: String?
    var notes: String?
    var category: String?
    var kidId: String?
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
