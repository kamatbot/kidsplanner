import AppIntents
import SwiftUI
import WidgetKit

/// Home Screen (small, medium, large, extra large on iPad) and Lock Screen
/// widgets for the family calendar. Data comes from the snapshot the app
/// writes after every calendar load (FamilyCalendarWidgetPublisher).
struct SelectCalendarMemberIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Family calendar"
    static let description = IntentDescription("Show everyone's events, or one family member's.")

    @Parameter(title: "Show events for") var member: FamilyCalendarMemberEntity?
}

struct FamilyCalendarEntry: TimelineEntry {
    let date: Date
    let snapshot: FamilyCalendarSnapshot?
    let memberID: String?

    var events: [FamilyCalendarEvent] {
        snapshot?.upcoming(at: date, memberID: memberID) ?? []
    }

    var isStale: Bool {
        guard let snapshot else { return false }
        return date.timeIntervalSince(snapshot.generatedAt) > FamilyCalendarSnapshot.staleAfter
    }

    var memberName: String? { snapshot?.member(id: memberID)?.name }
}

struct FamilyCalendarProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FamilyCalendarEntry {
        FamilyCalendarEntry(date: .now, snapshot: .sample(now: .now), memberID: nil)
    }

    func snapshot(for configuration: SelectCalendarMemberIntent, in context: Context) async -> FamilyCalendarEntry {
        let stored = FamilyCalendarSnapshotStore.load()
        // The widget gallery shows sample events until the app has written real ones.
        let snapshot = stored ?? (context.isPreview ? .sample(now: .now) : nil)
        return FamilyCalendarEntry(date: .now, snapshot: snapshot, memberID: configuration.member?.id)
    }

    func timeline(for configuration: SelectCalendarMemberIntent, in context: Context) async -> Timeline<FamilyCalendarEntry> {
        let now = Date()
        let calendar = Calendar.current
        let snapshot = FamilyCalendarSnapshotStore.load()
        let memberID = configuration.member?.id
        let horizon = now.addingTimeInterval(24 * 60 * 60)

        // A new entry whenever an event starts or ends, and at midnight, so the
        // list moves on by itself without the app running.
        var moments = Set<Date>()
        if let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) {
            moments.insert(midnight)
        }
        for event in snapshot?.upcoming(at: now, memberID: memberID) ?? [] where !event.allDay {
            if let start = event.start, start > now, start < horizon { moments.insert(start) }
            let end = event.effectiveEnd
            if end > now, end < horizon { moments.insert(end) }
        }
        let dates = [now] + moments.sorted().prefix(40)
        let entries = dates.map { FamilyCalendarEntry(date: $0, snapshot: snapshot, memberID: memberID) }
        return Timeline(entries: entries, policy: .atEnd)
    }
}

// MARK: - Views

struct FamilyCalendarWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FamilyCalendarEntry

    var body: some View {
        content
            .containerBackground(for: .widget) {
                if isAccessory { AccessoryWidgetBackground().opacity(family == .accessoryCircular ? 1 : 0) }
                else { Color(.systemBackground) }
            }
    }

    private var isAccessory: Bool {
        let accessories: [WidgetFamily] = [.accessoryCircular, .accessoryRectangular, .accessoryInline]
        return accessories.contains(family)
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline: inlineView
        case .accessoryCircular: circularView
        case .accessoryRectangular: rectangularView
        case .systemSmall: smallView
        case .systemMedium: mediumView
        case .systemExtraLarge: extraLargeView
        default: largeView
        }
    }

    // MARK: Lock Screen

    private var inlineView: some View {
        Group {
            if let next = entry.events.first {
                Text("\(CalendarText.shortWhen(next, at: entry.date)) \(next.title)")
            } else if entry.snapshot == nil {
                Text("Open Fam ETC")
            } else {
                Text("No upcoming events")
            }
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: entry.events.first?.dayKey))
    }

    private var circularView: some View {
        let today = FamilyCalendarEvent.dayKey(entry.date)
        let count = entry.events.filter { $0.dayKey <= today }.count
        return VStack(spacing: 0) {
            Text(entry.date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                .font(.system(size: 10, weight: .semibold))
            Text(entry.date.formatted(.dateTime.day()))
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .widgetAccentable()
            Text(entry.snapshot == nil ? "–" : "\(count) today")
                .font(.system(size: 9, weight: .medium))
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: today))
    }

    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let next = entry.events.first {
                Text(CalendarText.dayLabel(next.dayKey, at: entry.date) + " · " + CalendarText.timeText(next, at: entry.date))
                    .font(.caption2.weight(.semibold))
                    .widgetAccentable()
                    .lineLimit(1)
                Text(next.title).font(.headline).lineLimit(1)
                if let second = entry.events.dropFirst().first {
                    Text("\(CalendarText.shortWhen(second, at: entry.date)) \(second.title)")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                } else if let name = entry.snapshot?.member(id: next.memberID)?.name {
                    Text(name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            } else {
                Text("Fam ETC").font(.caption2.weight(.semibold)).widgetAccentable()
                Text(entry.snapshot == nil ? "Open Fam ETC" : "No upcoming events")
                    .font(.headline).lineLimit(1)
                Text(entry.snapshot == nil ? "to see the calendar" : "for the next 2 weeks")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(FamilyCalendarRoute.url(dayKey: entry.events.first?.dayKey))
    }

    // MARK: Home Screen

    private var smallView: some View {
        VStack(alignment: .leading, spacing: 6) {
            dateHeader(compact: true)
            if let message = emptyMessage {
                Text(message).font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(entry.events.prefix(3)) { event in
                    EventRow(event: event, entry: entry, style: .compact)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(FamilyCalendarRoute.url(dayKey: entry.events.first?.dayKey))
    }

    private var mediumView: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                dateHeader(compact: false)
                Spacer(minLength: 0)
                todayCountText
                footer
            }
            .frame(width: 92, alignment: .leading)
            VStack(alignment: .leading, spacing: 6) {
                if let message = emptyMessage {
                    Spacer(minLength: 0)
                    Text(message).font(.subheadline).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                } else {
                    ForEach(entry.events.prefix(4)) { event in
                        Link(destination: FamilyCalendarRoute.url(dayKey: event.dayKey) ?? fallbackURL) {
                            EventRow(event: event, entry: entry, style: .withDay)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: nil))
    }

    private var largeView: some View {
        VStack(alignment: .leading, spacing: 8) {
            titleBar
            Divider()
            if let message = emptyMessage {
                Spacer()
                Text(message).font(.subheadline).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                Spacer()
            } else {
                agendaColumn(DaySection.build(entry.events, lines: 11, now: entry.date))
                Spacer(minLength: 0)
            }
            footer
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: nil))
    }

    private var extraLargeView: some View {
        let sections = DaySection.build(entry.events, lines: 26, now: entry.date)
        let (left, right) = DaySection.split(sections, firstColumnLines: 13)
        return VStack(alignment: .leading, spacing: 8) {
            titleBar
            Divider()
            if let message = emptyMessage {
                Spacer()
                Text(message).font(.title3).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                Spacer()
            } else {
                HStack(alignment: .top, spacing: 20) {
                    agendaColumn(left).frame(maxWidth: .infinity, alignment: .topLeading)
                    Divider()
                    agendaColumn(right).frame(maxWidth: .infinity, alignment: .topLeading)
                }
                Spacer(minLength: 0)
            }
            footer
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: nil))
    }

    // MARK: Pieces

    private var fallbackURL: URL { URL(string: "https://www.fametc.com/?famRoute=calendar")! }

    private var emptyMessage: String? {
        if entry.snapshot == nil { return "Open Fam ETC to see your family calendar here." }
        if entry.events.isEmpty {
            return entry.memberName.map { "Nothing coming up for \($0) in the next 2 weeks." }
                ?? "Nothing on the family calendar for the next 2 weeks."
        }
        return nil
    }

    private func dateHeader(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(entry.date.formatted(.dateTime.weekday(.wide)).uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(CalendarText.brand)
                .lineLimit(1)
            Text(entry.date.formatted(.dateTime.day()))
                .font(.system(size: compact ? 26 : 38, weight: .semibold, design: .rounded))
                .lineLimit(1)
        }
    }

    private var todayCountText: some View {
        let today = FamilyCalendarEvent.dayKey(entry.date)
        let count = entry.events.filter { $0.dayKey <= today }.count
        return Text(count == 0 ? "Free today" : count == 1 ? "1 event today" : "\(count) events today")
            .font(.caption.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
    }

    private var titleBar: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(entry.memberName.map { "\($0)'s calendar" } ?? "Family calendar")
                .font(.headline).lineLimit(1)
            Spacer()
            Text(entry.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                .font(.subheadline.weight(.semibold)).foregroundStyle(CalendarText.brand)
        }
    }

    @ViewBuilder private var footer: some View {
        if entry.isStale {
            Text("Open Fam ETC to refresh").font(.caption2).foregroundStyle(.orange).lineLimit(1)
        }
    }

    private func agendaColumn(_ sections: [DaySection]) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(sections) { section in
                Link(destination: FamilyCalendarRoute.url(dayKey: section.dayKey) ?? fallbackURL) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(CalendarText.dayLabel(section.dayKey, at: entry.date))
                            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            .padding(.top, 2)
                        ForEach(section.events) { event in
                            EventRow(event: event, entry: entry, style: .full)
                        }
                    }
                }
            }
        }
    }
}

/// One event line: a member-colored bar, the title and the time.
struct EventRow: View {
    enum Style { case compact, withDay, full }
    let event: FamilyCalendarEvent
    let entry: FamilyCalendarEntry
    let style: Style

    var body: some View {
        let member = entry.snapshot?.member(id: event.memberID)
        HStack(alignment: .top, spacing: 6) {
            RoundedRectangle(cornerRadius: 2)
                .fill(CalendarText.color(member?.colorHex))
                .frame(width: 4)
                .frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 0) {
                Text(event.title)
                    .font(style == .compact ? .caption.weight(.semibold) : .subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(detail(member: member))
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    private func detail(member: FamilyCalendarMember?) -> String {
        var parts: [String] = []
        let isToday = event.dayKey <= FamilyCalendarEvent.dayKey(entry.date)
        if style != .full, !isToday { parts.append(CalendarText.dayLabel(event.dayKey, at: entry.date)) }
        parts.append(CalendarText.timeText(event, at: entry.date))
        if style != .compact { parts.append(member?.name ?? "Family") }
        return parts.joined(separator: " · ")
    }
}

struct DaySection: Identifiable {
    let dayKey: String
    let events: [FamilyCalendarEvent]
    var id: String { dayKey }
    var lines: Int { events.count + 1 }

    /// Groups events by day, showing ongoing multi-day events under today,
    /// within a budget of lines (a day header counts as one).
    static func build(_ events: [FamilyCalendarEvent], lines budget: Int, now: Date) -> [DaySection] {
        let today = FamilyCalendarEvent.dayKey(now)
        var order: [String] = []
        var grouped: [String: [FamilyCalendarEvent]] = [:]
        for event in events {
            let key = max(event.dayKey, today)
            if grouped[key] == nil { order.append(key) }
            grouped[key, default: []].append(event)
        }
        var remaining = budget
        var sections: [DaySection] = []
        for key in order.sorted() {
            guard remaining >= 2, let dayEvents = grouped[key] else { break }
            let take = min(dayEvents.count, remaining - 1)
            sections.append(DaySection(dayKey: key, events: Array(dayEvents.prefix(take))))
            remaining -= take + 1
        }
        return sections
    }

    static func split(_ sections: [DaySection], firstColumnLines: Int) -> ([DaySection], [DaySection]) {
        var used = 0
        var left: [DaySection] = []
        var right: [DaySection] = []
        for section in sections {
            if right.isEmpty, used + section.lines <= firstColumnLines || left.isEmpty {
                left.append(section)
                used += section.lines
            } else {
                right.append(section)
            }
        }
        return (left, right)
    }
}

enum CalendarText {
    static let brand = Color(red: 0x7B / 255, green: 0x4D / 255, blue: 0xFF / 255)

    static func color(_ hex: String?) -> Color {
        guard let hex, hex.count == 7, let value = UInt64(hex.dropFirst(), radix: 16) else { return brand }
        return Color(red: Double((value >> 16) & 0xff) / 255,
                     green: Double((value >> 8) & 0xff) / 255,
                     blue: Double(value & 0xff) / 255)
    }

    static func dayLabel(_ key: String, at now: Date) -> String {
        let calendar = Calendar.current
        let today = FamilyCalendarEvent.dayKey(now, calendar: calendar)
        if key <= today { return "Today" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now),
           key == FamilyCalendarEvent.dayKey(tomorrow, calendar: calendar) { return "Tomorrow" }
        guard let date = FamilyCalendarEvent.date(fromDayKey: key, calendar: calendar) else { return key }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    static func timeText(_ event: FamilyCalendarEvent, at now: Date) -> String {
        guard !event.allDay, let start = event.start else { return "All day" }
        if start <= now { return "Now · until \(event.effectiveEnd.formatted(date: .omitted, time: .shortened))" }
        if let end = event.end, end > start, Calendar.current.isDate(end, inSameDayAs: start) {
            return "\(start.formatted(date: .omitted, time: .shortened)) – \(end.formatted(date: .omitted, time: .shortened))"
        }
        return start.formatted(date: .omitted, time: .shortened)
    }

    /// "3:30 PM", "Tomorrow", "Sat" — the shortest useful prefix for one line.
    static func shortWhen(_ event: FamilyCalendarEvent, at now: Date) -> String {
        let today = FamilyCalendarEvent.dayKey(now)
        if event.dayKey <= today {
            guard !event.allDay, let start = event.start else { return "Today" }
            return start <= now ? "Now" : start.formatted(date: .omitted, time: .shortened)
        }
        let label = dayLabel(event.dayKey, at: now)
        if label == "Tomorrow" { return label }
        return FamilyCalendarEvent.date(fromDayKey: event.dayKey)?
            .formatted(.dateTime.weekday(.abbreviated)) ?? label
    }
}

extension FamilyCalendarSnapshot {
    /// Shown in the widget gallery before the app has written real data.
    static func sample(now: Date) -> FamilyCalendarSnapshot {
        let calendar = Calendar.current
        let today = FamilyCalendarEvent.dayKey(now)
        let tomorrowDate = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        let tomorrow = FamilyCalendarEvent.dayKey(tomorrowDate)
        func at(_ day: Date, _ hour: Int) -> Date {
            calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
        }
        let laterToday = max(at(now, 16), now.addingTimeInterval(60 * 60))
        return FamilyCalendarSnapshot(accountID: "", familyID: "", generatedAt: now,
            members: [FamilyCalendarMember(id: "a", name: "Maya", colorHex: "#14B8A6"),
                      FamilyCalendarMember(id: "b", name: "Leo", colorHex: "#F59E0B")],
            events: [
                FamilyCalendarEvent(id: "1", title: "Swim practice", dayKey: today, endDayKey: nil,
                    start: laterToday, end: laterToday.addingTimeInterval(3600), allDay: false, memberID: "a"),
                FamilyCalendarEvent(id: "2", title: "Family dinner", dayKey: today, endDayKey: nil,
                    start: laterToday.addingTimeInterval(2 * 3600), end: nil, allDay: false, memberID: nil),
                FamilyCalendarEvent(id: "3", title: "Book fair", dayKey: tomorrow, endDayKey: nil,
                    start: nil, end: nil, allDay: true, memberID: "b"),
                FamilyCalendarEvent(id: "4", title: "Soccer", dayKey: tomorrow, endDayKey: nil,
                    start: at(tomorrowDate, 17), end: at(tomorrowDate, 18), allDay: false, memberID: "b"),
            ])
    }
}

struct FamETCCalendarWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: FamilyCalendarSnapshot.widgetKind, intent: SelectCalendarMemberIntent.self,
            provider: FamilyCalendarProvider()) { entry in
            FamilyCalendarWidgetView(entry: entry)
        }
        .configurationDisplayName("Family calendar")
        .description("Upcoming family events, colored by family member. Tap to open the calendar.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge,
                            .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

@main
struct FamETCWidgets: WidgetBundle {
    var body: some Widget {
        FamETCCalendarWidget()
        FamETCFamilyWidget()
    }
}
