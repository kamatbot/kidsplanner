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

// MARK: - Response wrappers (thin, match server.js route shapes)

struct FamiliesResponse: Codable { var families: [Family] }
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
