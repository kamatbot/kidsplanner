import Foundation

/// One row of the kid's "My list": today's homework (orange), timed family
/// actions (teal chores) and Fams chores (teal, with a gold Fams chip).
struct WatchMyListItem: Identifiable, Equatable {
    enum Kind: String { case homework, chore, fams }
    enum Source: Equatable {
        case homework(WatchHomework)
        case action(WatchAction)
        case fams(WatchChore)
    }

    let source: Source
    let kind: Kind
    let title: String
    let isDone: Bool
    let dueAt: Date?
    let famsAmount: Int?
    /// A submitted Fams chore waiting for a parent's OK.
    let awaitingApproval: Bool

    var id: String {
        switch source {
        case .homework(let v): return "homework:\(v.id)"
        case .action(let v): return "action:\(v.id)"
        case .fams(let v): return "fams:\(v.id)"
        }
    }

    /// Complications use only this category, never the title.
    var complicationKind: String { kind == .homework ? "homework" : "chore" }
}

/// Screen 9 "Done" content after an item is completed.
struct WatchDoneSummary: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let done: Int
    let total: Int
    let famsAmount: Int?
    let next: String?
    /// No parent names reach the watch, so this stays generic.
    var approver: String = "a parent"

    static func == (lhs: WatchDoneSummary, rhs: WatchDoneSummary) -> Bool {
        lhs.title == rhs.title && lhs.done == rhs.done && lhs.total == rhs.total
            && lhs.famsAmount == rhs.famsAmount && lhs.next == rhs.next && lhs.approver == rhs.approver
    }
}

enum WatchMyList {
    static func dayString(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    private static func isToday(_ iso: String?, today: String, calendar: Calendar) -> Bool {
        guard let date = WatchPlanDate.iso(iso) else { return false }
        return dayString(date, calendar: calendar) == today
    }

    static func item(for work: WatchHomework, now: Date) -> WatchMyListItem {
        WatchMyListItem(source: .homework(work), kind: .homework, title: work.title, isDone: work.isDone,
                        dueAt: WatchPlanDate.date(work.dueDate, work.dueTime ?? "17:00"), famsAmount: nil, awaitingApproval: false)
    }

    static func item(for action: WatchAction, now: Date) -> WatchMyListItem {
        WatchMyListItem(source: .action(action), kind: action.sourceType == "homework" ? .homework : .chore,
                        title: action.title, isDone: action.isDone,
                        dueAt: action.dueDate.flatMap { WatchPlanDate.date($0, action.dueTime ?? "17:00") },
                        famsAmount: nil, awaitingApproval: false)
    }

    static func item(for chore: WatchChore) -> WatchMyListItem {
        WatchMyListItem(source: .fams(chore), kind: .fams, title: chore.title, isDone: !chore.isOpen,
                        dueAt: nil, famsAmount: chore.amount > 0 ? chore.amount : nil,
                        awaitingApproval: chore.status == "submitted")
    }

    /// Today's list: open homework due today or earlier, open actions due
    /// today/earlier or undated, pending Fams chores, plus items finished
    /// today (struck through). Open items first, each group by due time.
    static func items(snapshot: WatchSnapshot, now: Date = Date(), calendar: Calendar = .current) -> [WatchMyListItem] {
        let today = dayString(now, calendar: calendar)
        let profile = snapshot.context?.profile
        func visible(_ kidID: String?) -> Bool {
            guard let profile else { return true }
            return profile.role == "parent" || kidID == nil || kidID == profile.kidId
        }
        var result: [WatchMyListItem] = []
        for work in snapshot.homework where visible(work.kidId) && work.status != "snoozed" {
            if work.isDone ? (work.dueDate == today) : (work.dueDate <= today) {
                result.append(item(for: work, now: now))
            }
        }
        for action in snapshot.actions where visible(action.kidId) && action.status != "snoozed" {
            if profile?.role == "kid", action.assigneeType == "kid", action.assigneeId != profile?.kidId { continue }
            // Represented homework owns the row.
            if action.sourceType == "homework", snapshot.homework.contains(where: { $0.id == action.sourceId }) { continue }
            let include: Bool
            if action.isDone {
                include = action.dueDate.map { $0 == today } ?? isToday(action.updatedAt, today: today, calendar: calendar)
            } else {
                include = action.dueDate.map { $0 <= today } ?? true
            }
            if include { result.append(item(for: action, now: now)) }
        }
        if profile == nil || profile?.role == "kid" {
            for chore in snapshot.chores ?? [] {
                switch chore.status {
                case "pending": result.append(item(for: chore))
                case "submitted":
                    if chore.submittedAt == nil || isToday(chore.submittedAt, today: today, calendar: calendar) { result.append(item(for: chore)) }
                case "approved":
                    if isToday(chore.approvedAt, today: today, calendar: calendar) { result.append(item(for: chore)) }
                default: break
                }
            }
        }
        var seen = Set<String>()
        result = result.filter { seen.insert($0.id).inserted }
        let order: [WatchMyListItem.Kind: Int] = [.homework: 0, .chore: 1, .fams: 2]
        return result.sorted { a, b in
            if a.isDone != b.isDone { return !a.isDone }
            let left = a.dueAt ?? .distantFuture, right = b.dueAt ?? .distantFuture
            if left != right { return left < right }
            if a.kind != b.kind { return order[a.kind, default: 3] < order[b.kind, default: 3] }
            return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
        }
    }

    static func openCount(snapshot: WatchSnapshot, now: Date = Date(), calendar: Calendar = .current) -> Int {
        items(snapshot: snapshot, now: now, calendar: calendar).filter { !$0.isDone }.count
    }

    /// Progress after `completed` was finished. A finished item that no longer
    /// qualifies for today's list (overdue homework) still counts once.
    static func summary(after completed: WatchMyListItem, snapshot: WatchSnapshot, now: Date = Date(),
                        calendar: Calendar = .current) -> WatchDoneSummary {
        let list = items(snapshot: snapshot, now: now, calendar: calendar)
        var done = list.filter(\.isDone).count
        var total = list.count
        if let row = list.first(where: { $0.id == completed.id }) {
            if !row.isDone { done += 1 }
        } else {
            done += 1
            total += 1
        }
        let next = list.first { !$0.isDone && $0.id != completed.id }?.title
        return WatchDoneSummary(title: completed.title, done: min(done, total), total: total,
                                famsAmount: completed.kind == .fams ? completed.famsAmount : nil, next: next)
    }
}
