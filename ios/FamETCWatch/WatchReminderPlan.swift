import Foundation

struct WatchReminder: Equatable {
    static let prefix = "fam_watch_"
    let id: String
    let title: String
    let body: String
    let fireAt: Date
}

enum WatchReminderPlan {
    static func make(snapshot: WatchSnapshot, focus: WatchFocusSession?, now: Date = Date(), calendar: Calendar = .current) -> [WatchReminder] {
        let horizon = now.addingTimeInterval(48 * 3600)
        var reminders: [WatchReminder] = []
        if let profile = snapshot.context?.profile,
           profile.role == "parent" || (profile.role == "kid" && !(profile.kidId ?? "").isEmpty),
           let updated = snapshot.updatedAt, updated <= now, now.timeIntervalSince(updated) < 48 * 3600 {
            func visible(_ kidID: String?) -> Bool {
                profile.role == "parent" || kidID == nil || kidID == profile.kidId
            }
            func append(_ id: String, _ title: String, _ body: String, _ date: Date?) {
                guard let date, date > now, date <= horizon,
                      (7..<21).contains(calendar.component(.hour, from: date)) else { return }
                reminders.append(WatchReminder(id: WatchReminder.prefix + id, title: title, body: body, fireAt: date))
            }
            for event in snapshot.context?.events ?? [] where visible(event.kidId) && !event.allDay {
                append("event_" + event.id, event.title, "Starts in 10 minutes", event.startsAt?.addingTimeInterval(-600))
            }
            let supportOwnsHomework = snapshot.support?.belongs(to: profile) == true && snapshot.support?.enabled == true
            if supportOwnsHomework, snapshot.supportRemindersEnabled == true, let support = snapshot.support {
                reminders.append(contentsOf: supportCues(support, hasHomework: !snapshot.openHomework.isEmpty, now: now, horizon: horizon))
            }
            for work in snapshot.homework where !supportOwnsHomework && visible(work.kidId) && !work.isDone && work.status != "snoozed" {
                append("homework_" + work.id, work.title, work.dueTime == nil ? "Due today. Take one small step." : "Homework is due now", WatchPlanDate.date(work.dueDate, work.dueTime ?? "17:00"))
            }
            for action in snapshot.actions where visible(action.kidId) && !action.isDone && action.status != "snoozed" {
                if profile.role == "kid", action.assigneeType == "kid", action.assigneeId != profile.kidId { continue }
                if supportOwnsHomework && action.sourceType == "homework" { continue }
                // A retained homework record owns its reminder, including its completed state.
                if action.sourceType == "homework", snapshot.homework.contains(where: { $0.id == action.sourceId }) { continue }
                let sourceID = action.sourceType == "homework" ? action.sourceId.map { "homework_" + $0 } : nil
                append(sourceID ?? ("action_" + action.id), action.title, action.dueTime == nil ? "Due today. Ready to tick it off?" : "Due now", WatchPlanDate.date(action.dueDate, action.dueTime ?? "17:00"))
            }
        }
        reminders.sort { $0.fireAt == $1.fireAt ? $0.id < $1.id : $0.fireAt < $1.fireAt }
        var seen = Set<String>()
        reminders = reminders.filter { seen.insert($0.id).inserted }
        let completion = focus.flatMap { session -> WatchReminder? in
            guard session.pausedAt == nil, !session.completionAcknowledged, session.endsAt > now, session.endsAt <= horizon else { return nil }
            return WatchReminder(id: WatchReminder.prefix + "focus_" + session.id.uuidString, title: session.titleSnapshot, body: "Focus finished. Take a break or check off your step.", fireAt: session.endsAt)
        }
        // Reserve a slot for the explicitly started focus session.
        reminders = Array(reminders.prefix(completion == nil ? 24 : 23))
        if let completion { reminders.append(completion) }
        return reminders.sorted { $0.fireAt == $1.fireAt ? $0.id < $1.id : $0.fireAt < $1.fireAt }
    }
    private static func supportCues(_ support: WatchStudentSupport, hasHomework: Bool, now: Date, horizon: Date) -> [WatchReminder] {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let updated = iso.date(from: support.refreshedAt) ?? ISO8601DateFormatter().date(from: support.refreshedAt),
              updated <= now, now.timeIntervalSince(updated) < 48 * 3600,
              let zone = TimeZone(identifier: support.timezone) else { return [] }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        func minutes(_ text: String) -> Int? {
            let parts = text.split(separator: ":").compactMap { Int($0) }
            guard parts.count == 2, (0..<24).contains(parts[0]), (0..<60).contains(parts[1]) else { return nil }
            return parts[0] * 60 + parts[1]
        }
        guard let quietStart = minutes(support.preferences.quietStart),
              let quietEnd = minutes(support.preferences.quietEnd) else { return [] }
        var result: [WatchReminder] = []
        func add(_ id: String, _ date: String, _ time: String) {
            guard let moment = formatter.date(from: date + " " + time), moment > now, moment <= horizon,
                  let minute = minutes(time) else { return }
            let quiet = quietStart < quietEnd ? (quietStart..<quietEnd).contains(minute)
                : quietStart > quietEnd && (minute >= quietStart || minute < quietEnd)
            guard !quiet else { return }
            result.append(WatchReminder(id: WatchReminder.prefix + "support_" + id,
                title: "My Next", body: "Ready for one small step? Open your plan.", fireAt: moment))
        }
        if hasHomework { add("homework", support.today, support.preferences.homeworkTime) }
        if let date = support.packing.date, !support.packing.items.isEmpty, ["verified", "manual"].contains(support.packing.coverage) {
            add("packing", support.today, support.preferences.packingTime)
            if support.packing.items.contains(where: { !["packed", "at_school"].contains($0.status) }) {
                add("morning", date, support.preferences.morningTime)
            }
        }
        // One bundled routine cue, never one notification for every checklist item.
        if let routine = support.occurrences.filter({ ["open", "help", "snoozed"].contains($0.status) }).sorted(by: {
            ($0.date + $0.time) < ($1.date + $1.time)
        }).first {
            if routine.status == "snoozed", let snoozed = routine.snoozedUntil,
               let date = iso.date(from: snoozed) ?? ISO8601DateFormatter().date(from: snoozed) {
                let value = formatter.string(from: date).split(separator: " ")
                if value.count == 2 { add("routine", String(value[0]), String(value[1])) }
            } else { add("routine", routine.date, routine.time) }
        }
        return result
    }

}
