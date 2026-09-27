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

    /// Device-local "YYYY-MM-DD" for `date` (the request/bonus day key).
    static func dayString(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Bonus minutes that count today, nil when there's no bonus for `today`.
    static func activeBonus(_ bonus: ScreenTimeBonus?, today: Date, calendar: Calendar = .current) -> Int? {
        guard let bonus, bonus.minutes > 0, bonus.date == dayString(today, calendar: calendar) else { return nil }
        return bonus.minutes
    }

    /// Like `minutes(for:weekday:)`, plus today's approved bonus on the `total` limit
    /// for today's weekday only. App limits and other days never change.
    static func minutes(for limit: ScreenTimeLimit, weekday: Int, bonus: ScreenTimeBonus?,
                        today: Date, calendar: Calendar = .current) -> Int {
        let base = minutes(for: limit, weekday: weekday)
        guard limit.isTotal, calendar.component(.weekday, from: today) == weekday,
              let extra = activeBonus(bonus, today: today, calendar: calendar) else { return base }
        return base + extra
    }

    // MARK: Usage milestones (docs/SCREEN-TIME-PLAN.md "Usage details")

    /// `usage.<m>` threshold events every 15 minutes, 15…960 (16 h), on each `day.N`.
    static let usageMilestones: [Int] = Array(stride(from: 15, through: 960, by: 15))

    static func usageEventName(_ minutes: Int) -> String { "usage.\(minutes)" }

    /// "usage.45" → 45; nil for any other event or a value that isn't a 15-minute step.
    static func usageMinutes(fromEvent name: String) -> Int? {
        guard name.hasPrefix("usage."), let m = Int(name.dropFirst("usage.".count)),
              m > 0, m <= 1440, m % 15 == 0 else { return nil }
        return m
    }

    /// Folds a milestone and/or "limit reached" into today's record. A new day starts
    /// from zero; minutes only go up; the first `limitReachedAt` of the day wins.
    static func mergeUsage(_ record: ScreenTimeUsageRecord?, today: String,
                           minutes: Int? = nil, limitReachedAt: String? = nil) -> ScreenTimeUsageRecord {
        var r = record?.date == today ? record! : ScreenTimeUsageRecord(date: today, minutes: 0, limitReachedAt: nil)
        if let minutes { r.minutes = max(r.minutes, min(minutes, 1440)) }
        if r.limitReachedAt == nil { r.limitReachedAt = limitReachedAt }
        return r
    }

    /// Today's `total` allowance in minutes (weekday/weekend + today's bonus); nil when
    /// Screen Time is off or there's no daily limit.
    static func todayAllowance(_ policy: ScreenTimePolicy?, now: Date, calendar: Calendar = .current) -> Int? {
        guard let policy, policy.enabled, let total = policy.limits.first(where: \.isTotal) else { return nil }
        return minutes(for: total, weekday: calendar.component(.weekday, from: now), bonus: policy.bonus,
                       today: now, calendar: calendar)
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
