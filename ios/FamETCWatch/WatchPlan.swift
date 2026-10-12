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
    // Cached: formatter allocation dominated SwiftUI renders (sort comparators call these per comparison).
    private static let dayTime: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.isLenient = false
        return f
    }()
    private static let plainISO = ISO8601DateFormatter()
    private static let fractionalISO: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions.insert(.withFractionalSeconds)
        return f
    }()
    // Parsing costs ~60µs and the same few hundred strings recur every render, so memoize (nil results too).
    private static let lock = NSLock()
    private static var memo: [String: Date?] = [:]
    private static func cached(_ key: String, _ parse: () -> Date?) -> Date? {
        lock.lock(); defer { lock.unlock() }
        if let hit = memo[key] { return hit }
        let value = parse()
        if memo.count > 4096 { memo.removeAll() }
        memo[key] = .some(value)
        return value
    }
    static func date(_ day: String?, _ time: String?) -> Date? {
        guard let day else { return nil }
        let text = "\(day) \(time ?? "17:00")"
        // Wall-clock times depend on the zone; key by it so travel can't serve stale dates.
        let zone = TimeZone.current
        return cached(zone.identifier + text) {
            dayTime.timeZone = zone
            return dayTime.date(from: text)
        }
    }
    static func iso(_ value: String?) -> Date? {
        guard let value else { return nil }
        return cached("i" + value) { plainISO.date(from: value) ?? fractionalISO.date(from: value) }
    }
}

extension WatchEvent {
    var startsAt: Date? {
        WatchPlanDate.iso(start) ?? WatchPlanDate.date(date, allDay ? "09:00" : time)
    }
    var endsAt: Date { endsAt(start: startsAt) }
    /// Same as `endsAt`, reusing an already-parsed start so hot paths parse it once.
    func endsAt(start: Date?) -> Date {
        if let end = WatchPlanDate.iso(end) ?? endTime.flatMap({ WatchPlanDate.date(date, $0) }) { return end }
        // ponytail: feeds without an end remain current for one hour; use an
        // explicit feed end as soon as the upstream source provides one.
        return (start ?? .distantPast).addingTimeInterval(allDay ? 15 * 3600 : 3600)
    }
}

extension WatchSnapshot {
    var isParent: Bool { context?.profile.role == "parent" }
    func dayEvents(at now: Date = Date()) -> [WatchEvent] {
        let calendar = Calendar.current
        return (context?.events ?? []).compactMap { e -> (WatchEvent, Date)? in
            guard let d = e.startsAt, calendar.isDate(d, inSameDayAs: now) else { return nil }
            return (e, d)
        }.sorted { $0.1 < $1.1 }.map(\.0)
    }
    func moments(at now: Date = Date()) -> [WatchMoment] {
        let open = openHomework
        let openIDs = Set(open.map(\.id))
        let soon = now.addingTimeInterval(15 * 60)
        typealias Row = (moment: WatchMoment, at: Date?, rank: Int, id: String)
        // Decorate once: parsing dates inside the sort comparator is what made scrolling hang.
        func row(_ m: WatchMoment, _ at: Date?) -> Row {
            (m, at, { if case .event = m, let at, at <= soon { return 0 } else { return 1 } }(), m.id)
        }
        var rows = open.map { row(.homework($0), WatchMoment.homework($0).scheduledAt) }
        rows += urgentActions.filter { a in
            !(a.sourceType == "homework" && a.sourceId.map(openIDs.contains) == true)
        }.map { row(.action($0), WatchMoment.action($0).scheduledAt) }
        for e in context?.events ?? [] where !e.allDay {
            let start = e.startsAt
            if e.endsAt(start: start) > now { rows.append(row(.event(e), start)) }
        }
        return rows.sorted {
            if $0.rank != $1.rank { return $0.rank < $1.rank }
            if $0.at != $1.at { return ($0.at ?? .distantFuture) < ($1.at ?? .distantFuture) }
            return $0.id < $1.id
        }.map(\.moment)
    }
}
