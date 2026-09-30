import Foundation

// Pure guards shared with native tests. A legacy server cannot move a device
// back after a generation-aware assignment has been observed.
extension ScreenTimeSchedule {
    static func acceptsAssignment(incoming: Int?, current: Int) -> Bool {
        guard let incoming else { return current <= 1 }
        return incoming >= max(1, current)
    }

    static func acceptsEnrollment(incomingGeneration: Int?, currentGeneration: Int,
                                  incomingDeviceId: String, currentDeviceId: String?) -> Bool {
        guard incomingDeviceId == currentDeviceId else { return (incomingGeneration ?? 1) >= 1 }
        return acceptsAssignment(incoming: incomingGeneration, current: currentGeneration)
    }

    static func healthState(enabled: Bool, failures: [String], missingSelection: Bool, registered: Int) -> String {
        if !failures.isEmpty { return registered == 0 ? "failed" : "partial" }
        if !enabled { return "off" }
        return missingSelection ? "needsSelection" : "applied"
    }

    /// Re-registering during the assignment day must exclude Apple's activity
    /// from before the move. Only already-recorded post-assignment 15-minute
    /// milestones can be carried forward; elapsed time is an upper bound.
    static func registrationUsage(assignmentResetAt: Date?, now: Date, retained: ScreenTimeUsageRecord?,
                                  calendar: Calendar = .current) -> (includesPastActivity: Bool, baseMinutes: Int) {
        guard let reset = assignmentResetAt, calendar.isDate(reset, inSameDayAs: now) else { return (true, 0) }
        guard let retained, retained.date == dayString(now, calendar: calendar),
              retained.minutes >= 0, retained.minutes % 15 == 0,
              isPlausibleAssignmentUsage(minutes: retained.minutes, assignmentResetAt: reset, now: now, calendar: calendar) else { return (false, 0) }
        return (false, retained.minutes)
    }

    static func countedMilestone(minutes: Int, baseMinutes: Int) -> Int {
        min(1440, max(0, minutes) + max(0, baseMinutes))
    }

    static func isPlausibleAssignmentUsage(minutes: Int, assignmentResetAt: Date?, now: Date,
                                           calendar: Calendar = .current) -> Bool {
        guard let reset = assignmentResetAt, calendar.isDate(reset, inSameDayAs: now) else { return true }
        return minutes <= Int(max(0, now.timeIntervalSince(reset)) / 60)
    }

    static func needsHealthAcknowledgement(previous: ScreenTimeDeviceHealth?, current: ScreenTimeDeviceHealth?,
                                            previousVersion: Int, currentVersion: Int) -> Bool {
        previous != current || previousVersion != currentVersion
    }
}

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

    // MARK: Enforcement guards (docs/SCREEN-TIME-UX.md §5)

    /// `ManagedSettingsStore.Name` raw values the enforcer shields with.
    static let downtimeStore = "downtime"
    static let pauseStore = "pause"
    static func limitStore(_ id: String) -> String { "limit.\(id)" }

    /// DeviceActivity can deliver an interval start a moment before its scheduled minute.
    static let callbackLeeway: TimeInterval = 60

    /// Milestones are the truth for `total`: shield iff today's recorded minutes reached the
    /// allowance, or a real `limit.total` event fired and the minutes are within one
    /// 15-minute milestone of it. A spurious event with nothing recorded shields nothing.
    static func totalShieldDecision(recorded: Int, threshold: Int, limitEventSeenToday: Bool) -> Bool {
        guard threshold > 0 else { return false }
        if recorded >= threshold { return true }
        return limitEventSeenToday && recorded > 0 && recorded >= threshold - 15
    }

    /// Usage can't exceed the time since local midnight (day.N starts at 00:00), with under a
    /// minute of slack. Rejects spurious `usage.<m>` milestones (seen on iOS 26.2/26.3), e.g.
    /// usage.120 at 01:00 or usage.15 at 00:14.
    static func isPlausibleUsage(minutes: Int, now: Date, calendar: Calendar = .current) -> Bool {
        let elapsed = now.timeIntervalSince(calendar.startOfDay(for: now)) / 60
        return Double(minutes) < elapsed + 1
    }

    /// Does a `limit.total` event recorded at `eventAt` still vouch for today's `threshold`?
    /// Only when it fired today on a registration at least that high (a bonus the app
    /// hasn't registered yet raises the threshold past the event). nil registration = same.
    static func totalEventCounts(eventAt: Date?, registeredMinutes: Int?, threshold: Int, now: Date,
                                 calendar: Calendar = .current) -> Bool {
        guard let eventAt, dayString(eventAt, calendar: calendar) == dayString(now, calendar: calendar) else { return false }
        return (registeredMinutes ?? threshold) >= threshold
    }

    /// Is `name` today's `day.N` activity? Anything else (another weekday, downtime, pause,
    /// heartbeat, a malformed name) is never a reason to shield on a threshold event.
    static func isTodayActivity(_ name: String, now: Date, calendar: Calendar = .current) -> Bool {
        guard name.hasPrefix("day."), let n = Int(name.dropFirst("day.".count)) else { return false }
        return n == calendar.component(.weekday, from: now)
    }

    /// Within 60 s of the app (re)registering the schedules (or with the clock set back):
    /// DeviceActivity's `includesPastActivity` burst, not a real crossing.
    static func isRegistrationEcho(now: Date, registeredAt: Date?) -> Bool {
        guard let registeredAt else { return false }
        return now.timeIntervalSince(registeredAt) <= 60
    }

    /// Apps limits have no milestone cross-check, so a `limit.<id>` event in the
    /// registration burst is ignored — unless today's recorded total (apps ⊆ everything)
    /// already vouches for it, e.g. a limit reached this morning and re-registered by a
    /// bonus. The defaults give the plain 60 s rule.
    static func shouldIgnoreAppsLimitEvent(now: Date, registeredAt: Date?,
                                           recordedMinutes: Int = 0, threshold: Int = 0) -> Bool {
        guard isRegistrationEcho(now: now, registeredAt: registeredAt) else { return false }
        return !totalShieldDecision(recorded: recordedMinutes, threshold: threshold, limitEventSeenToday: true)
    }

    /// Ids of the enabled policy's downtime windows `now` is inside (empty when off).
    static func activeDowntimeIds(_ policy: ScreenTimePolicy?, now: Date, calendar: Calendar = .current) -> [String] {
        guard let policy, policy.enabled else { return [] }
        return policy.downtime
            .filter { isInsideWindow(start: $0.start, end: $0.end, days: $0.days, now: now, calendar: calendar) }
            .map(\.id)
    }

    /// `downtime.<id>` started: shield only when `now` (or just after, for an early
    /// callback) is inside the window that began on a listed day — not "today is listed".
    static func downtimeShouldShield(_ window: ScreenTimeDowntime, now: Date, calendar: Calendar = .current) -> Bool {
        isInsideWindow(start: window.start, end: window.end, days: window.days, now: now, calendar: calendar)
            || isInsideWindow(start: window.start, end: window.end, days: window.days,
                              now: now.addingTimeInterval(callbackLeeway), calendar: calendar)
    }

    /// What `ScreenTimeEnforcer.reconcileShields` clears: the store names the stored policy
    /// doesn't justify right now. Removes only — it never names a store to shield.
    /// - shieldedLimitIds: limit ids with a shield reason recorded.
    /// - todayMinutes, totalEventCounts: `total` keeps its shield only while
    ///   `totalShieldDecision` still says so (a new day or a bonus lifts it).
    /// - staleLimitIds: apps limits whose shielding event was on another day.
    static func storesToClear(policy: ScreenTimePolicy?, isEnrolled: Bool, shieldedLimitIds: Set<String>,
                              todayMinutes: Int = 0, totalEventCounts: Bool = false,
                              staleLimitIds: Set<String> = [], now: Date,
                              calendar: Calendar = .current) -> Set<String> {
        guard isEnrolled, let policy, policy.enabled else {
            let ids = shieldedLimitIds.union(policy?.limits.map(\.id) ?? [])
            return Set(ids.map { limitStore($0) }).union([downtimeStore, pauseStore])
        }
        var clear = Set<String>()
        if pauseInterval(now: now, until: policy.pauseUntilDate) == nil { clear.insert(pauseStore) }
        // Same leeway as `downtimeShouldShield`, so an early `downtime.<id>` start's shield
        // isn't removed by another reconcile in the seconds before the window opens.
        if activeDowntimeIds(policy, now: now, calendar: calendar).isEmpty,
           activeDowntimeIds(policy, now: now.addingTimeInterval(callbackLeeway), calendar: calendar).isEmpty {
            clear.insert(downtimeStore)
        }
        let weekday = calendar.component(.weekday, from: now)
        for id in shieldedLimitIds {
            guard let limit = policy.limits.first(where: { $0.id == id }) else {
                clear.insert(limitStore(id))
                continue
            }
            if limit.isTotal {
                let threshold = minutes(for: limit, weekday: weekday, bonus: policy.bonus, today: now, calendar: calendar)
                if !isPlausibleUsage(minutes: todayMinutes, now: now, calendar: calendar)
                    || !totalShieldDecision(recorded: todayMinutes, threshold: threshold, limitEventSeenToday: totalEventCounts) {
                    clear.insert(limitStore(id))
                }
            } else if staleLimitIds.contains(id) {
                clear.insert(limitStore(id))
            }
        }
        return clear
    }
}
