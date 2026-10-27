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
            let plan = allowed ? WatchReminderPlan.make(snapshot: snapshot, focus: focus, ledger: WatchAlarmLedgerStore.load()) : []
            // The smart-alarm session always tracks the soonest first buzz.
            WatchAlarmSession.shared.arm(plan.first { $0.kind.isStrong && $0.followUp == 0 })
            let pending = await center.pendingNotificationRequests().filter { $0.identifier.hasPrefix(WatchReminder.prefix) }
            guard requestedRevision == revision else { return "Reminders updated" }
            let wanted = Set(plan.map(\.id))
            center.removePendingNotificationRequests(withIdentifiers: pending.filter { !wanted.contains($0.identifier) }.map(\.identifier))
            var failures = 0
            for reminder in plan {
                guard requestedRevision == revision else { return "Reminders updated" }
                let content = Self.content(for: reminder)
                if let old = pending.first(where: { $0.identifier == reminder.id }),
                   old.content.title == content.title, old.content.body == content.body,
                   old.content.categoryIdentifier == content.categoryIdentifier,
                   let date = (old.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate(),
                   abs(date.timeIntervalSince(reminder.fireAt)) < 1 { continue }
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
            let items = Set(plan.map(\.seriesID)).count
            return plan.isEmpty ? "No upcoming reminders" : "\(items) reminders ready"
        }
        operation = task
        return await task.value
    }

    static func content(for reminder: WatchReminder) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = reminder.body
        content.sound = .default
        var info: [String: Any] = ["watchReminderID": reminder.id, "watchReminderSeries": reminder.seriesID,
                                   "watchReminderKind": reminder.kind.rawValue,
                                   "watchReminderDueAt": reminder.occurrence.timeIntervalSince1970]
        if let homeworkID = reminder.homeworkID { info["watchReminderHomework"] = homeworkID }
        if let actionID = reminder.actionID { info["watchReminderAction"] = actionID }
        content.userInfo = info
        if reminder.kind.isStrong {
            // Breaks through Focus with the Time Sensitive entitlement; Critical
            // Alerts are deliberately not used.
            content.interruptionLevel = .timeSensitive
            content.relevanceScore = 1
            content.threadIdentifier = reminder.seriesID
            content.categoryIdentifier = WatchAlarmNotifications.category(kind: reminder.kind, canSnooze: reminder.snoozesLeft > 0)
        }
        return content
    }

    /// Cancels a reminder's first buzz and re-alerts, pending and delivered.
    func cancelSeries(_ seriesID: String) async {
        let ids = [seriesID] + (1...WatchReminder.maxFollowUps).map { seriesID + "_f\($0)" }
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }

    func clear() async {
        revision += 1
        let previous = operation
        let task = Task { @MainActor in
            _ = await previous?.value
            WatchAlarmLedgerStore.clear()
            WatchAlarmSession.shared.disarm()
            WatchAlarmSession.shared.stop()
            WatchAlarmCenter.shared.presentation = nil
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
