import Foundation

/// The effective date used by the web action queue. A future snooze reminder
/// takes precedence over the stored due date; an expired date-less snooze is
/// actionable today again.
struct ActionDue: Equatable {
    let dateKey: String
    let timeKey: String?
    let isSnoozed: Bool
}

/// The three snooze presets exposed by the web action queue. They remain
/// client-side conveniences; the server stores only the resulting timestamp.
enum ActionSnoozePreset: String, CaseIterable, Identifiable {
    case laterToday = "later-today"
    case tomorrow
    case nextWeek = "next-week"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .laterToday: return "Later today"
        case .tomorrow: return "Tomorrow"
        case .nextWeek: return "Next week"
        }
    }
}

/// Pure ordering helpers for the native Today / My next card. The buckets match
/// `public/js/action-queue.js`: overdue/today first, future dated actions next
/// (including the web queue's later-dated tail), then undated shared actions.
enum ActionQueue {
    private static let isoWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let isoWithoutFractionalSeconds = ISO8601DateFormatter()
    private static let isoForSnooze: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// Produces the same explicit-timezone timestamps as the web presets.
    /// Keeping this pure makes the native mutation easy to test without a
    /// server or a wall-clock race.
    static func snoozeUntil(_ preset: ActionSnoozePreset, now: Date = Date()) -> String {
        var calendar = Calendar.current
        calendar.timeZone = .autoupdatingCurrent
        let target: Date

        switch preset {
        case .laterToday:
            let currentHour = calendar.component(.hour, from: now)
            var later = calendar.date(byAdding: .hour, value: currentHour + 2, to: calendar.startOfDay(for: now)) ?? now
            later = calendar.date(bySetting: .minute, value: 0, of: later) ?? later
            later = calendar.date(bySetting: .second, value: 0, of: later) ?? later
            if calendar.startOfDay(for: later) != calendar.startOfDay(for: now) {
                later = calendar.date(bySettingHour: 23, minute: 59, second: 0, of: now) ?? later
            }
            target = later > now
                ? later
                : (calendar.date(byAdding: .minute, value: 30, to: now) ?? now)
        case .tomorrow:
            let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
            target = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
        case .nextWeek:
            let nextWeek = calendar.date(byAdding: .day, value: 7, to: now) ?? now
            target = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: nextWeek) ?? nextWeek
        }

        return isoForSnooze.string(from: target)
    }

    static func effectiveDue(_ action: FamilyAction, now: Date = Date()) -> ActionDue? {
        if action.status == "snoozed",
           let snoozedUntil = action.snoozedUntil,
           let snoozedDate = parseISO(snoozedUntil),
           snoozedDate > now {
            return ActionDue(dateKey: DateFmt.ymd.string(from: snoozedDate),
                             timeKey: timeKey(snoozedDate),
                             isSnoozed: true)
        }

        if let dueDate = action.dueDate, !dueDate.isEmpty {
            return ActionDue(dateKey: dueDate,
                             timeKey: action.dueTime?.isEmpty == false ? action.dueTime : nil,
                             isSnoozed: false)
        }

        // A date-less snooze becomes actionable again when its reminder time
        // has passed, matching the web queue's effectiveDue fallback.
        if action.status == "snoozed", let snoozedUntil = action.snoozedUntil,
           parseISO(snoozedUntil) != nil {
            return ActionDue(dateKey: DateFmt.ymd.string(from: now),
                             timeKey: nil,
                             isSnoozed: false)
        }

        return nil
    }

    /// Returns the first three active actions in the same shelf/order used by
    /// the web Today queue. Completed actions never enter this result.
    static func topActive(_ actions: [FamilyAction], now: Date = Date()) -> [FamilyAction] {
        sortActive(actions, now: now).prefix(3).map { $0 }
    }

    static func sortActive(_ actions: [FamilyAction], now: Date = Date()) -> [FamilyAction] {
        actions
            .filter { $0.status != "done" }
            .sorted { lhs, rhs in
                let lhsBucket = bucket(for: lhs, now: now)
                let rhsBucket = bucket(for: rhs, now: now)
                if lhsBucket != rhsBucket { return lhsBucket < rhsBucket }

                let lhsDue = effectiveDue(lhs, now: now)
                let rhsDue = effectiveDue(rhs, now: now)
                let lhsDueKey = dueSortKey(lhsDue)
                let rhsDueKey = dueSortKey(rhsDue)
                if lhsDueKey != rhsDueKey { return lhsDueKey < rhsDueKey }

                let lhsCreated = lhs.createdAt
                let rhsCreated = rhs.createdAt
                if lhsCreated != rhsCreated { return lhsCreated < rhsCreated }
                return lhs.id < rhs.id
            }
    }

    static func dueLabel(for action: FamilyAction, now: Date = Date()) -> String {
        guard let due = effectiveDue(action, now: now) else { return "No date" }

        let today = DateFmt.ymd.string(from: now)
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now)
            .map(DateFmt.ymd.string(from:))
        let day: String
        if due.dateKey < today {
            day = "Overdue"
        } else if due.dateKey == today {
            day = "Today"
        } else if due.dateKey == tomorrow {
            day = "Tomorrow"
        } else if let date = DateFmt.ymd.date(from: due.dateKey) {
            day = DateFmt.monthDay.string(from: date)
        } else {
            day = due.dateKey
        }

        let withTime: String
        if let time = due.timeKey, !time.isEmpty {
            withTime = String(format: "%@ · %@", day, displayTime(time))
        } else {
            withTime = day
        }
        return due.isSnoozed ? String(format: "Snoozed until %@", withTime) : withTime
    }

    private static func bucket(for action: FamilyAction, now: Date) -> Int {
        guard let due = effectiveDue(action, now: now) else { return 2 }
        let today = DateFmt.ymd.string(from: now)
        // The web renders both its next-7 and later dated shelves before the
        // shared/no-date shelf, so all future dated actions share bucket 1.
        return due.dateKey <= today ? 0 : 1
    }

    private static func dueSortKey(_ due: ActionDue?) -> String {
        guard let due else { return "9999-12-31 99:99" }
        return String(format: "%@ %@", due.dateKey, due.timeKey ?? "99:99")
    }

    private static func parseISO(_ value: String) -> Date? {
        isoWithFractionalSeconds.date(from: value) ?? isoWithoutFractionalSeconds.date(from: value)
    }

    private static func timeKey(_ date: Date) -> String {
        let calendar = Calendar.current
        return String(format: "%02d:%02d", calendar.component(.hour, from: date), calendar.component(.minute, from: date))
    }

    private static func displayTime(_ value: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        guard let date = formatter.date(from: value) else { return value }
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
}
