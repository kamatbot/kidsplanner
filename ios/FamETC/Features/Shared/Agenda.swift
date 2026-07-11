import Foundation
import SwiftUI

/// A unified row for the Today / Calendar surfaces — a school-feed event, a
/// school "deadline", or a homework item — so both screens can render one list.
enum AgendaKind { case event, deadline, homework }

struct AgendaItem: Identifiable {
    let id: String
    let kind: AgendaKind
    let title: String
    let dayKey: String       // yyyy-MM-dd (local)
    let time: String?        // display time ("5:00 PM"); nil = all-day / no time
    let sortKey: String      // 24h "HH:mm" for intra-day ordering
    let subtitle: String?    // subject / feed / location
    let homework: HomeworkItem?  // set when kind == .homework (enables the done toggle)
    let kidId: String?       // resolves a per-kid color/name badge (Palette.kidColor)
    let familyEvent: FamilyEvent?  // set for manually-added events (recurring indicator, tap-to-detail)
}

/// Builds/labels agenda data. Formatters are shared (see DateFmt) — allocating
/// them per row is a real scrolling cost.
enum Agenda {
    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain = ISO8601DateFormatter()
    private static let time12: DateFormatter = { let f = DateFormatter(); f.dateFormat = "h:mm a"; return f }()
    private static let time24: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f }()
    private static let weekday: DateFormatter = { let f = DateFormatter(); f.dateFormat = "EEE, MMM d"; return f }()

    static func parseISO(_ s: String) -> Date? { isoFrac.date(from: s) ?? isoPlain.date(from: s) }
    static func todayKey() -> String { DateFmt.ymd.string(from: Date()) }
    static func dayKey(offset days: Int) -> String {
        DateFmt.ymd.string(from: Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date())
    }

    /// A friendly section header for a yyyy-MM-dd key: Today / Tomorrow / "Wed, Jul 9".
    static func dayLabel(_ key: String) -> String {
        if key == todayKey() { return "Today" }
        if key == dayKey(offset: 1) { return "Tomorrow" }
        if let d = DateFmt.ymd.date(from: key) { return weekday.string(from: d) }
        return key
    }

    /// Convert a stored "HH:mm" to a display "h:mm a" (falls back to the raw value).
    private static func display(hhmm: String) -> String {
        if let d = time24.date(from: hhmm) { return time12.string(from: d) }
        return hhmm
    }

    private static func fromEvent(_ e: CalendarEvent) -> AgendaItem {
        let raw = e.start ?? ""
        let allDay = (e.allDay ?? false) || raw.count <= 10
        var dayKey = String(raw.prefix(10))
        var time: String? = nil
        var sort = "00:00"
        if !allDay, let d = parseISO(raw) {
            dayKey = DateFmt.ymd.string(from: d)
            time = time12.string(from: d)
            sort = time24.string(from: d)
        }
        let kind: AgendaKind = (e.isDeadline ?? false) || e.type == "deadline" ? .deadline : .event
        return AgendaItem(id: "ev-\(e.id)", kind: kind, title: e.title, dayKey: dayKey,
                          time: time, sortKey: sort, subtitle: e.feedLabel ?? e.location, homework: nil,
                          kidId: e.kidId, familyEvent: nil)
    }

    private static func fromFamilyEvent(_ e: FamilyEvent) -> AgendaItem {
        let hasTime = (e.time?.isEmpty == false)
        return AgendaItem(id: "fe-\(e.id)-\(e.date)", kind: .event, title: e.title, dayKey: e.date,
                          time: hasTime ? display(hhmm: e.time!) : nil,
                          sortKey: hasTime ? e.time! : "00:00",
                          subtitle: (e.notes?.isEmpty == false) ? e.notes : nil, homework: nil,
                          kidId: e.kidId, familyEvent: e)
    }

    /// Expands a multi-day family event (`endDate` set) into one AgendaItem per
    /// day in its span, so it shows up on every day it covers — not just the
    /// start. Continuation days carry no time (all-day) but keep the same
    /// `familyEvent` ref for the detail sheet / recurring indicator. A plain
    /// single-day event just returns its one item.
    private static func expandFamilyEvent(_ e: FamilyEvent) -> [AgendaItem] {
        let first = fromFamilyEvent(e)
        guard let endDate = e.endDate, !endDate.isEmpty, endDate > e.date,
              let start = DateFmt.ymd.date(from: e.date), let end = DateFmt.ymd.date(from: endDate) else {
            return [first]
        }
        var items = [first]
        var cur = start
        // ponytail: 62-day span cap — guards a malformed/huge endDate from
        // looping forever; raise if a real multi-week trip event needs more.
        for _ in 0..<62 {
            guard let next = Calendar.current.date(byAdding: .day, value: 1, to: cur) else { break }
            cur = next
            if cur > end { break }
            let key = DateFmt.ymd.string(from: cur)
            items.append(AgendaItem(id: "fe-\(e.id)-\(key)", kind: .event, title: e.title, dayKey: key,
                                     time: nil, sortKey: "00:00", subtitle: first.subtitle, homework: nil,
                                     kidId: e.kidId, familyEvent: e))
        }
        return items
    }

    private static func fromHomework(_ h: HomeworkItem) -> AgendaItem {
        AgendaItem(id: "hw-\(h.id)", kind: .homework, title: h.title, dayKey: h.dueDate,
                   time: h.dueTime.map(display(hhmm:)),
                   sortKey: h.dueTime ?? "23:59",
                   subtitle: (h.subject?.isEmpty == false) ? h.subject : "Homework",
                   homework: h, kidId: h.kidId, familyEvent: nil)
    }

    /// All agenda items for a day key, sorted by time.
    static func items(on key: String, events: [CalendarEvent], familyEvents: [FamilyEvent] = [], homework: [HomeworkItem]) -> [AgendaItem] {
        let all = events.map(fromEvent) + familyEvents.flatMap(expandFamilyEvent) + homework.map(fromHomework)
        return all.filter { $0.dayKey == key }.sorted { $0.sortKey < $1.sortKey }
    }

    /// Grouped agenda sections from today forward, limited to `days` ahead.
    static func upcomingSections(events: [CalendarEvent], familyEvents: [FamilyEvent] = [], homework: [HomeworkItem], days: Int) -> [(day: String, items: [AgendaItem])] {
        let today = todayKey()
        let limit = dayKey(offset: days)
        let all = (events.map(fromEvent) + familyEvents.flatMap(expandFamilyEvent) + homework.map(fromHomework))
            .filter { $0.dayKey >= today && $0.dayKey <= limit }
        let byDay = Dictionary(grouping: all) { $0.dayKey }
        return byDay.keys.sorted().map { day in
            (day, byDay[day]!.sorted { $0.sortKey < $1.sortKey })
        }
    }

    /// Map homework items to agenda rows (for the "due soon" list).
    static func rows(homework: [HomeworkItem]) -> [AgendaItem] { homework.map(fromHomework) }

    /// Homework due within the next `days` days (inclusive of today), not done.
    static func homeworkDueSoon(_ homework: [HomeworkItem], days: Int) -> [HomeworkItem] {
        let today = todayKey(); let limit = dayKey(offset: days)
        return homework.filter { !$0.isDone && $0.dueDate >= today && $0.dueDate <= limit }
            .sorted { $0.dueDate < $1.dueDate }
    }

    /// Resolves a kid's Horizon identity color from their position in the family's
    /// kid list (Palette.kidColor cycles teal/amber/blue/… by kid order) — the same
    /// mapping the web app uses. Returns nil when `kidId` doesn't match a kid
    /// (family/school-feed events with no specific kid).
    static func kidColor(_ kidId: String?, kids: [Kid]) -> Color? {
        guard let kidId, let idx = kids.firstIndex(where: { $0.id == kidId }) else { return nil }
        return Palette.kidColor(index: idx)
    }
    static func kidName(_ kidId: String?, kids: [Kid]) -> String? {
        guard let kidId else { return nil }
        return kids.first { $0.id == kidId }?.name
    }
}
