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
            for work in snapshot.homework where visible(work.kidId) && !work.isDone && work.status != "snoozed" {
                append("homework_" + work.id, work.title, work.dueTime == nil ? "Due today. Take one small step." : "Homework is due now", WatchPlanDate.date(work.dueDate, work.dueTime ?? "17:00"))
            }
            for action in snapshot.actions where visible(action.kidId) && !action.isDone && action.status != "snoozed" {
                if profile.role == "kid", action.assigneeType == "kid", action.assigneeId != profile.kidId { continue }
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
            guard !session.completionAcknowledged, session.endsAt > now, session.endsAt <= horizon else { return nil }
            return WatchReminder(id: WatchReminder.prefix + "focus_" + session.id.uuidString, title: session.titleSnapshot, body: "Focus finished. Take a break or check off your step.", fireAt: session.endsAt)
        }
        // Reserve a slot for the explicitly started focus session.
        reminders = Array(reminders.prefix(completion == nil ? 24 : 23))
        if let completion { reminders.append(completion) }
        return reminders.sorted { $0.fireAt == $1.fireAt ? $0.id < $1.id : $0.fireAt < $1.fireAt }
    }
}
