import XCTest
@testable import FamETC

/// Pure helpers behind native voice messages (docs/VOICE-MESSAGES.md):
/// upload duration bounds, multipart fields, labels, waveform and the
/// client-local unplayed log.
final class VoiceMessageTests: XCTestCase {

    // MARK: Upload duration (server accepts 500–60000 ms)

    func testUploadDurationRejectsTooShortAndClampsToCap() {
        XCTAssertNil(ChatVoiceMessage.uploadDurationMs(seconds: 0))
        XCTAssertNil(ChatVoiceMessage.uploadDurationMs(seconds: 0.4))
        XCTAssertNil(ChatVoiceMessage.uploadDurationMs(seconds: .nan))
        XCTAssertNil(ChatVoiceMessage.uploadDurationMs(seconds: -3))
        XCTAssertEqual(ChatVoiceMessage.uploadDurationMs(seconds: 0.5), 500)
        XCTAssertEqual(ChatVoiceMessage.uploadDurationMs(seconds: 6.2), 6200)
        XCTAssertEqual(ChatVoiceMessage.uploadDurationMs(seconds: 60.04), 60_000)
        XCTAssertEqual(ChatVoiceMessage.uploadDurationMs(seconds: 75), 60_000)
    }

    // MARK: Labels

    func testClockFormatsWholeSecondsRoundedDown() {
        XCTAssertEqual(ChatVoiceMessage.clock(seconds: 0), "0:00")
        XCTAssertEqual(ChatVoiceMessage.clock(seconds: 6.9), "0:06")
        XCTAssertEqual(ChatVoiceMessage.clock(seconds: 60), "1:00")
        XCTAssertEqual(ChatVoiceMessage.clock(seconds: 75.2), "1:15")
        XCTAssertEqual(ChatVoiceMessage.clock(seconds: -1), "0:00")
        XCTAssertEqual(ChatVoiceMessage.clock(seconds: .infinity), "0:00")
    }

    func testDurationLabelMatchesContractExample() {
        XCTAssertEqual(ChatVoiceMessage.durationLabel(ms: 6200), "0:06")
        XCTAssertEqual(ChatVoiceMessage.durationLabel(ms: 6600), "0:07")
        XCTAssertEqual(ChatVoiceMessage.durationLabel(ms: 60_000), "1:00")
        XCTAssertEqual(ChatVoiceMessage.durationLabel(ms: 200), "0:01", "a real clip never reads as 0:00")
        XCTAssertEqual(ChatVoiceMessage.durationLabel(ms: nil), "0:00")
        XCTAssertEqual(ChatVoiceMessage.durationLabel(ms: 0), "0:00")
    }

    func testSpokenDurationForVoiceOver() {
        XCTAssertEqual(ChatVoiceMessage.spokenDuration(ms: 6200), "6 seconds")
        XCTAssertEqual(ChatVoiceMessage.spokenDuration(ms: 1000), "1 second")
        XCTAssertEqual(ChatVoiceMessage.spokenDuration(ms: 60_000), "1 minute")
        XCTAssertEqual(ChatVoiceMessage.spokenDuration(ms: 65_000), "1 minute 5 seconds")
        XCTAssertEqual(ChatVoiceMessage.spokenDuration(ms: nil), "0 seconds")
    }

    func testProgressIsClampedAndSafeForUnknownDuration() {
        XCTAssertEqual(ChatVoiceMessage.progress(elapsed: 3, duration: 6), 0.5, accuracy: 0.0001)
        XCTAssertEqual(ChatVoiceMessage.progress(elapsed: 9, duration: 6), 1)
        XCTAssertEqual(ChatVoiceMessage.progress(elapsed: -1, duration: 6), 0)
        XCTAssertEqual(ChatVoiceMessage.progress(elapsed: 3, duration: 0), 0)
        XCTAssertEqual(ChatVoiceMessage.progress(elapsed: 3, duration: .nan), 0)
    }

    func testMeterLevelMapsDecibelsToUnitRange() {
        XCTAssertEqual(ChatVoiceMessage.meterLevel(decibels: -160), 0)
        XCTAssertEqual(ChatVoiceMessage.meterLevel(decibels: -50), 0)
        XCTAssertEqual(ChatVoiceMessage.meterLevel(decibels: -25), 0.5, accuracy: 0.0001)
        XCTAssertEqual(ChatVoiceMessage.meterLevel(decibels: 0), 1)
        XCTAssertEqual(ChatVoiceMessage.meterLevel(decibels: 3), 1)
        XCTAssertEqual(ChatVoiceMessage.meterLevel(decibels: -.infinity), 0)
    }

    func testWaveformIsDeterministicAndBounded() {
        let first = ChatVoiceMessage.waveform(seed: "a_0123", count: 26)
        XCTAssertEqual(first.count, 26)
        XCTAssertEqual(first, ChatVoiceMessage.waveform(seed: "a_0123", count: 26), "stable across calls/launches")
        XCTAssertNotEqual(first, ChatVoiceMessage.waveform(seed: "a_9999", count: 26))
        XCTAssertTrue(first.allSatisfy { $0 >= 0.25 && $0 <= 1 })
        XCTAssertEqual(ChatVoiceMessage.waveform(seed: "", count: 4).count, 4)
        XCTAssertEqual(ChatVoiceMessage.waveform(seed: "x", count: 0), [])
    }

    // MARK: Multipart fields

    func testMultipartFieldsAddDurationOnlyForVoice() {
        XCTAssertEqual(ChatMultipartForm.fields(roomId: "family", durationMs: nil),
                       [ChatMultipartForm.Field(name: "roomId", value: "family")])
        XCTAssertEqual(ChatMultipartForm.fields(roomId: "family", durationMs: 6200),
                       [ChatMultipartForm.Field(name: "roomId", value: "family"), ChatMultipartForm.Field(name: "durationMs", value: "6200")])
    }

    func testMultipartPartsAreExact() {
        let b = "FamETC-B"
        XCTAssertEqual(ChatMultipartForm.textPart(ChatMultipartForm.Field(name: "durationMs", value: "6200"), boundary: b),
                       "--FamETC-B\r\nContent-Disposition: form-data; name=\"durationMs\"\r\n\r\n6200\r\n")
        XCTAssertEqual(ChatMultipartForm.filePartHeader(filename: "voice.m4a", mimeType: "audio/mp4", boundary: b),
                       "--FamETC-B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"voice.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n")
        XCTAssertEqual(ChatMultipartForm.closing(boundary: b), "\r\n--FamETC-B--\r\n")
    }

    func testMultipartFilenameEscapesHeaderBreakingCharacters() {
        XCTAssertEqual(ChatMultipartForm.safeFilename("a\"b\\c\r\nd.m4a"), "a'b-c--d.m4a")
    }

    func testVoiceUploadUsesAudioMp4AndContractFilename() {
        XCTAssertEqual(ChatVoiceMessage.mimeType, "audio/mp4")
        XCTAssertEqual(ChatVoiceMessage.uploadFilename, "voice.m4a")
        let picked = ChatPickedAttachment(url: URL(fileURLWithPath: "/tmp/x.m4a"), mimeType: "image/jpeg")
        XCTAssertNil(picked.durationMs, "photo/file picks keep the old multipart shape")
        XCTAssertNil(picked.filename)
    }

    // MARK: Previews

    func testPreviewTextForEachMessageShape() {
        func message(text: String = "", media: ChatMedia?) -> ChatMessage {
            ChatMessage(id: "m", familyId: "f", senderType: "parent", senderId: "u",
                        postedByUserId: nil, text: text, card: nil, media: media,
                        createdAt: "2026-10-27T09:00:00.000Z", deleted: false, deletedBy: nil,
                        flagged: false, flagReason: nil, flaggedBy: nil)
        }
        let audio = ChatMedia(type: "attachment", url: "/api/chat/attachments/a_1", attachmentId: "a_1",
                              filename: "voice.m4a", mimeType: "audio/mp4", size: 100, kind: "audio", durationMs: 1200)
        XCTAssertEqual(message(media: audio).previewText, "🎤 Voice message")
        XCTAssertEqual(message(text: "On my way", media: audio).previewText, "On my way", "text wins when present")
        XCTAssertEqual(message(media: ChatMedia(type: "gif", url: "https://g/x.gif")).previewText, "Sent a GIF")
        XCTAssertEqual(message(media: ChatMedia(type: "attachment", filename: "notes.pdf", kind: "file")).previewText, "Sent notes.pdf")
        XCTAssertEqual(message(media: nil).previewText, "Sent a message")
    }

    // MARK: Unplayed log (client-local)

    func testPlayedLogDedupesAndStaysBounded() {
        XCTAssertEqual(ChatVoicePlayedLog.appending("b", to: ["a", "b", "c"]), ["a", "c", "b"])
        XCTAssertEqual(ChatVoicePlayedLog.appending("d", to: ["a", "b", "c"], limit: 3), ["b", "c", "d"])
        XCTAssertEqual(ChatVoicePlayedLog.key(accountId: "u_1"), "fam_voice_played_u_1")
    }

    @MainActor
    func testPlayerMarksPlayedPerAccount() throws {
        let suite = "VoiceMessageTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let player = ChatVoicePlayer(defaults: defaults)
        XCTAssertFalse(player.isPlayed("m1", accountId: "parent"))
        player.markPlayed("m1", accountId: "parent")
        XCTAssertTrue(player.isPlayed("m1", accountId: "parent"))
        XCTAssertFalse(player.isPlayed("m1", accountId: "kid"), "another account on this device still sees the dot")
        XCTAssertTrue(player.isPlayed("m1", accountId: nil), "no account: never show a stale dot")
        // A fresh player (next launch) reads the persisted log.
        XCTAssertTrue(ChatVoicePlayer(defaults: defaults).isPlayed("m1", accountId: "parent"))
    }
}
