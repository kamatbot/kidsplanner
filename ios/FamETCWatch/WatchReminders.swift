import Foundation
import UserNotifications

@MainActor
final class WatchReminders {
    static let shared = WatchReminders()
    private let center = UNUserNotificationCenter.current()
    private var revision = 0
    private var operation: Task<String, Never>?

    func authorize() async -> Bool {
        do { return try await center.requestAuthorization(options: [.alert, .sound]) }
        catch { return false }
    }

    func refresh(snapshot: WatchSnapshot, focus: WatchFocusSession?) async -> String {
        revision += 1
        let requestedRevision = revision
        let previous = operation
        let task = Task { @MainActor in
            _ = await previous?.value
            guard requestedRevision == revision else { return "Reminders updated" }
            let settings = await center.notificationSettings()
            guard requestedRevision == revision else { return "Reminders updated" }
            let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
            let plan = allowed ? WatchReminderPlan.make(snapshot: snapshot, focus: focus) : []
            let pending = await center.pendingNotificationRequests().filter { $0.identifier.hasPrefix(WatchReminder.prefix) }
            guard requestedRevision == revision else { return "Reminders updated" }
            let wanted = Set(plan.map(\.id))
            center.removePendingNotificationRequests(withIdentifiers: pending.filter { !wanted.contains($0.identifier) }.map(\.identifier))
            var failures = 0
            for reminder in plan {
                guard requestedRevision == revision else { return "Reminders updated" }
                if let old = pending.first(where: { $0.identifier == reminder.id }),
                   old.content.title == reminder.title, old.content.body == reminder.body,
                   let date = (old.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate(),
                   abs(date.timeIntervalSince(reminder.fireAt)) < 1 { continue }
                let content = UNMutableNotificationContent()
                content.title = reminder.title
                content.body = reminder.body
                content.sound = .default
                content.userInfo = ["watchReminderID": reminder.id]
                var components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: reminder.fireAt)
                components.timeZone = .current
                let request = UNNotificationRequest(identifier: reminder.id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
                do { try await center.add(request) } catch { failures += 1 }
                if requestedRevision != revision {
                    center.removePendingNotificationRequests(withIdentifiers: [reminder.id])
                    return "Reminders updated"
                }
            }
            if !allowed { return settings.authorizationStatus == .notDetermined ? "Enable reminders to get a nudge" : "Reminders are off in Settings" }
            if failures > 0 { return "Some reminders could not be scheduled" }
            return plan.isEmpty ? "No upcoming reminders" : "\(plan.count) reminders ready"
        }
        operation = task
        return await task.value
    }

    func clear() async {
        revision += 1
        let previous = operation
        let task = Task { @MainActor in
            _ = await previous?.value
            let pending = await center.pendingNotificationRequests()
            center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.identifier.hasPrefix(WatchReminder.prefix) }.map(\.identifier))
            let delivered = await center.deliveredNotifications()
            center.removeDeliveredNotifications(withIdentifiers: delivered.filter { $0.request.identifier.hasPrefix(WatchReminder.prefix) }.map { $0.request.identifier })
            return "Reminders cleared"
        }
        operation = task
        _ = await task.value
    }
}
