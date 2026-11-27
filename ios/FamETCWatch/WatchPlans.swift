import Foundation

/// What the server added from one spoken note (POST /api/kid-plans).
struct WatchPlansResult: Decodable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        /// "event" or "reminder".
        let type: String
        let id: String
        let title: String
        let date: String
        let time: String?
        /// Ready-made line, e.g. "📅 Soccer, Sat 29 Nov 10am".
        let label: String?

        var isReminder: Bool { type == "reminder" }
        var line: String { label ?? (time.map { "\(title), \(date) \($0)" } ?? "\(title), \(date)") }
    }

    struct Skipped: Decodable, Equatable {
        let title: String?
        let reason: String
    }

    let requestId: String
    let reply: String
    let items: [Item]
    let undone: Bool
    let skipped: [Skipped]?

    /// What Siri says back. Emoji are dropped so it reads naturally.
    var spokenReply: String {
        var scalars = String.UnicodeScalarView()
        scalars.append(contentsOf: reply.unicodeScalars.filter { !$0.properties.isEmojiPresentation && $0.value != 0xFE0F })
        return String(scalars)
            .replacingOccurrences(of: " · ", with: ", ")
            .replacingOccurrences(of: "  ", with: " ")
    }
}

protocol WatchPlansClient {
    func addPlans(text: String, requestId: String, via: String) async throws -> WatchPlansResult
    func undoPlans(requestId: String) async throws -> WatchPlansResult
}

/// Shared by the "Add plans" screen and the Siri intent. Neither needs the
/// store's private client: this uses the watch's own Keychain credential.
@MainActor
final class WatchPlansService {
    static let shared = WatchPlansService()
    var client: WatchPlansClient = URLSessionWatchAPIClient()

    func add(_ text: String, requestId: String, via: String) async throws -> WatchPlansResult {
        let result = try await client.addPlans(text: text, requestId: requestId, via: via)
        if !result.items.isEmpty { await syncAfterChange() }
        return result
    }

    func undo(requestId: String) async throws -> WatchPlansResult {
        let result = try await client.undoPlans(requestId: requestId)
        await syncAfterChange()
        return result
    }

    /// Pulls the new events and reminders so the watch plans their buzzes now
    /// (WatchStore.persist re-plans local reminders after every refresh).
    private func syncAfterChange() async {
        await WatchStore.shared.refresh()
    }

    /// The exact reason, shown on screen and said by Siri. Each test on the
    /// kid's watch is expensive, so never hide the server's message.
    static func message(for error: Error) -> String {
        switch error {
        case WatchAPIError.http(let status, let message):
            return status == 503 || status == 502 || status == 429 ? message : "\(message) (\(status))"
        case WatchAPIError.forbidden:
            return "This watch isn't allowed to add plans for this account. Reconnect it to Fam ETC (403)."
        case WatchAPIError.unauthenticated:
            return "This watch needs to be reconnected to Fam ETC (401)."
        case WatchAPIError.disconnected:
            return "This watch isn't connected to Fam ETC yet."
        case WatchAPIError.timedOut:
            return "Fam ETC took too long. Check Wi-Fi and try again."
        case WatchAPIError.transport(let detail):
            return "No connection: \(detail)"
        case WatchAPIError.decoding(let detail):
            return "Fam ETC sent an answer the watch couldn't read: \(detail)"
        default:
            return error.localizedDescription
        }
    }
}
