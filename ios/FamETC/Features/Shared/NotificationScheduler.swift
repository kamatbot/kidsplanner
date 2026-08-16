import Foundation
import UserNotifications

/// Schedules local reminders for family calendar events and homework due dates.
/// Idempotent: every call clears out our previously-scheduled reminders (identified
/// by the `fam-ev-` / `fam-hw-` prefixes) before scheduling the current set, so it's
/// safe to call this every time `loadCalendarAndHomework` runs.
enum NotificationScheduler {
    private static let eventPrefix = "fam-ev-"
    private static let homeworkPrefix = "fam-hw-"
    private static let reminderOverridesKey = "fam_calendar_reminder_overrides"

    /// Maximum number of pending reminders we schedule at once (iOS caps pending
    /// local notifications at 64 per app; we leave headroom for other uses).
    private static let maxScheduled = 30

    /// A candidate reminder waiting to be scheduled, kept alongside its fire date
    /// so we can sort and cap before touching the notification center.
    private struct Candidate {
        let identifier: String
        let fireDate: Date
        let title: String
        let body: String
    }

    /// Timetable imports are quiet by default; every other timed family event,
    /// including ECA events, starts with a reminder on. The preference is
    /// device-local because local notifications are device-specific.
    static func defaultReminderEnabled(for event: FamilyEvent) -> Bool {
        guard let time = event.time,
              !time.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return event.sourceType == "eca" || !event.isImportedTimetable
    }

    /// Preferences are per event occurrence: recurring rows share an event id,
    /// so the occurrence date keeps one occurrence's choice from changing the
    /// others.
    static func reminderPreferenceKey(for event: FamilyEvent) -> String {
        event.id + "|" + (event.occurrenceDate ?? event.date)
    }

    /// Pure reminder decision used by the scheduler and focused unit tests.
    static func reminderEnabled(for event: FamilyEvent, overrides: [String: Bool]) -> Bool {
        guard let time = event.time,
              !time.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return overrides[reminderPreferenceKey(for: event)] ?? defaultReminderEnabled(for: event)
    }

    static func reminderEnabled(for event: FamilyEvent, defaults: UserDefaults = .standard) -> Bool {
        reminderEnabled(for: event, overrides: reminderOverrides(from: defaults))
    }

    static func reminderEligibleEvents(_ events: [FamilyEvent], overrides: [String: Bool] = [:]) -> [FamilyEvent] {
        events.filter { reminderEnabled(for: $0, overrides: overrides) }
    }

    /// Homework keeps its existing completion rule and does not consult event
    /// reminder preferences.
    static func homeworkReminderEligible(_ item: HomeworkItem) -> Bool { !item.isDone }

    static func setReminderEnabled(_ enabled: Bool, for event: FamilyEvent, defaults: UserDefaults = .standard) {
        var overrides = reminderOverrides(from: defaults)
        overrides[reminderPreferenceKey(for: event)] = enabled
        defaults.set(overrides, forKey: reminderOverridesKey)
    }

    private static func reminderOverrides(from defaults: UserDefaults) -> [String: Bool] {
        guard let stored = defaults.dictionary(forKey: reminderOverridesKey) else { return [:] }
        return stored.reduce(into: [String: Bool]()) { result, item in
            if let value = item.value as? Bool { result[item.key] = value }
        }
    }

    static func reschedule(events: [FamilyEvent], homework: [HomeworkItem], kids: [Kid]) async {
        let center = UNUserNotificationCenter.current()

        // Remove any reminders we previously scheduled so this call is idempotent.
        let pending = await center.pendingNotificationRequests()
        let staleIdentifiers = pending
            .map { $0.identifier }
            .filter { $0.hasPrefix(eventPrefix) || $0.hasPrefix(homeworkPrefix) }
        if !staleIdentifiers.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: staleIdentifiers)
        }

        // Only schedule new reminders if the user has actually granted permission.
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
            return
        }

        let now = Date()
        var candidates: [Candidate] = []
        let overrides = reminderOverrides(from: .standard)

        // Calendar events: remind 10 minutes before the event starts.
        for event in reminderEligibleEvents(events, overrides: overrides) {
            guard let time = event.time, !time.isEmpty else { continue }
            guard let start = localDate(dateString: event.date, timeString: time) else { continue }
            let fireDate = start.addingTimeInterval(-10 * 60)
            guard fireDate > now else { continue }

            var body = "Starts at \(time)"
            if let notes = event.notes, !notes.isEmpty {
                let trimmed = notes.count > 80 ? String(notes.prefix(80)) + "…" : notes
                body += " — \(trimmed)"
            }

            candidates.append(Candidate(
                // Occurrences of a recurring series share `id` — key by date too,
                // so each occurrence gets its own reminder instead of last-write-wins.
                identifier: eventPrefix + event.id + "-" + (event.occurrenceDate ?? event.date),
                fireDate: fireDate,
                title: "📅 Upcoming: \(event.title)",
                body: body
            ))
        }

        // Homework: remind 8 hours before the due moment, addressed to the right kid.
        for item in homework {
            guard homeworkReminderEligible(item) else { continue }
            let dueTime = item.dueTime ?? "08:00"
            guard let due = localDate(dateString: item.dueDate, timeString: dueTime) else { continue }
            let fireDate = due.addingTimeInterval(-8 * 60 * 60)
            guard fireDate > now else { continue }

            let kidName = kids.first { $0.id == item.kidId }?.name
            let title = "📚 " + (kidName != nil ? "\(kidName!)'s homework due soon!" : "Homework due soon!")
            let body = "\(item.title) — due \(item.dueDate)"

            candidates.append(Candidate(
                identifier: homeworkPrefix + item.id,
                fireDate: fireDate,
                title: title,
                body: body
            ))
        }

        // Cap total pending reminders: schedule only the soonest ones.
        let toSchedule = candidates.sorted { $0.fireDate < $1.fireDate }.prefix(maxScheduled)

        for candidate in toSchedule {
            let content = UNMutableNotificationContent()
            content.title = candidate.title
            content.body = candidate.body
            content.sound = .default

            let components = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute],
                from: candidate.fireDate
            )
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            let request = UNNotificationRequest(identifier: candidate.identifier, content: content, trigger: trigger)
            _ = try? await center.add(request)
        }
    }

    /// Parses a "YYYY-MM-DD" date string and an "HH:mm" time string into a `Date`
    /// in the device's current local timezone. Returns `nil` on any malformed input
    /// so callers can safely skip that item rather than crash.
    private static func localDate(dateString: String, timeString: String) -> Date? {
        let dateParts = dateString.split(separator: "-")
        guard dateParts.count == 3,
              let year = Int(dateParts[0]),
              let month = Int(dateParts[1]),
              let day = Int(dateParts[2]) else { return nil }

        let timeParts = timeString.split(separator: ":")
        guard timeParts.count >= 2,
              let hour = Int(timeParts[0]),
              let minute = Int(timeParts[1]) else { return nil }

        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute

        return Calendar.current.date(from: components)
    }
}
