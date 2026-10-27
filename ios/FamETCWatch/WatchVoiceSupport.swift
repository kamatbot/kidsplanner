import Foundation

// Pure helpers for chat rendering and voice notes. Nothing here touches
// AVFoundation, the network or the UI, so all of it is unit-tested.

/// `multipart/form-data` body for `POST /api/chat/attachments`.
struct WatchMultipartBody {
    let boundary: String
    private(set) var data = Data()

    init(boundary: String = "FamETCWatch-\(UUID().uuidString)") {
        self.boundary = boundary
    }

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func addField(_ name: String, _ value: String) {
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(Self.escaped(name))\"\r\n\r\n")
        append(value)
        append("\r\n")
    }

    /// Adds the file part and closes the body. Call it last.
    mutating func addFile(_ name: String, filename: String, mimeType: String, data file: Data) {
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(Self.escaped(name))\"; filename=\"\(Self.escaped(filename))\"\r\n")
        append("Content-Type: \(mimeType)\r\n\r\n")
        data.append(file)
        append("\r\n--\(boundary)--\r\n")
    }

    private mutating func append(_ string: String) { data.append(Data(string.utf8)) }

    private static func escaped(_ value: String) -> String {
        value.replacingOccurrences(of: "\"", with: "%22").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
    }
}

enum WatchVoiceFormat {
    /// Watch recordings stop and send automatically at 30 s.
    static let maxSeconds: TimeInterval = 30
    /// The server rejects `durationMs` below 500.
    static let minDurationMs = 500

    /// `0:06`, `1:05`. Elapsed time rounds down so the clock never runs ahead.
    static func clock(_ seconds: TimeInterval) -> String {
        let whole = max(0, Int(seconds.isFinite ? seconds : 0))
        return "\(whole / 60):" + String(format: "%02d", whole % 60)
    }

    /// A message's total length: nearest second, never `0:00` for real audio.
    static func duration(ms: Int?) -> String {
        guard let ms, ms > 0 else { return "0:00" }
        return clock(max(1, (Double(ms) / 1000).rounded()))
    }

    static func durationMs(_ seconds: TimeInterval) -> Int {
        Int((max(0, min(seconds, 60)) * 1000).rounded())
    }

    /// Recorder metering in dBFS (-160…0) mapped onto 0…1 bar heights.
    static func level(fromDecibels db: Float) -> Double {
        guard db.isFinite else { return 0 }
        return Double(max(0, min(1, (db + 50) / 50)))
    }

    /// Eight stable bar heights (0.25…1) per message, so a waveform does not
    /// change between launches. FNV-1a rather than the per-launch `hashValue`.
    static func waveform(for id: String, bars: Int = 8) -> [Double] {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in id.utf8 { hash = (hash ^ UInt64(byte)) &* 0x100000001b3 }
        return (0..<bars).map { index in
            let bits = (hash >> UInt64((index * 7) % 57)) & 0x7F
            return 0.25 + 0.75 * Double(bits) / 127
        }
    }
}

enum WatchChatEmoji {
    /// Quick reply grid (BRIEF screen 2), then the phrases.
    static let grid = ["👍", "❤️", "😂", "👌", "😋", "🥺"]
    static let featuredPhrases = ["On my way 🏃", "Can you call me? 📞"]
    static let morePhrases = ["OK", "Be there soon", "Love you", "Thanks!", "Yes", "No"]
    /// The play screen's react row.
    static let reactions = ["👍", "❤️", "😂"]

    /// Number of emoji when the text is nothing but 1–3 emoji (rendered large,
    /// without a bubble); otherwise nil.
    static func emojiOnlyCount(_ text: String, limit: Int = 3) -> Int? {
        var count = 0
        for character in text where !character.isWhitespace {
            guard isEmoji(character) else { return nil }
            count += 1
            if count > limit { return nil }
        }
        return count == 0 ? nil : count
    }

    static func isEmoji(_ character: Character) -> Bool {
        guard let first = character.unicodeScalars.first else { return false }
        if first.properties.isEmojiPresentation { return true }
        // Digits, # and * are "emoji" only as keycaps; text-default symbols
        // like ❤ count once they carry a variation selector or joiner.
        return first.properties.isEmoji && (character.unicodeScalars.count > 1 || first.value > 0x238C)
    }

    /// The server's reaction key for an emoji, or nil when it has none.
    static func reactionKey(for emoji: String) -> String? {
        switch emoji {
        case "👍": return "thumbsup"
        case "❤️", "❤": return "heart"
        case "😂": return "laugh"
        case "😮": return "wow"
        case "😢": return "sad"
        case "🙏": return "pray"
        case "🔥": return "fire"
        case "🎉": return "party"
        default: return nil
        }
    }

    static func emoji(forReactionKey key: String) -> String? {
        ["thumbsup": "👍", "heart": "❤️", "laugh": "😂", "wow": "😮", "sad": "😢", "pray": "🙏", "fire": "🔥", "party": "🎉"][key]
    }
}
