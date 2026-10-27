import Foundation
import UserNotifications
import WatchKit

// MARK: - Notification categories and responses

/// Reminder notification categories and the response handling that the
/// UNUserNotificationCenter delegate forwards here. Reminders never notify a
/// parent, however many buzzes are ignored.
enum WatchAlarmNotifications {
    static let homeworkCategory = "FAM_REMINDER_HOMEWORK"
    static let homeworkFinalCategory = "FAM_REMINDER_HOMEWORK_FINAL"
    static let choreCategory = "FAM_REMINDER_CHORE"
    static let choreFinalCategory = "FAM_REMINDER_CHORE_FINAL"
    static let startAction = "FAM_REMINDER_START"
    static let doneAction = "FAM_REMINDER_DONE"
    static let snoozeAction = "FAM_REMINDER_SNOOZE"

    static func category(kind: WatchReminderKind, canSnooze: Bool) -> String {
        switch (kind, canSnooze) {
        case (.homework, true): return homeworkCategory
        case (.homework, false): return homeworkFinalCategory
        case (_, true): return choreCategory
        case (_, false): return choreFinalCategory
        }
    }

    static var categories: Set<UNNotificationCategory> {
        let start = UNNotificationAction(identifier: startAction, title: "Start", options: [.foreground])
        let done = UNNotificationAction(identifier: doneAction, title: "Done", options: [])
        let snoozeHomework = UNNotificationAction(identifier: snoozeAction, title: "5 min", options: [])
        let snoozeChore = UNNotificationAction(identifier: snoozeAction, title: "Later", options: [])
        func make(_ id: String, _ actions: [UNNotificationAction]) -> UNNotificationCategory {
            UNNotificationCategory(identifier: id, actions: actions, intentIdentifiers: [], options: [])
        }
        return [make(homeworkCategory, [start, snoozeHomework]), make(homeworkFinalCategory, [start]),
                make(choreCategory, [done, snoozeChore]), make(choreFinalCategory, [done])]
    }

    static func isReminder(_ notification: UNNotification) -> Bool {
        notification.request.identifier.hasPrefix(WatchReminder.prefix)
    }

    struct Reference: Equatable {
        let seriesID: String
        let kind: WatchReminderKind
        let dueAt: Date
        let homeworkID: String?
        let actionID: String?

        init?(userInfo: [AnyHashable: Any]) {
            guard let series = userInfo["watchReminderSeries"] as? String,
                  let kind = (userInfo["watchReminderKind"] as? String).flatMap(WatchReminderKind.init(rawValue:)),
                  let due = userInfo["watchReminderDueAt"] as? Double else { return nil }
            seriesID = series
            self.kind = kind
            dueAt = Date(timeIntervalSince1970: due)
            homeworkID = userInfo["watchReminderHomework"] as? String
            actionID = userInfo["watchReminderAction"] as? String
        }
    }

    /// Foreground arrival: show the full-screen alarm instead of a banner.
    @MainActor
    static func willPresent(_ notification: UNNotification) -> UNNotificationPresentationOptions {
        guard let reference = Reference(userInfo: notification.request.content.userInfo), reference.kind.isStrong else {
            return [.banner, .sound]
        }
        WatchAlarmCenter.shared.present(reference)
        return WatchAlarmCenter.shared.presentation == nil ? [.banner, .sound] : []
    }

    /// Start / Done / Snooze from the notification, or a tap that opens the app.
    /// Returns true when the response was a homework/chore reminder.
    @MainActor
    static func handle(_ response: UNNotificationResponse) async -> Bool {
        guard let reference = Reference(userInfo: response.notification.request.content.userInfo), reference.kind.isStrong else { return false }
        let center = WatchAlarmCenter.shared
        let alarm = center.alarm(for: reference)
        switch response.actionIdentifier {
        case startAction:
            await center.start(alarm)
        case doneAction:
            await center.done(alarm, showSummary: false)
        case snoozeAction:
            await center.snooze(alarm)
        case UNNotificationDefaultActionIdentifier:
            center.present(reference)
        default:
            // Dismissing the alert is not an acknowledgement: re-alerts continue.
            break
        }
        return true
    }

    /// For `FamETCWatchExtensionDelegate.additionalPresentationHandler`: nil
    /// leaves non-reminder notifications to the default banner.
    @MainActor
    static func presentationOptions(_ notification: UNNotification) -> UNNotificationPresentationOptions? {
        guard isReminder(notification) else { return nil }
        return willPresent(notification)
    }

    /// Wires reminders into the app delegate's notification hooks.
    @MainActor
    static func install() {
        FamETCWatchExtensionDelegate.additionalCategories = { WatchAlarmNotifications.categories }
        FamETCWatchExtensionDelegate.additionalResponseHandler = { await WatchAlarmNotifications.handle($0) }
        FamETCWatchExtensionDelegate.additionalPresentationHandler = { WatchAlarmNotifications.presentationOptions($0) }
    }
}

// MARK: - In-app alarm state

@MainActor
final class WatchAlarmCenter: ObservableObject {
    static let shared = WatchAlarmCenter()

    enum Presentation: Equatable {
        case alarm(WatchReminder)
        case homework(String)
        case done(WatchDoneSummary)
    }

    @Published var presentation: Presentation?
    private var store: WatchStore { WatchStore.shared }

    /// Called while the app is in front: shows the reminder that is ringing now.
    func presentDueIfNeeded(now: Date = Date()) {
        guard presentation == nil else { return }
        if let due = WatchReminderPlan.dueAlarm(snapshot: store.snapshot, ledger: WatchAlarmLedgerStore.load(), now: now) {
            presentation = .alarm(due)
        }
    }

    func present(_ reference: WatchAlarmNotifications.Reference) {
        if case .alarm = presentation { return }
        if let live = WatchReminderPlan.alarm(seriesID: reference.seriesID, snapshot: store.snapshot,
                                              ledger: WatchAlarmLedgerStore.load()),
           abs(live.occurrence.timeIntervalSince(reference.dueAt)) < 1 {
            presentation = .alarm(live)
        }
    }

    /// The live alarm for a notification, falling back to its payload when the
    /// cache no longer lists it (so an acknowledgement still cancels re-alerts).
    func alarm(for reference: WatchAlarmNotifications.Reference) -> WatchReminder {
        if let live = WatchReminderPlan.alarm(seriesID: reference.seriesID, snapshot: store.snapshot,
                                              ledger: WatchAlarmLedgerStore.load()),
           abs(live.occurrence.timeIntervalSince(reference.dueAt)) < 1 { return live }
        let ledger = WatchAlarmLedgerStore.load()
        return WatchReminder(id: reference.seriesID, title: "", body: "", fireAt: reference.dueAt, kind: reference.kind,
                             seriesID: reference.seriesID, homeworkID: reference.homeworkID, actionID: reference.actionID,
                             dueAt: reference.dueAt, snoozesLeft: ledger.snoozesLeft(reference.seriesID, dueAt: reference.dueAt))
    }

    /// Fams paid for a timed family action whose title matches a pending chore.
    func famsAmount(for alarm: WatchReminder) -> Int? {
        guard alarm.kind == .chore else { return nil }
        return store.snapshot.chores?.first {
            $0.isOpen && $0.title.caseInsensitiveCompare(alarm.title) == .orderedSame
        }?.amount
    }

    /// Homework "Start": acknowledged, then the assignment opens on the watch.
    func start(_ alarm: WatchReminder) async {
        await acknowledge(alarm)
        if let id = alarm.homeworkID, store.snapshot.homework.contains(where: { $0.id == id }) {
            presentation = .homework(id)
        } else {
            presentation = nil
        }
        await rescheduleReminders()
    }

    /// Chore "Done": completes the action through the durable outbox.
    func done(_ alarm: WatchReminder, showSummary: Bool = true) async {
        await acknowledge(alarm)
        var item: WatchMyListItem?
        if let id = alarm.actionID, let action = store.snapshot.actions.first(where: { $0.id == id }), !action.isDone {
            item = WatchMyList.item(for: action, now: Date())
        } else if let id = alarm.homeworkID, let work = store.snapshot.homework.first(where: { $0.id == id }), !work.isDone {
            item = WatchMyList.item(for: work, now: Date())
        }
        var summary: WatchDoneSummary?
        if let item { summary = await store.completeMyListItem(item) }
        presentation = showSummary ? summary.map { .done($0) } : nil
        if summary == nil { await rescheduleReminders() }
    }

    /// Snooze for five minutes; at most two snoozes per reminder.
    func snooze(_ alarm: WatchReminder, now: Date = Date()) async {
        var ledger = WatchAlarmLedgerStore.load()
        guard ledger.snooze(alarm.seriesID, dueAt: alarm.occurrence, now: now) else {
            // No snoozes left: keep the alarm up.
            return
        }
        WatchAlarmLedgerStore.save(ledger)
        WatchAlarmSession.shared.stop()
        await WatchReminders.shared.cancelSeries(alarm.seriesID)
        presentation = nil
        await rescheduleReminders()
    }

    func dismiss() { presentation = nil }

    private func acknowledge(_ alarm: WatchReminder) async {
        var ledger = WatchAlarmLedgerStore.load()
        ledger.acknowledge(alarm.seriesID, dueAt: alarm.occurrence)
        WatchAlarmLedgerStore.save(ledger)
        WatchAlarmSession.shared.stop()
        await WatchReminders.shared.cancelSeries(alarm.seriesID)
    }

    private func rescheduleReminders() async {
        _ = await WatchReminders.shared.refresh(snapshot: store.snapshot, focus: store.focusSession)
    }
}

// MARK: - Smart-alarm extended runtime session

/// Keeps one `WKExtendedRuntimeSession` smart alarm scheduled for the soonest
/// strong reminder. At fire time watchOS wakes the app and `notifyUser`
/// repeats a strong haptic until the child responds.
@MainActor
final class WatchAlarmSession: NSObject, WKExtendedRuntimeSessionDelegate {
    static let shared = WatchAlarmSession()
    static let hapticInterval: TimeInterval = 4

    private var scheduled: WKExtendedRuntimeSession?
    private var scheduledSeries: String?
    private var scheduledAt: Date?
    private var running: WKExtendedRuntimeSession?
    /// Read by the system's repeat handler, which may run off the main actor.
    private let ringing = WatchAlarmFlag()

    /// Schedules (or moves) the smart alarm. Scheduling needs the app in front,
    /// so this is a no-op in the background and the next activation re-arms.
    func arm(_ reminder: WatchReminder?) {
        guard let reminder else { disarm(); return }
        if scheduledSeries == reminder.seriesID, let at = scheduledAt, abs(at.timeIntervalSince(reminder.fireAt)) < 1,
           scheduled?.state == .scheduled { return }
        guard WKApplication.shared().applicationState == .active else { return }
        scheduled?.invalidate()
        let session = WKExtendedRuntimeSession()
        session.delegate = self
        session.start(at: reminder.fireAt)
        scheduled = session
        scheduledSeries = reminder.seriesID
        scheduledAt = reminder.fireAt
    }

    func disarm() {
        if scheduled?.state == .scheduled { scheduled?.invalidate() }
        scheduled = nil
        scheduledSeries = nil
        scheduledAt = nil
    }

    /// Ends the repeating haptic once the child taps Start, Done or Snooze.
    func stop() {
        ringing.set(false)
        running?.invalidate()
        running = nil
    }

    /// From `WKApplicationDelegate.handle(_:)` when watchOS relaunches the app
    /// for a scheduled session.
    func handle(_ session: WKExtendedRuntimeSession) {
        session.delegate = self
        ring(session)
    }

    private func ring(_ session: WKExtendedRuntimeSession) {
        guard running !== session else { return }
        if scheduled === session { scheduled = nil; scheduledSeries = nil; scheduledAt = nil }
        // Allow a minute of early start; nothing ringing means a stale schedule.
        guard let alarm = WatchReminderPlan.dueAlarm(snapshot: WatchStore.shared.snapshot,
                                                     ledger: WatchAlarmLedgerStore.load(),
                                                     now: Date().addingTimeInterval(60)) else {
            session.invalidate()
            return
        }
        running = session
        ringing.set(true)
        WatchAlarmCenter.shared.presentation = .alarm(alarm)
        let flag = ringing
        let interval = Self.hapticInterval
        // Returning 0 stops the repeats once the child has responded.
        session.notifyUser(hapticType: .notification) { next in
            guard flag.value else { return 0 }
            next.pointee = flag.toggleStrong() ? .retry : .notification
            return interval
        }
    }

    nonisolated func extendedRuntimeSessionDidStart(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        Task { @MainActor in self.ring(extendedRuntimeSession) }
    }

    nonisolated func extendedRuntimeSessionWillExpire(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        Task { @MainActor in
            if self.running === extendedRuntimeSession { self.stop() }
        }
    }

    nonisolated func extendedRuntimeSession(_ extendedRuntimeSession: WKExtendedRuntimeSession,
                                            didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason,
                                            error: Error?) {
        Task { @MainActor in
            if self.running === extendedRuntimeSession { self.running = nil; self.ringing.set(false) }
            if self.scheduled === extendedRuntimeSession { self.scheduled = nil; self.scheduledSeries = nil; self.scheduledAt = nil }
        }
    }
}

extension FamETCWatchExtensionDelegate {
    /// watchOS launches the app for the scheduled smart alarm.
    @objc(handleExtendedRuntimeSession:)
    func handle(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        Task { @MainActor in WatchAlarmSession.shared.handle(extendedRuntimeSession) }
    }
}

/// Lock-protected flag shared with the smart alarm's repeat handler.
final class WatchAlarmFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var on = false
    private var strong = false

    var value: Bool { lock.lock(); defer { lock.unlock() }; return on }

    func set(_ newValue: Bool) { lock.lock(); on = newValue; lock.unlock() }

    /// Alternates the haptic so the repeat feels like a strong double buzz.
    func toggleStrong() -> Bool { lock.lock(); defer { lock.unlock() }; strong.toggle(); return strong }
}
