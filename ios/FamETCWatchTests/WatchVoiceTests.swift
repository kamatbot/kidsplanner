import XCTest
import UserNotifications
@testable import FamETCWatch

final class WatchVoiceFormatTests: XCTestCase {
    func testClockAndDurationFormatting() {
        XCTAssertEqual(WatchVoiceFormat.clock(0), "0:00")
        XCTAssertEqual(WatchVoiceFormat.clock(3.9), "0:03")
        XCTAssertEqual(WatchVoiceFormat.clock(65), "1:05")
        XCTAssertEqual(WatchVoiceFormat.clock(-2), "0:00")
        XCTAssertEqual(WatchVoiceFormat.clock(.nan), "0:00")
        XCTAssertEqual(WatchVoiceFormat.duration(ms: 6200), "0:06")
        XCTAssertEqual(WatchVoiceFormat.duration(ms: 6600), "0:07")
        XCTAssertEqual(WatchVoiceFormat.duration(ms: 300), "0:01")
        XCTAssertEqual(WatchVoiceFormat.duration(ms: nil), "0:00")
        XCTAssertEqual(WatchVoiceFormat.duration(ms: 30_000), "0:30")
    }

    func testDurationMsIsClampedToServerRange() {
        XCTAssertEqual(WatchVoiceFormat.durationMs(6.2), 6200)
        XCTAssertEqual(WatchVoiceFormat.durationMs(-1), 0)
        XCTAssertEqual(WatchVoiceFormat.durationMs(90), 60_000)
    }

    func testMeterLevelsAndStableWaveform() {
        XCTAssertEqual(WatchVoiceFormat.level(fromDecibels: -160), 0)
        XCTAssertEqual(WatchVoiceFormat.level(fromDecibels: 0), 1)
        XCTAssertEqual(WatchVoiceFormat.level(fromDecibels: -25), 0.5, accuracy: 0.001)
        let bars = WatchVoiceFormat.waveform(for: "a_123")
        XCTAssertEqual(bars.count, 8)
        XCTAssertEqual(bars, WatchVoiceFormat.waveform(for: "a_123"))
        XCTAssertTrue(bars.allSatisfy { $0 >= 0.25 && $0 <= 1 })
    }

    func testEmojiOnlyDetection() {
        XCTAssertEqual(WatchChatEmoji.emojiOnlyCount("👍"), 1)
        XCTAssertEqual(WatchChatEmoji.emojiOnlyCount(" ❤️ 😂 "), 2)
        XCTAssertEqual(WatchChatEmoji.emojiOnlyCount("👨‍👩‍👧"), 1)
        XCTAssertEqual(WatchChatEmoji.emojiOnlyCount("❤"), 1)
        XCTAssertNil(WatchChatEmoji.emojiOnlyCount("👍👍👍👍"))
        XCTAssertNil(WatchChatEmoji.emojiOnlyCount("On my way 🏃"))
        XCTAssertNil(WatchChatEmoji.emojiOnlyCount("1"))
        XCTAssertNil(WatchChatEmoji.emojiOnlyCount("#"))
        XCTAssertNil(WatchChatEmoji.emojiOnlyCount(""))
        XCTAssertNil(WatchChatEmoji.emojiOnlyCount("   "))
    }

    func testReactionKeysMatchServer() {
        XCTAssertEqual(WatchChatEmoji.reactions.compactMap(WatchChatEmoji.reactionKey(for:)), ["thumbsup", "heart", "laugh"])
        XCTAssertNil(WatchChatEmoji.reactionKey(for: "🏃"))
        XCTAssertEqual(WatchChatEmoji.emoji(forReactionKey: "heart"), "❤️")
    }

    func testNotificationQuickReplies() {
        XCTAssertEqual(WatchChatNotificationActions.quickReplies.map(\.text), ["👍", "🏃", "❤️"])
        XCTAssertEqual(WatchChatNotificationActions.quickReply(for: "FAM_CHAT_ON_MY_WAY"), "🏃")
        XCTAssertNil(WatchChatNotificationActions.quickReply(for: WatchChatNotificationActions.talk))
        let category = WatchChatNotificationActions.category()
        XCTAssertEqual(category.identifier, "FAM_CHAT")
        XCTAssertEqual(category.actions.map(\.identifier),
                       ["FAM_CHAT_THUMBS", "FAM_CHAT_ON_MY_WAY", "FAM_CHAT_HEART", "FAM_CHAT_TALK", "FAM_CHAT_REPLY"])
        XCTAssertTrue(category.actions[3].options.contains(.foreground))
        XCTAssertFalse(category.actions[0].options.contains(.foreground))
    }

    func testMultipartBodyLayout() {
        var form = WatchMultipartBody(boundary: "B")
        form.addField("roomId", "family")
        form.addField("durationMs", "6200")
        form.addFile("file", filename: "voice.m4a", mimeType: "audio/mp4", data: Data([0x00, 0x01]))
        XCTAssertEqual(form.contentType, "multipart/form-data; boundary=B")
        var expected = Data((
            "--B\r\nContent-Disposition: form-data; name=\"roomId\"\r\n\r\nfamily\r\n" +
            "--B\r\nContent-Disposition: form-data; name=\"durationMs\"\r\n\r\n6200\r\n" +
            "--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"voice.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n"
        ).utf8)
        expected.append(Data([0x00, 0x01]))
        expected.append(Data("\r\n--B--\r\n".utf8))
        XCTAssertEqual(form.data, expected)
    }

    func testAudioMessageAndReactionsDecode() throws {
        let json = """
        {"id":"m9","senderType":"parent","senderId":"p1","senderName":"Mum","text":"","createdAt":"2026-10-27T09:00:00Z",
         "media":{"type":"attachment","attachmentId":"a_1","url":"/api/chat/attachments/a_1","filename":"voice.m4a",
                  "mimeType":"audio/mp4","size":48213,"kind":"audio","durationMs":6200},
         "reactions":[{"key":"heart","userIds":["u1"],"names":["Maya"]}]}
        """
        let message = try JSONDecoder().decode(WatchChatMessage.self, from: Data(json.utf8))
        XCTAssertTrue(message.isVoice)
        XCTAssertEqual(message.media?.durationMs, 6200)
        XCTAssertEqual(message.media?.attachmentId, "a_1")
        XCTAssertEqual(message.reactions?.first?.key, "heart")
        XCTAssertEqual(message.displayText, "🎤 Voice message")
        // Older cached messages without the new fields still decode.
        let old = try JSONDecoder().decode(WatchChatMessage.self, from: Data(#"{"id":"m1","senderType":"kid","senderId":"k","text":"hi","createdAt":"x","media":{"type":"gif"}}"#.utf8))
        XCTAssertFalse(old.isVoice)
        XCTAssertNil(old.reactions)
    }

    func testMediaDescriptorEncodesOnlyKnownFields() throws {
        let media = WatchChatMessage.Media(type: "attachment", kind: "audio", attachmentId: "a_1", durationMs: 900)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(media)) as? [String: Any]
        XCTAssertEqual(object?["attachmentId"] as? String, "a_1")
        XCTAssertEqual(object?["durationMs"] as? Int, 900)
        XCTAssertNil(object?["url"])
    }
}

@MainActor
final class WatchVoiceOutboxTests: XCTestCase {
    private var directory: URL!
    private let kid = WatchProfile(role: "kid", userId: "ku", familyId: "f", kidId: "k", name: "Maya")

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("voice-tests-\(UUID().uuidString)")
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func recording() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("rec-\(UUID().uuidString).m4a")
        try Data([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]).write(to: url)
        return url
    }

    func testDraftRoundTripsThroughQueueFile() throws {
        let client = VoiceTestClient()
        let outbox = WatchVoiceOutbox(directory: directory) { client }
        let draft = try outbox.enqueue(recordingAt: try recording(), durationMs: 4200, profile: kid)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outbox.fileURL(for: draft).path))

        let restored = WatchVoiceOutbox(directory: directory) { client }
        XCTAssertEqual(restored.items, [draft])
        let pending = restored.pendingMessages(profile: kid, confirmed: [])
        XCTAssertEqual(pending.first?.id, "voice-" + draft.id)
        XCTAssertEqual(pending.first?.pending, true)
        XCTAssertTrue(pending.first?.isMine(kid) == true)
        XCTAssertEqual(pending.first?.media?.durationMs, 4200)
    }

    func testDrainUploadsThenSendsAndClearsFile() async throws {
        let client = VoiceTestClient()
        let outbox = WatchVoiceOutbox(directory: directory) { client }
        let draft = try outbox.enqueue(recordingAt: try recording(), durationMs: 4200, profile: kid)
        var accepted: [WatchChatMessage] = []
        await outbox.drain(profile: kid) { accepted += $0 }
        XCTAssertEqual(client.uploads, [4200])
        XCTAssertEqual(client.sent.map(\.1), [draft.id])
        XCTAssertEqual(accepted.map(\.id), ["server-1"])
        XCTAssertTrue(outbox.items.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: outbox.fileURL(for: draft).path))
    }

    func testOfflineSendKeepsUploadedDescriptorForIdempotentRetry() async throws {
        let client = VoiceTestClient()
        client.sendErrors = [WatchAPIError.transport("offline")]
        let outbox = WatchVoiceOutbox(directory: directory) { client }
        try outbox.enqueue(recordingAt: try recording(), durationMs: 2000, profile: kid)
        await outbox.drain(profile: kid) { _ in }
        XCTAssertEqual(outbox.items.first?.attachment?.attachmentId, "a_1")
        XCTAssertNil(outbox.lastError)

        let restored = WatchVoiceOutbox(directory: directory) { client }
        await restored.drain(profile: kid) { _ in }
        XCTAssertEqual(client.uploads.count, 1, "the retry must reuse the uploaded attachment")
        XCTAssertEqual(client.sent.map(\.0.attachmentId), ["a_1", "a_1"])
        XCTAssertTrue(restored.items.isEmpty)
    }

    func testConflictReuploadsOnceThenPermanentRejectionDrops() async throws {
        let client = VoiceTestClient()
        client.sendErrors = [WatchAPIError.http(409, "gone"), WatchAPIError.http(409, "gone")]
        let outbox = WatchVoiceOutbox(directory: directory) { client }
        try outbox.enqueue(recordingAt: try recording(), durationMs: 2000, profile: kid)
        await outbox.drain(profile: kid) { _ in }
        XCTAssertEqual(client.uploads.count, 2)
        XCTAssertTrue(outbox.items.isEmpty)
        XCTAssertNotNil(outbox.lastError)
    }

    func testAnotherIdentityNeverSendsQueuedNote() async throws {
        let client = VoiceTestClient()
        let outbox = WatchVoiceOutbox(directory: directory) { client }
        try outbox.enqueue(recordingAt: try recording(), durationMs: 2000, profile: kid)
        let other = WatchProfile(role: "kid", userId: "other", familyId: "f", kidId: "k2", name: "Sam")
        XCTAssertTrue(outbox.pendingMessages(profile: other, confirmed: []).isEmpty)
        await outbox.drain(profile: other) { _ in }
        XCTAssertTrue(client.uploads.isEmpty)
        XCTAssertTrue(outbox.items.isEmpty)
    }

    func testServerEchoHidesPendingBubble() throws {
        let outbox = WatchVoiceOutbox(directory: directory) { VoiceTestClient() }
        var draft = try outbox.enqueue(recordingAt: try recording(), durationMs: 2000, profile: kid)
        draft.attachment = WatchChatMessage.Media(type: "attachment", kind: "audio", attachmentId: "a_1")
        let restoredItems = [draft]
        try JSONEncoder().encode(restoredItems).write(to: directory.appendingPathComponent("outbox.json"))
        let restored = WatchVoiceOutbox(directory: directory) { VoiceTestClient() }
        let echo = WatchChatMessage(id: "server-1", senderType: "kid", senderId: "k", text: "", createdAt: "x",
                                    media: WatchChatMessage.Media(type: "attachment", kind: "audio", attachmentId: "a_1"))
        XCTAssertTrue(restored.pendingMessages(profile: kid, confirmed: [echo]).isEmpty)
    }

    func testDiscardAllRemovesRecordings() throws {
        let outbox = WatchVoiceOutbox(directory: directory) { VoiceTestClient() }
        let draft = try outbox.enqueue(recordingAt: try recording(), durationMs: 2000, profile: kid)
        outbox.discardAll()
        XCTAssertTrue(outbox.items.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: outbox.fileURL(for: draft).path))
    }
}

private final class VoiceTestClient: WatchVoiceClient {
    var uploads: [Int] = []
    var sent: [(WatchChatMessage.Media, String)] = []
    var sendErrors: [Error] = []

    func uploadVoice(_ audio: Data, durationMs: Int) async throws -> WatchChatMessage.Media {
        uploads.append(durationMs)
        return WatchChatMessage.Media(type: "attachment", kind: "audio", attachmentId: "a_\(uploads.count)",
                                      mimeType: "audio/mp4", durationMs: durationMs)
    }

    func sendVoice(_ media: WatchChatMessage.Media, clientMessageId: String) async throws -> WatchChatMessage {
        sent.append((media, clientMessageId))
        if !sendErrors.isEmpty { throw sendErrors.removeFirst() }
        return WatchChatMessage(id: "server-\(sent.count)", senderType: "kid", senderId: "k", text: "",
                                createdAt: "2026-10-27T09:00:00Z", media: media)
    }

    func downloadAttachment(_ attachmentId: String) async throws -> Data { Data() }

    func toggleReaction(messageId: String, reaction: String) async throws -> WatchChatMessage {
        throw WatchAPIError.forbidden
    }
}
