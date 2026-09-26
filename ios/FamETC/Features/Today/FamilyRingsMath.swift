import Foundation

/// Value-only ports of the web Family Rings counts in public/js/app.js.
enum FamilyRingsMath {
    struct Progress: Equatable {
        let done: Int
        let total: Int
    }
    struct HomeworkProgress: Equatable {
        let done: Int
        let total: Int
        var left: Int { total - done }
        let overdue: Int
        let dueToday: Int
    }
    struct ActionProgress: Equatable {
        let open: Int
        let cleared: Int
        let dueNow: Int
        var total: Int { cleared + dueNow }
    }

    /// todayKidProgress: Gregorian Monday–Sunday, independent of firstWeekday/locale.
    static func weekBounds(today: String) -> (start: String, end: String) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: today) else { return (today, today) }
        let offset = (calendar.component(.weekday, from: date) + 5) % 7
        let monday = calendar.date(byAdding: .day, value: -offset, to: date)!
        let sunday = calendar.date(byAdding: .day, value: 6, to: monday)!
        return (formatter.string(from: monday), formatter.string(from: sunday))
    }

    /// todayKidProgress: unfinished overdue work carries into this week.
    static func homework(kidID: String, items: [HomeworkItem], today: String) -> HomeworkProgress {
        let bounds = weekBounds(today: today)
        let own = items.filter { $0.kidId == kidID && !$0.dueDate.isEmpty }
        let week = own.filter {
            ($0.dueDate >= bounds.start && $0.dueDate <= bounds.end) || ($0.dueDate < bounds.start && !$0.isDone)
        }
        return HomeworkProgress(done: week.filter(\.isDone).count, total: week.count,
                                overdue: own.filter { !$0.isDone && $0.dueDate < today }.count,
                                dueToday: own.filter { !$0.isDone && $0.dueDate == today }.count)
    }

    /// todayKidProgress: missing/null checks mean no check-ins, never unavailable.
    static func habits(kidID: String, goals: [Goal], today: String) -> Progress {
        let own = goals.filter { $0.kidId == kidID && $0.type == "habit" }
        return Progress(done: own.filter { $0.checks?.contains(today) == true }.count, total: own.count)
    }

    /// goalCurrentStreak/currentStreak: consecutive local date keys ending today.
    static func habitStreak(goal: Goal, today: String) -> Int {
        guard goal.type == "habit" else { return 0 }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        guard var date = formatter.date(from: today) else { return 0 }
        let checks = Set(goal.checks ?? [])
        var count = 0
        while checks.contains(formatter.string(from: date)) {
            count += 1
            guard let previous = calendar.date(byAdding: .day, value: -1, to: date) else { break }
            date = previous
        }
        return count
    }

    /// todayKidFacts, in priority order.
    static func statusChip(homework: HomeworkProgress) -> String {
        if homework.overdue > 0 { return "\(homework.overdue) overdue" }
        if homework.dueToday > 0 { return "\(homework.dueToday) due today" }
        return "Nothing due today"
    }

    /// renderTodayActionQueue. Caller MUST prefilter with canViewAction for
    /// parents, and canViewAction + canManageOwnKidAction for kids.
    static func parentRing(viewerItems: [FamilyAction], now: Date = Date()) -> ActionProgress {
        let open = viewerItems.filter { !$0.isDone && ActionQueue.effectiveDue($0, now: now)?.isSnoozed != true }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        let cleared = viewerItems.filter { action in
            guard action.isDone, let stamp = action.completedAt,
                  let date = fractional.date(from: stamp) ?? standard.date(from: stamp) else { return false }
            return Calendar.current.isDate(date, inSameDayAs: now)
        }.count
        return ActionProgress(open: open.count, cleared: cleared,
                              dueNow: open.filter { ActionQueue.isDueNow($0, now: now) }.count)
    }

    /// Daily 4 preserves its legacy method name and counts one challenge when
    /// either the puzzle or brain teaser is complete.
    static func daily3(_ payload: DailyFiveProgressPayload?, today: String = DateFmt.ymd.string(from: Date())) -> Progress? {
        guard let payload, payload.date == today else { return nil }
        let core = ["news", "quote", "word"].filter { payload.parts[$0]?.status == "completed" }.count
        let challenge = ["puzzle", "bt"].contains { payload.parts[$0]?.status == "completed" } ? 1 : 0
        return Progress(done: core + challenge, total: 4)
    }
}
