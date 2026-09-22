import Foundation

struct SchoolNoticeDraft: Equatable {
    var title = ""
    var date: Date?
    var time: Date?
    var kidID: String?
    var notes = ""
    var thingsToBring = ""
    var sourceText = ""

    var cleanTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    var cleanNotes: String { notes.trimmingCharacters(in: .whitespacesAndNewlines) }
    var cleanThingsToBring: String { thingsToBring.trimmingCharacters(in: .whitespacesAndNewlines) }
    var canSave: Bool { !cleanTitle.isEmpty && date != nil }

    var combinedNotes: String? {
        var parts: [String] = []
        if !cleanNotes.isEmpty { parts.append(cleanNotes) }
        if !cleanThingsToBring.isEmpty { parts.append("Things to bring: \(cleanThingsToBring)") }
        return parts.isEmpty ? nil : parts.joined(separator: "\n\n")
    }
}

enum SchoolNoticeExtractor {
    /// A deliberately conservative local extraction. Missing or ambiguous dates
    /// remain nil, so review can never turn an unknown date into today.
    static func draft(from rawText: String, calendar: Calendar = .current) -> SchoolNoticeDraft {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        let lines = text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        var draft = SchoolNoticeDraft()
        draft.sourceText = text
        draft.title = bestTitle(in: lines)
        draft.date = firstExplicitDate(in: text, calendar: calendar)
        draft.time = firstExplicitTime(in: text, calendar: calendar)
        draft.thingsToBring = value(afterLabels: ["things to bring", "bring", "please bring"], in: lines)

        let ignored = Set([draft.title, draft.thingsToBring].filter { !$0.isEmpty })
        draft.notes = lines.filter { !ignored.contains($0) }.joined(separator: "\n")
        return draft
    }

    private static func bestTitle(in lines: [String]) -> String {
        let nonMetadata = lines.first { line in
            let lower = line.lowercased()
            return !lower.hasPrefix("date:") && !lower.hasPrefix("time:") &&
                !lower.hasPrefix("bring:") && !lower.hasPrefix("things to bring:")
        }
        return String((nonMetadata ?? "").prefix(120))
    }

    private static func value(afterLabels labels: [String], in lines: [String]) -> String {
        for line in lines {
            let lower = line.lowercased()
            for label in labels {
                guard lower.hasPrefix(label), let colon = line.firstIndex(of: ":") else { continue }
                return String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return ""
    }

    private static func firstExplicitDate(in text: String, calendar: Calendar) -> Date? {
        // Full-year formats only. Relative phrases and dates missing a year stay
        // unresolved because a notice may have been photographed months later.
        let candidates = matches(
            patterns: [
                #"\b\d{4}-\d{2}-\d{2}\b"#,
                #"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+\d{4}\b"#,
                #"\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b"#
            ],
            in: text
        )
        let formatters: [DateFormatter] = ["yyyy-MM-dd", "MMMM d yyyy", "MMM d yyyy", "d MMMM yyyy", "d MMM yyyy"].map { format in
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar
            formatter.isLenient = false
            formatter.dateFormat = format
            return formatter
        }
        let dates = candidates.compactMap { candidate -> Date? in
            let normalized = candidate
                .replacingOccurrences(of: #"(?<=\d)(st|nd|rd|th)"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: ",", with: "")
            return formatters.lazy.compactMap { $0.date(from: normalized) }.first.map(calendar.startOfDay(for:))
        }
        let unique = Dictionary(grouping: dates, by: { calendar.startOfDay(for: $0) }).keys
        return unique.count == 1 ? unique.first : nil
    }

    private static func firstExplicitTime(in text: String, calendar: Calendar) -> Date? {
        // Match the complete 12-hour token first so "3:30 PM" is never
        // consumed as a standalone 03:30 24-hour value.
        let twelveHour = matches(
            patterns: [#"\b(?:1[0-2]|0?[1-9])(?:(?::|\.)(?:[0-5]\d))?\s*(?:am|pm)\b"#],
            in: text
        )
        var rangesToIgnore: [NSRange] = []
        for value in twelveHour {
            if let range = text.range(of: value, options: .caseInsensitive) { rangesToIgnore.append(NSRange(range, in: text)) }
        }
        var values = twelveHour.compactMap { parseTime($0, formats: ["h:mm a", "h.mm a", "h a"]) }

        if let regex = try? NSRegularExpression(
            pattern: #"\b(?:[01]?\d|2[0-3]):[0-5]\d\b"#,
            options: .caseInsensitive
        ) {
            let full = NSRange(text.startIndex..<text.endIndex, in: text)
            values += regex.matches(in: text, range: full)
                .filter { match in !rangesToIgnore.contains { NSIntersectionRange($0, match.range).length > 0 } }
                .compactMap { parseTime((text as NSString).substring(with: $0.range), formats: ["H:mm"]) }
        }
        let unique = Dictionary(grouping: values, by: {
            let parts = calendar.dateComponents([.hour, .minute], from: $0)
            return (parts.hour ?? -1) * 60 + (parts.minute ?? -1)
        }).keys
        guard unique.count == 1, let minutes = unique.first else { return nil }
        return calendar.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date())
    }

    private static func matches(patterns: [String], in text: String) -> [String] {
        patterns.flatMap { pattern -> [String] in
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return [] }
            let range = NSRange(text.startIndex..<text.endIndex, in: text)
            return regex.matches(in: text, range: range).map { (text as NSString).substring(with: $0.range) }
        }
    }

    private static func parseTime(_ value: String, formats: [String]) -> Date? {
        for format in formats {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.isLenient = false
            formatter.dateFormat = format
            if let date = formatter.date(from: value.uppercased()) { return date }
        }
        return nil
    }
}
