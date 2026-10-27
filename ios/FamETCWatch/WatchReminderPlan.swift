import Foundation

enum WatchReminderKind: String, Codable {
    case event, homework, chore, focus, support

    /// Homework and chores buzz hard: time-sensitive, re-alerted until
    /// acknowledged, and shown as the full-screen alarm.
    var isStrong: Bool { self == .homework || self == .chore }
}

struct WatchReminder: Equatable {
    static let prefix = "fam_watch_"
    static let followUpInterval: TimeInterval = 2 * 60
    static let maxFollowUps = 5

    /// The notification request identifier.
    let id: String
    let title: String
    let body: String
    let fireAt: Date
    var kind: WatchReminderKind = .event
    /// Shared by a reminder and its follow-ups (equals `id` for the first buzz).
    var seriesID: String = ""
    var homeworkID: String? = nil
    var actionID: String? = nil
    /// The planned, un-snoozed time. Ledger entries are keyed by it, so a moved
    /// deadline is a new occurrence with fresh snoozes.
    var dueAt: Date? = nil
    /// 0 for the first buzz, 1...5 for the re-alerts.
    var followUp: Int = 0
    /// How many times this reminder has buzzed, counting snoozed rounds.
    var buzz: Int = 1
    var snoozesLeft: Int = 0

    var occurrence: Date { dueAt ?? fireAt }
}

/// One reminder-worthy item before follow-ups and snoozes are applied.
struct WatchReminderSeries: Equatable {
    let id: String
    let kind: WatchReminderKind
    var homeworkID: String? = nil
    var actionID: String? = nil
    let title: String
    let body: String
    let dueAt: Date
}

/// Local, per-watch acknowledgement and snooze record for strong reminders.
/// It never leaves the watch and never notifies a parent.
struct WatchAlarmLedger: Codable, Equatable {
    static let maxSnoozes = 2
    static let snoozeInterval: TimeInterval = 5 * 60

    struct Entry: Codable, Equatable {
        var dueAt: Date
        var acknowledged: Bool
        var snoozeCount: Int
        var snoozedUntil: Date?
    }

    var entries: [String: Entry] = [:]

    func entry(_ seriesID: String, dueAt: Date) -> Entry? {
        guard let entry = entries[seriesID], abs(entry.dueAt.timeIntervalSince(dueAt)) < 1 else { return nil }
        return entry
    }

    func snoozesLeft(_ seriesID: String, dueAt: Date) -> Int {
        max(0, Self.maxSnoozes - (entry(seriesID, dueAt: dueAt)?.snoozeCount ?? 0))
    }

    mutating func acknowledge(_ seriesID: String, dueAt: Date) {
        var value = entry(seriesID, dueAt: dueAt) ?? Entry(dueAt: dueAt, acknowledged: false, snoozeCount: 0, snoozedUntil: nil)
        value.acknowledged = true
        entries[seriesID] = value
    }

    /// Returns false once the two snoozes for this occurrence are used.
    @discardableResult
    mutating func snooze(_ seriesID: String, dueAt: Date, now: Date) -> Bool {
        var value = entry(seriesID, dueAt: dueAt) ?? Entry(dueAt: dueAt, acknowledged: false, snoozeCount: 0, snoozedUntil: nil)
        guard !value.acknowledged, value.snoozeCount < Self.maxSnoozes else { return false }
        value.snoozeCount += 1
        value.snoozedUntil = now.addingTimeInterval(Self.snoozeInterval)
        entries[seriesID] = value
        return true
    }

    mutating func prune(now: Date) {
        entries = entries.filter { now.timeIntervalSince($0.value.dueAt) < 2 * 24 * 3600 }
    }
}

enum WatchAlarmLedgerStore {
    static let key = "fam_watch_alarm_ledger"

    static func load(defaults: UserDefaults = .standard) -> WatchAlarmLedger {
        guard let data = defaults.data(forKey: key),
              let ledger = try? JSONDecoder().decode(WatchAlarmLedger.self, from: data) else { return WatchAlarmLedger() }
        return ledger
    }

    static func save(_ ledger: WatchAlarmLedger, defaults: UserDefaults = .standard) {
        var pruned = ledger
        pruned.prune(now: Date())
        guard let data = try? JSONEncoder().encode(pruned) else { return }
        defaults.set(data, forKey: key)
    }

    static func clear(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key)
    }
}

enum WatchReminderPlan {
    /// watchOS keeps at most this many pending local requests for the app.
    static let budget = 24
    /// A strong reminder still counts as ringing until its last re-alert passes.
    static let alarmWindow: TimeInterval = WatchReminder.followUpInterval * Double(WatchReminder.maxFollowUps) + 2 * 60

    static func make(snapshot: WatchSnapshot,
                     focus: WatchFocusSession?,
                     now: Date = Date(),
                     calendar: Calendar = .current,
                     ledger: WatchAlarmLedger = WatchAlarmLedger()) -> [WatchReminder] {
        let horizon = now.addingTimeInterval(48 * 3600)
        func daytime(_ date: Date) -> Bool { (7..<21).contains(calendar.component(.hour, from: date)) }
        var reminders: [WatchReminder] = []
        for item in series(snapshot: snapshot, now: now) {
            if item.kind.isStrong {
                let entry = ledger.entry(item.id, dueAt: item.dueAt)
                if entry?.acknowledged == true { continue }
                let base = entry?.snoozedUntil ?? item.dueAt
                // Quiet hours omit a reminder; they never postpone it to morning.
                guard daytime(base) else { continue }
                let snoozes = entry?.snoozeCount ?? 0
                for step in 0...WatchReminder.maxFollowUps {
                    let fire = base.addingTimeInterval(Double(step) * WatchReminder.followUpInterval)
                    guard fire > now, fire <= horizon, daytime(fire) else { continue }
                    reminders.append(WatchReminder(
                        id: step == 0 ? item.id : item.id + "_f\(step)",
                        title: item.title,
                        body: step == 0 ? item.body : (item.kind == .homework ? "Still waiting. Tap Start when you begin." : "Still waiting. Tap Done when it's finished."),
                        fireAt: fire, kind: item.kind, seriesID: item.id,
                        homeworkID: item.homeworkID, actionID: item.actionID, dueAt: item.dueAt,
                        followUp: step, buzz: step + 1 + snoozes,
                        snoozesLeft: max(0, WatchAlarmLedger.maxSnoozes - snoozes)))
                }
            } else {
                guard item.dueAt > now, item.dueAt <= horizon, daytime(item.dueAt) else { continue }
                reminders.append(WatchReminder(id: item.id, title: item.title, body: item.body, fireAt: item.dueAt,
                                               kind: item.kind, seriesID: item.id, dueAt: item.dueAt))
            }
        }
        if let profile = gatedProfile(snapshot, now: now) {
            let supportOwnsHomework = snapshot.support?.belongs(to: profile) == true && snapshot.support?.enabled == true
            if supportOwnsHomework, snapshot.supportRemindersEnabled == true, let support = snapshot.support {
                reminders.append(contentsOf: supportCues(support, hasHomework: !snapshot.openHomework.isEmpty, now: now, horizon: horizon))
            }
        }
        // Follow-ups count against the budget; the soonest requests win.
        reminders.sort { $0.fireAt == $1.fireAt ? $0.id < $1.id : $0.fireAt < $1.fireAt }
        var seen = Set<String>()
        reminders = reminders.filter { seen.insert($0.id).inserted }
        let completion = focus.flatMap { session -> WatchReminder? in
            guard session.pausedAt == nil, !session.completionAcknowledged, session.endsAt > now, session.endsAt <= horizon else { return nil }
            let id = WatchReminder.prefix + "focus_" + session.id.uuidString
            return WatchReminder(id: id, title: session.titleSnapshot, body: "Focus finished. Take a break or check off your step.",
                                 fireAt: session.endsAt, kind: .focus, seriesID: id, dueAt: session.endsAt)
        }
        // Reserve a slot for the explicitly started focus session.
        reminders = Array(reminders.prefix(completion == nil ? budget : budget - 1))
        if let completion { reminders.append(completion) }
        return reminders.sorted { $0.fireAt == $1.fireAt ? $0.id < $1.id : $0.fireAt < $1.fireAt }
    }

    /// The strong reminder that should be on screen now: its first buzz has
    /// passed, its re-alerts have not run out, and nobody acknowledged it.
    /// The earliest one wins so reminders are handled one at a time.
    static func dueAlarm(snapshot: WatchSnapshot,
                         ledger: WatchAlarmLedger,
                         now: Date = Date(),
                         calendar: Calendar = .current) -> WatchReminder? {
        series(snapshot: snapshot, now: now)
            .compactMap { alarm(for: $0, ledger: ledger, now: now, calendar: calendar, requireWindow: true) }
            .min { $0.fireAt == $1.fireAt ? $0.seriesID < $1.seriesID : $0.fireAt < $1.fireAt }
    }

    /// The live alarm for a tapped notification, or nil when the item is done,
    /// acknowledged, or no longer visible to this profile.
    static func alarm(seriesID: String,
                      snapshot: WatchSnapshot,
                      ledger: WatchAlarmLedger,
                      now: Date = Date(),
                      calendar: Calendar = .current) -> WatchReminder? {
        guard let item = series(snapshot: snapshot, now: now).first(where: { $0.id == seriesID }) else { return nil }
        return alarm(for: item, ledger: ledger, now: now, calendar: calendar, requireWindow: false)
    }

    private static func alarm(for item: WatchReminderSeries, ledger: WatchAlarmLedger, now: Date,
                              calendar: Calendar, requireWindow: Bool) -> WatchReminder? {
        guard item.kind.isStrong else { return nil }
        let entry = ledger.entry(item.id, dueAt: item.dueAt)
        guard entry?.acknowledged != true else { return nil }
        let base = entry?.snoozedUntil ?? item.dueAt
        if requireWindow {
            guard base <= now, now.timeIntervalSince(base) < alarmWindow,
                  (7..<21).contains(calendar.component(.hour, from: base)) else { return nil }
        }
        let elapsed = max(0, now.timeIntervalSince(base))
        let step = min(WatchReminder.maxFollowUps, Int(elapsed / WatchReminder.followUpInterval))
        let snoozes = entry?.snoozeCount ?? 0
        return WatchReminder(id: item.id, title: item.title, body: item.body, fireAt: base, kind: item.kind,
                             seriesID: item.id, homeworkID: item.homeworkID, actionID: item.actionID,
                             dueAt: item.dueAt, followUp: step, buzz: step + 1 + snoozes,
                             snoozesLeft: max(0, WatchAlarmLedger.maxSnoozes - snoozes))
    }

    /// Ordinary plans require a valid role-scoped profile and a snapshot
    /// refreshed less than 48 hours ago.
    private static func gatedProfile(_ snapshot: WatchSnapshot, now: Date) -> WatchProfile? {
        guard let profile = snapshot.context?.profile,
              profile.role == "parent" || (profile.role == "kid" && !(profile.kidId ?? "").isEmpty),
              let updated = snapshot.updatedAt, updated <= now, now.timeIntervalSince(updated) < 48 * 3600 else { return nil }
        return profile
    }

    /// Every event/homework/action reminder, deduplicated, before time
    /// filtering. Strong items look back one hour so re-alerts and snoozes of
    /// a reminder that already fired survive a re-plan.
    static func series(snapshot: WatchSnapshot, now: Date) -> [WatchReminderSeries] {
        guard let profile = gatedProfile(snapshot, now: now) else { return [] }
        let lookback = now.addingTimeInterval(-3600)
        var result: [WatchReminderSeries] = []
        func visible(_ kidID: String?) -> Bool {
            profile.role == "parent" || kidID == nil || kidID == profile.kidId
        }
        func add(_ item: WatchReminderSeries?) {
            guard let item, item.dueAt > lookback else { return }
            result.append(item)
        }
        for event in snapshot.context?.events ?? [] where visible(event.kidId) && !event.allDay {
            add(event.startsAt.map { WatchReminderSeries(id: WatchReminder.prefix + "event_" + event.id, kind: .event,
                                                         title: event.title, body: "Starts in 10 minutes",
                                                         dueAt: $0.addingTimeInterval(-600)) })
        }
        let supportOwnsHomework = snapshot.support?.belongs(to: profile) == true && snapshot.support?.enabled == true
        for work in snapshot.homework where !supportOwnsHomework && visible(work.kidId) && !work.isDone && work.status != "snoozed" {
            add(WatchPlanDate.date(work.dueDate, work.dueTime ?? "17:00").map {
                WatchReminderSeries(id: WatchReminder.prefix + "homework_" + work.id, kind: .homework, homeworkID: work.id,
                                    title: work.title, body: work.dueTime == nil ? "Due today. Take one small step." : "Homework is due now",
                                    dueAt: $0)
            })
        }
        for action in snapshot.actions where visible(action.kidId) && !action.isDone && action.status != "snoozed" {
            if profile.role == "kid", action.assigneeType == "kid", action.assigneeId != profile.kidId { continue }
            if supportOwnsHomework && action.sourceType == "homework" { continue }
            // A retained homework record owns its reminder, including its completed state.
            if action.sourceType == "homework", snapshot.homework.contains(where: { $0.id == action.sourceId }) { continue }
            let sourceID = action.sourceType == "homework" ? action.sourceId.map { "homework_" + $0 } : nil
            add(WatchPlanDate.date(action.dueDate, action.dueTime ?? "17:00").map {
                WatchReminderSeries(id: WatchReminder.prefix + (sourceID ?? ("action_" + action.id)),
                                    kind: action.sourceType == "homework" ? .homework : .chore, actionID: action.id,
                                    title: action.title, body: action.dueTime == nil ? "Due today. Ready to tick it off?" : "Due now",
                                    dueAt: $0)
            })
        }
        result.sort { $0.dueAt == $1.dueAt ? $0.id < $1.id : $0.dueAt < $1.dueAt }
        var seen = Set<String>()
        return result.filter { seen.insert($0.id).inserted }
    }

    private static let fractionalISO: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static func supportCues(_ support: WatchStudentSupport, hasHomework: Bool, now: Date, horizon: Date) -> [WatchReminder] {
        guard let updated = fractionalISO.date(from: support.refreshedAt) ?? WatchPlanDate.iso(support.refreshedAt),
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
            let identifier = WatchReminder.prefix + "support_" + id
            result.append(WatchReminder(id: identifier,
                title: "My Next", body: "Ready for one small step? Open your plan.", fireAt: moment,
                kind: .support, seriesID: identifier, dueAt: moment))
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
               let date = fractionalISO.date(from: snoozed) ?? WatchPlanDate.iso(snoozed) {
                let value = formatter.string(from: date).split(separator: " ")
                if value.count == 2 { add("routine", String(value[0]), String(value[1])) }
            } else { add("routine", routine.date, routine.time) }
        }
        return result
    }
}
