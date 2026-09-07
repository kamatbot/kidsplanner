import Foundation

/// One ranking for the glance and reminders. A lesson happening now or in the
/// next 15 minutes wins; otherwise deadline order wins, without duplicate work.
enum WatchMoment: Identifiable, Equatable {
    case event(WatchEvent)
    case homework(WatchHomework)
    case action(WatchAction)

    var id: String {
        switch self {
        case .event(let v): return "event:\(v.id)"
        case .homework(let v): return "homework:\(v.id)"
        case .action(let v): return "action:\(v.id)"
        }
    }
    var title: String {
        switch self {
        case .event(let v): return v.title
        case .homework(let v): return v.title
        case .action(let v): return v.title
        }
    }
    var detail: String {
        switch self {
        case .event(let v): return v.location ?? (v.isTimetable ? "Your next lesson" : "On your calendar")
        case .homework(let v): return v.firstIncompleteStep?.text ?? v.subject ?? "One step at a time"
        case .action(let v): return v.notes ?? "One small thing to do"
        }
    }
    var scheduledAt: Date? {
        switch self {
        case .event(let v): return v.startsAt
        case .homework(let v): return WatchPlanDate.date(v.dueDate, v.dueTime ?? "17:00")
        case .action(let v): return WatchPlanDate.date(v.dueDate, v.dueTime ?? "17:00")
        }
    }
    var symbol: String {
        switch self {
        case .event(let v): return v.isTimetable ? "backpack.fill" : "calendar"
        case .homework: return "pencil.and.outline"
        case .action: return "checkmark.circle"
        }
    }
    func isHappening(at now: Date) -> Bool {
        guard case .event(let e) = self, !e.allDay, let start = e.startsAt else { return false }
        return start <= now && e.endsAt > now
    }
    func caption(at now: Date) -> String {
        guard let date = scheduledAt else { return "Whenever you're ready" }
        if isHappening(at: now) { return "Happening now" }
        if case .event = self {
            return date.formatted(date: Calendar.current.isDateInToday(date) ? .omitted : .abbreviated, time: .shortened)
        }
        if date < now { return "Needs attention" }
        if Calendar.current.isDate(date, inSameDayAs: now) { return "Due today" }
        return "Due \(date.formatted(date: .abbreviated, time: .omitted))"
    }
}

enum WatchPlanDate {
    static func date(_ day: String?, _ time: String?) -> Date? {
        guard let day else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        formatter.isLenient = false
        return formatter.date(from: "\(day) \(time ?? "17:00")")
    }
    static func iso(_ value: String?) -> Date? {
        guard let value else { return nil }
        let f = ISO8601DateFormatter()
        if let date = f.date(from: value) { return date }
        f.formatOptions.insert(.withFractionalSeconds)
        return f.date(from: value)
    }
}

extension WatchEvent {
    var startsAt: Date? {
        WatchPlanDate.iso(start) ?? WatchPlanDate.date(date, allDay ? "09:00" : time)
    }
    var endsAt: Date {
        if let end = WatchPlanDate.iso(end) ?? endTime.flatMap({ WatchPlanDate.date(date, $0) }) { return end }
        // ponytail: feeds without an end remain current for one hour; use an
        // explicit feed end as soon as the upstream source provides one.
        return (startsAt ?? .distantPast).addingTimeInterval(allDay ? 15 * 3600 : 3600)
    }
}

extension WatchSnapshot {
    var isParent: Bool { context?.profile.role == "parent" }
    func dayEvents(at now: Date = Date()) -> [WatchEvent] {
        (context?.events ?? []).filter { e in
            guard let d = e.startsAt else { return false }
            return Calendar.current.isDate(d, inSameDayAs: now)
        }.sorted { ($0.startsAt ?? .distantFuture) < ($1.startsAt ?? .distantFuture) }
    }
    func moments(at now: Date = Date()) -> [WatchMoment] {
        let work = openHomework.map(WatchMoment.homework)
        let actionMoments = urgentActions.filter { a in
            !(a.sourceType == "homework" && openHomework.contains { $0.id == a.sourceId })
        }.map(WatchMoment.action)
        let upcoming = (context?.events ?? []).filter { !$0.allDay && $0.endsAt > now }.map(WatchMoment.event)
        func rank(_ moment: WatchMoment) -> Int {
            if case .event = moment, let date = moment.scheduledAt, date <= now.addingTimeInterval(15 * 60) { return 0 }
            return 1
        }
        return (work + actionMoments + upcoming).sorted {
            if rank($0) != rank($1) { return rank($0) < rank($1) }
            if $0.scheduledAt != $1.scheduledAt { return ($0.scheduledAt ?? .distantFuture) < ($1.scheduledAt ?? .distantFuture) }
            return $0.id < $1.id
        }
    }
}
