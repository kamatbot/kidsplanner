import Foundation

/// One recorded voice note waiting to reach family chat. `id` is the server
/// retry key (`clientMessageId`). The uploaded descriptor is kept once known,
/// so a retried send claims the same attachment and the server's idempotent
/// retry returns the original message instead of a 409.
struct WatchVoiceDraft: Codable, Equatable, Identifiable {
    let id: String
    let fileName: String
    let durationMs: Int
    let createdAt: Date
    let userId: String
    let familyId: String
    let kidId: String?
    var attachment: WatchChatMessage.Media? = nil
    /// Set once the descriptor was discarded after a 409 and the audio re-uploaded.
    var reuploaded: Bool? = nil

    func belongs(to profile: WatchProfile?) -> Bool {
        guard let profile else { return false }
        return profile.userId == userId && profile.familyId == familyId && profile.kidId == kidId
    }

    /// The local bubble shown until the server confirms the message.
    func pendingMessage(profile: WatchProfile?) -> WatchChatMessage {
        let isKid = profile?.role == "kid"
        return WatchChatMessage(
            id: Self.localPrefix + id,
            senderType: isKid ? "kid" : "parent",
            senderId: (isKid ? profile?.kidId : profile?.userId) ?? "",
            senderName: profile?.name,
            text: "",
            createdAt: createdAt.ISO8601Format(),
            media: WatchChatMessage.Media(type: "attachment", kind: "audio", attachmentId: attachment?.attachmentId,
                                          mimeType: "audio/mp4", durationMs: durationMs),
            pending: true
        )
    }

    static let localPrefix = "voice-"
}

/// Durable queue for voice notes, kept apart from the check-off outbox: a
/// slow audio upload must not hold up a homework tick, and a voice note has
/// two server steps (upload, then post) plus a file on disk. The queue and
/// recordings live in their own protected Application Support folder; the
/// queue file is written (and read back) before any request starts.
@MainActor
final class WatchVoiceOutbox: ObservableObject {
    static let shared = WatchVoiceOutbox()

    @Published private(set) var items: [WatchVoiceDraft]
    @Published private(set) var lastError: String?
    @Published private(set) var isSending = false

    let directory: URL
    private let clientFactory: () -> WatchVoiceClient
    private var epoch = 0

    init(directory: URL? = nil, clientFactory: @escaping () -> WatchVoiceClient = { URLSessionWatchAPIClient() }) {
        let base = directory ?? ((try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                                appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory).appendingPathComponent("fametc-voice", isDirectory: true)
        self.directory = base
        self.clientFactory = clientFactory
        let queue = base.appendingPathComponent("outbox.json")
        self.items = (try? Data(contentsOf: queue)).flatMap { try? JSONDecoder().decode([WatchVoiceDraft].self, from: $0) } ?? []
    }

    private var queueURL: URL { directory.appendingPathComponent("outbox.json") }
    func fileURL(for draft: WatchVoiceDraft) -> URL { directory.appendingPathComponent(draft.fileName) }

    /// Moves a finished recording into the queue. Throws when it could not be
    /// saved, so the caller can tell the child instead of losing it silently.
    @discardableResult
    func enqueue(recordingAt source: URL, durationMs: Int, profile: WatchProfile, now: Date = Date()) throws -> WatchVoiceDraft {
        let id = UUID().uuidString
        let draft = WatchVoiceDraft(id: id, fileName: "\(id).m4a", durationMs: durationMs, createdAt: now,
                                    userId: profile.userId, familyId: profile.familyId, kidId: profile.kidId)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try FileManager.default.moveItem(at: source, to: fileURL(for: draft))
        try? (fileURL(for: draft) as NSURL).setResourceValue(URLFileProtection.completeUntilFirstUserAuthentication, forKey: .fileProtectionKey)
        var pending = items
        pending.append(draft)
        do {
            try save(pending)
        } catch {
            try? FileManager.default.removeItem(at: fileURL(for: draft))
            throw error
        }
        items = pending
        lastError = nil
        return draft
    }

    /// Sends queued notes in recording order. A transient failure keeps the
    /// note (and its uploaded descriptor) for the next attempt; a permanent
    /// rejection drops it with a visible error so it can't block later notes.
    func drain(profile: WatchProfile?, accept: @escaping ([WatchChatMessage]) -> Void) async {
        guard !isSending, !items.isEmpty else { return }
        isSending = true
        let started = epoch
        defer { if started == epoch { isSending = false } }
        let client = clientFactory()

        while started == epoch, var draft = items.first {
            // A note recorded under another connection is never sent from this one.
            guard draft.belongs(to: profile) else { remove(draft.id); continue }
            do {
                if draft.attachment == nil {
                    let audio = try Data(contentsOf: fileURL(for: draft))
                    let uploaded = try await client.uploadVoice(audio, durationMs: draft.durationMs)
                    guard started == epoch else { return }
                    guard uploaded.attachmentId?.isEmpty == false else { throw WatchAPIError.decoding("Upload returned no attachment.") }
                    draft.attachment = uploaded
                    update(draft)
                }
                guard let media = draft.attachment else { continue }
                let sent = try await client.sendVoice(media, clientMessageId: draft.id)
                guard started == epoch else { return }
                remove(draft.id)
                lastError = nil
                accept([sent])
            } catch is CancellationError {
                return
            } catch {
                guard started == epoch else { return }
                if case WatchAPIError.http(409, _) = error, draft.attachment != nil, draft.reuploaded != true {
                    // The attachment expired unclaimed: upload the audio once more.
                    draft.attachment = nil
                    draft.reuploaded = true
                    update(draft)
                    continue
                }
                if Self.isPermanent(error) {
                    remove(draft.id)
                    lastError = "Voice message not sent: \(error.localizedDescription)"
                    continue
                }
                // The recording itself is gone: nothing left to retry.
                if (error as? CocoaError)?.code == .fileReadNoSuchFile { remove(draft.id); continue }
                lastError = Self.isOffline(error) ? nil : error.localizedDescription
                return
            }
        }
    }

    /// Local bubbles for unconfirmed notes, hiding any the server already echoed.
    func pendingMessages(profile: WatchProfile?, confirmed: [WatchChatMessage]) -> [WatchChatMessage] {
        let echoed = Set(confirmed.compactMap { $0.media?.attachmentId })
        return items
            .filter { $0.belongs(to: profile) && !echoed.contains($0.attachment?.attachmentId ?? "\u{0}") }
            .map { $0.pendingMessage(profile: profile) }
    }

    func discardAll() {
        epoch += 1
        isSending = false
        items = []
        lastError = nil
        try? FileManager.default.removeItem(at: directory)
    }

    /// Identity reset / disconnect: drop queued notes, their audio and any
    /// cached downloads.
    func reset() {
        discardAll()
        WatchVoicePlayer.clearCache()
    }

    private func update(_ draft: WatchVoiceDraft) {
        guard let index = items.firstIndex(where: { $0.id == draft.id }) else { return }
        var pending = items
        pending[index] = draft
        try? save(pending)
        items = pending
    }

    private func remove(_ id: String) {
        guard let draft = items.first(where: { $0.id == id }) else { return }
        let pending = items.filter { $0.id != id }
        try? save(pending)
        items = pending
        try? FileManager.default.removeItem(at: fileURL(for: draft))
    }

    private func save(_ pending: [WatchVoiceDraft]) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(pending)
        try data.write(to: queueURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        guard try Data(contentsOf: queueURL) == data else { throw CocoaError(.fileWriteUnknown) }
    }

    static func isPermanent(_ error: Error) -> Bool {
        switch error {
        case WatchAPIError.forbidden, WatchAPIError.badURL: return true
        case WatchAPIError.http(let status, _): return (400..<500).contains(status) && status != 408 && status != 429
        default: return false
        }
    }

    private static func isOffline(_ error: Error) -> Bool {
        switch error {
        case WatchAPIError.transport, WatchAPIError.timedOut: return true
        default: return false
        }
    }
}
