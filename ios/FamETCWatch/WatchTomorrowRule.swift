import Foundation

public enum WatchTomorrowRule {
    /// Pure function for the 19:00 local time rule.
    /// Shows from 19:00 onwards when there are tomorrow items.
    public static func shouldShowTomorrow(at date: Date = Date(), calendar: Calendar = .current, hasItems: Bool) -> Bool {
        guard hasItems else { return false }
        let hour = calendar.component(.hour, from: date)
        return hour >= 19
    }

    /// Formats the single-line summary with the first item(s) e.g. "Tomorrow: pack swim bag"
    public static func tomorrowLine(for items: [WatchTomorrowItem]) -> String? {
        guard !items.isEmpty else { return nil }
        let summary = items.prefix(2).map(\.title).joined(separator: " · ")
        return "Tomorrow: \(summary)"
    }
}
