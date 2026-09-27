import Foundation

/// Pure schedule helpers for Screen Time enforcement. Foundation only (no
/// FamilyControls/DeviceActivity) so they are unit-testable.
enum ScreenTimeSchedule {
    /// DeviceActivity rejects schedules shorter than 15 minutes.
    static let minimumInterval: TimeInterval = 15 * 60

    /// "HH:mm" (00:00–23:59) → hour/minute components; nil when malformed.
    static func parseTime(_ text: String) -> DateComponents? {
        let parts = text.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]),
              (0...23).contains(h), (0...59).contains(m) else { return nil }
        return DateComponents(hour: h, minute: m)
    }

    static func minutes(_ c: DateComponents) -> Int { (c.hour ?? 0) * 60 + (c.minute ?? 0) }

    /// True when `end` is earlier than `start` (e.g. 21:00 → 07:00).
    static func crossesMidnight(start: DateComponents, end: DateComponents) -> Bool {
        minutes(end) < minutes(start)
    }

    /// Window length in minutes, accounting for midnight crossing (0 when start == end).
    static func durationMinutes(start: DateComponents, end: DateComponents) -> Int {
        (minutes(end) - minutes(start) + 1440) % 1440
    }

    /// A downtime applies when it *starts* on a listed `Calendar.weekday` (1 = Sunday).
    static func isScheduled(today weekday: Int, days: [Int]) -> Bool {
        days.contains(weekday)
    }

    /// The limit's minutes on `weekday` (1 = Sunday, 7 = Saturday use `weekendMinutes`).
    static func minutes(for limit: ScreenTimeLimit, weekday: Int) -> Int {
        weekday == 1 || weekday == 7 ? (limit.weekendMinutes ?? limit.minutesPerDay) : limit.minutesPerDay
    }

    /// Is `now` inside the downtime window `start`–`end` that began on a listed day?
    static func isInsideWindow(start: String, end: String, days: [Int], now: Date, calendar: Calendar = .current) -> Bool {
        guard let s = parseTime(start), let e = parseTime(end), durationMinutes(start: s, end: e) > 0 else { return false }
        let nowMin = minutes(calendar.dateComponents([.hour, .minute], from: now))
        let today = calendar.component(.weekday, from: now)
        if crossesMidnight(start: s, end: e) {
            if nowMin >= minutes(s) { return isScheduled(today: today, days: days) }
            if nowMin < minutes(e) {
                let yesterday = today == 1 ? 7 : today - 1
                return isScheduled(today: yesterday, days: days)
            }
            return false
        }
        return nowMin >= minutes(s) && nowMin < minutes(e) && isScheduled(today: today, days: days)
    }

    /// The `pause` activity interval: nil when `until` is not in the future, otherwise
    /// `now → until` with the end pushed out to at least 15 minutes.
    static func pauseInterval(now: Date, until: Date?) -> DateInterval? {
        guard let until, until > now else { return nil }
        return DateInterval(start: now, end: max(until, now.addingTimeInterval(minimumInterval)))
    }

    /// Four quarter-day repeating windows (00:00–05:59, 06:00–11:59, …) whose starts
    /// wake the monitor extension to heartbeat even if the app is never opened.
    static func heartbeatWindows() -> [(start: DateComponents, end: DateComponents)] {
        (0..<4).map { q in
            (DateComponents(hour: q * 6, minute: 0), DateComponents(hour: q * 6 + 5, minute: 59))
        }
    }

    /// Parses server ISO-8601 timestamps with or without fractional seconds.
    static func date(fromISO text: String?) -> Date? {
        guard let text, !text.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: text) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: text)
    }
}
