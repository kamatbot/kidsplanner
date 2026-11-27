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
            .containerBackground(for: .widget) { background }
    }

    @ViewBuilder private var background: some View {
        switch family {
        case .accessoryCircular: AccessoryWidgetBackground()
        case .accessoryRectangular, .accessoryInline: Color.clear
        case .systemSmall: FamilyTheme.boldGradient
        default: FamilyTheme.softGradient
        }
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

    private var members: [FamilyCalendarMember] { entry.snapshot?.members ?? [] }
    private func member(_ event: FamilyCalendarEvent) -> FamilyCalendarMember? {
        entry.snapshot?.member(id: event.memberID)
    }

    // MARK: Lock Screen

    private var inlineView: some View {
        Group {
            if let next = entry.events.first {
                Label("\(CalendarText.shortWhen(next, at: entry.date)) \(next.title)",
                      systemImage: EventIcon.symbol(for: next))
            } else if entry.snapshot == nil {
                Text("Open Fam ETC")
            } else {
                Label("Nothing planned", systemImage: "figure.2.and.child.holdinghands")
            }
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: entry.events.first?.dayKey))
    }

    private var circularView: some View {
        let today = FamilyCalendarEvent.dayKey(entry.date)
        let count = entry.events.filter { $0.dayKey <= today }.count
        return VStack(spacing: 0) {
            Image(systemName: "figure.2.and.child.holdinghands")
                .font(.system(size: 11, weight: .semibold))
            Text(entry.date.formatted(.dateTime.day()))
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .widgetAccentable()
            Text(entry.snapshot == nil ? "–" : "\(count) today")
                .font(.system(size: 9, weight: .semibold))
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: today))
    }

    private var rectangularView: some View {
        HStack(alignment: .center, spacing: 6) {
            if let next = entry.events.first {
                MemberBadge(member: member(next), all: members, size: 24, monochrome: true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(CalendarText.dayLabel(next.dayKey, at: entry.date) + " · " + CalendarText.timeText(next, at: entry.date))
                        .font(.caption2.weight(.semibold)).widgetAccentable().lineLimit(1)
                    Text(next.title).font(.headline).lineLimit(1)
                    Text(member(next)?.name ?? "Everyone")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            } else {
                Image(systemName: "figure.2.and.child.holdinghands").font(.title3)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Fam ETC").font(.caption2.weight(.semibold)).widgetAccentable()
                    Text(entry.snapshot == nil ? "Open Fam ETC" : "Nothing planned").font(.headline).lineLimit(1)
                    Text(entry.snapshot == nil ? "to see the calendar" : "for the next 2 weeks")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: entry.events.first?.dayKey))
    }

    // MARK: Home Screen

    /// Bold brand gradient, white type, glassy event chips.
    private var smallView: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: -2) {
                    Text(entry.date.formatted(.dateTime.weekday(.wide)).uppercased())
                        .font(.system(size: 11, weight: .heavy)).opacity(0.9)
                    Text(entry.date.formatted(.dateTime.day()))
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                }
                Spacer(minLength: 0)
                AvatarStack(members: members, size: 18)
            }
            .foregroundStyle(.white)
            if let message = emptyMessage {
                Text(message).font(.caption.weight(.medium)).foregroundStyle(.white.opacity(0.9))
                Spacer(minLength: 0)
            } else {
                ForEach(entry.events.prefix(2)) { event in
                    GlassChip(event: event, member: member(event), all: members, now: entry.date)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(FamilyCalendarRoute.url(dayKey: entry.events.first?.dayKey))
    }

    private var mediumView: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.date.formatted(.dateTime.weekday(.wide)).uppercased())
                    .font(.system(size: 11, weight: .heavy)).opacity(0.9)
                Text(entry.date.formatted(.dateTime.day()))
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                Text(todayCount).font(.caption.weight(.semibold)).opacity(0.9).lineLimit(2)
                Spacer(minLength: 0)
                AvatarStack(members: members, size: 20)
            }
            .foregroundStyle(.white)
            .padding(10)
            .frame(width: 104, alignment: .leading)
            .frame(maxHeight: .infinity, alignment: .topLeading)
            .background(FamilyTheme.boldGradient, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                if let message = emptyMessage {
                    Spacer(minLength: 0)
                    Text(message).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                } else {
                    ForEach(entry.events.prefix(3)) { event in
                        Link(destination: FamilyCalendarRoute.url(dayKey: event.dayKey) ?? fallbackURL) {
                            EventCard(event: event, member: member(event), all: members, now: entry.date, showDay: true)
                        }
                    }
                    Spacer(minLength: 0)
                }
                footer
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: nil))
    }

    private var largeView: some View {
        VStack(alignment: .leading, spacing: 8) {
            headerBand
            if let message = emptyMessage {
                emptyState(message)
            } else {
                agendaColumn(DaySection.build(entry.events, lines: 9, now: entry.date))
                Spacer(minLength: 0)
            }
            footer
        }
        .widgetURL(FamilyCalendarRoute.url(dayKey: nil))
    }

    private var extraLargeView: some View {
        let sections = DaySection.build(entry.events, lines: 18, now: entry.date)
        let (left, right) = DaySection.split(sections, firstColumnLines: 9)
        return VStack(alignment: .leading, spacing: 10) {
            headerBand
            if let message = emptyMessage {
                emptyState(message)
            } else {
                HStack(alignment: .top, spacing: 14) {
                    agendaColumn(left).frame(maxWidth: .infinity, alignment: .topLeading)
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
            return entry.memberName.map { "Nothing planned for \($0) in the next 2 weeks." }
                ?? "Nothing planned for the next 2 weeks. Enjoy the downtime!"
        }
        return nil
    }

    private var todayCount: String {
        let today = FamilyCalendarEvent.dayKey(entry.date)
        let count = entry.events.filter { $0.dayKey <= today }.count
        return count == 0 ? "Free today" : count == 1 ? "1 plan today" : "\(count) plans today"
    }

    /// Gradient title band with the family's avatars.
    private var headerBand: some View {
        HStack(spacing: 8) {
            Image(systemName: "figure.2.and.child.holdinghands")
                .font(.system(size: 18, weight: .semibold))
            VStack(alignment: .leading, spacing: 0) {
                Text(entry.memberName.map { "\($0)'s plans" } ?? "Our family")
                    .font(.headline).lineLimit(1)
                Text(entry.date.formatted(.dateTime.weekday(.wide).month(.wide).day()) + " · " + todayCount)
                    .font(.caption.weight(.medium)).opacity(0.9).lineLimit(1)
            }
            Spacer(minLength: 4)
            if family == .systemExtraLarge {
                MemberLegend(members: members)
            } else {
                AvatarStack(members: members, size: 24)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(FamilyTheme.boldGradient, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func emptyState(_ message: String) -> some View {
        VStack(spacing: 8) {
            Spacer()
            Image(systemName: "sun.max.fill").font(.largeTitle)
                .foregroundStyle(FamilyTheme.boldGradient)
            Text(message).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var footer: some View {
        if entry.isStale {
            Label("Open Fam ETC to refresh", systemImage: "arrow.clockwise")
                .font(.caption2.weight(.semibold)).foregroundStyle(.orange).lineLimit(1)
        }
    }

    private func agendaColumn(_ sections: [DaySection]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(sections) { section in
                Link(destination: FamilyCalendarRoute.url(dayKey: section.dayKey) ?? fallbackURL) {
                    VStack(alignment: .leading, spacing: 4) {
                        DayChip(label: CalendarText.dayLabel(section.dayKey, at: entry.date),
                                isToday: section.dayKey <= FamilyCalendarEvent.dayKey(entry.date))
                        ForEach(section.events) { event in
                            EventCard(event: event, member: member(event), all: members, now: entry.date, showDay: false)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Building blocks

enum FamilyTheme {
    static let purple = Color(red: 0x7B / 255, green: 0x4D / 255, blue: 0xFF / 255)
    static let coral = Color(red: 0xE8 / 255, green: 0x46 / 255, blue: 0x7C / 255)
    static let sunny = Color(red: 0xFF / 255, green: 0x9F / 255, blue: 0x43 / 255)

    static var boldGradient: LinearGradient {
        LinearGradient(colors: [purple, coral, sunny], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    static var softGradient: LinearGradient {
        LinearGradient(colors: [adaptive(0xF3EDFF, 0x221A40), adaptive(0xFFF0F5, 0x2E1A2C), adaptive(0xFFF6EA, 0x2B2017)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255,
                           blue: CGFloat(value & 0xff) / 255, alpha: 1)
        })
    }

    /// The member's own color; family-wide events use the brand purple.
    static func color(for member: FamilyCalendarMember?) -> Color {
        guard let member else { return purple }
        return CalendarText.color(member.colorHex)
    }
}

/// A round avatar with the member's initial, or the whole family for a
/// family-wide event.
struct MemberBadge: View {
    let member: FamilyCalendarMember?
    let all: [FamilyCalendarMember]
    var size: CGFloat = 26
    var monochrome = false

    var body: some View {
        if let member {
            Initial(name: member.name, color: CalendarText.color(member.colorHex), size: size, monochrome: monochrome)
        } else {
            ZStack {
                Circle().fill(monochrome ? AnyShapeStyle(Color.primary.opacity(0.2)) : AnyShapeStyle(FamilyTheme.boldGradient))
                Image(systemName: "figure.2.and.child.holdinghands")
                    .font(.system(size: size * 0.5, weight: .bold))
                    .foregroundStyle(monochrome ? AnyShapeStyle(Color.primary) : AnyShapeStyle(Color.white))
            }
            .frame(width: size, height: size)
            .overlay(Circle().strokeBorder(.white.opacity(monochrome ? 0 : 0.9), lineWidth: 1.5))
            .accessibilityLabel("Everyone")
        }
    }
}

struct Initial: View {
    let name: String
    let color: Color
    let size: CGFloat
    var monochrome = false

    var body: some View {
        Text(String(name.prefix(1)).uppercased())
            .font(.system(size: size * 0.5, weight: .heavy, design: .rounded))
            .foregroundStyle(monochrome ? AnyShapeStyle(Color.primary) : AnyShapeStyle(Color.white))
            .frame(width: size, height: size)
            .background(Circle().fill(monochrome ? AnyShapeStyle(Color.primary.opacity(0.2)) : AnyShapeStyle(color.gradient)))
            .overlay(Circle().strokeBorder(.white.opacity(monochrome ? 0 : 0.9), lineWidth: 1.5))
            .accessibilityLabel(name)
    }
}

/// Overlapping avatars of the whole family.
struct AvatarStack: View {
    let members: [FamilyCalendarMember]
    var size: CGFloat = 22

    var body: some View {
        HStack(spacing: -size * 0.35) {
            ForEach(members.prefix(4)) { member in
                Initial(name: member.name, color: CalendarText.color(member.colorHex), size: size)
            }
        }
    }
}

/// Avatar + name for each family member (extra-large header).
struct MemberLegend: View {
    let members: [FamilyCalendarMember]

    var body: some View {
        HStack(spacing: 10) {
            ForEach(members.prefix(5)) { member in
                HStack(spacing: 4) {
                    Initial(name: member.name, color: CalendarText.color(member.colorHex), size: 22)
                    Text(member.name).font(.caption.weight(.semibold)).lineLimit(1)
                }
            }
        }
    }
}

struct DayChip: View {
    let label: String
    let isToday: Bool

    var body: some View {
        Text(label.uppercased())
            .font(.system(size: 10, weight: .heavy))
            .foregroundStyle(isToday ? AnyShapeStyle(Color.white) : AnyShapeStyle(FamilyTheme.purple))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(isToday ? AnyShapeStyle(FamilyTheme.coral) : AnyShapeStyle(FamilyTheme.purple.opacity(0.14))))
    }
}

/// A rounded card tinted with the member's color: avatar, activity icon,
/// title, and time.
struct EventCard: View {
    let event: FamilyCalendarEvent
    let member: FamilyCalendarMember?
    let all: [FamilyCalendarMember]
    let now: Date
    let showDay: Bool

    var body: some View {
        let tint = FamilyTheme.color(for: member)
        HStack(spacing: 8) {
            MemberBadge(member: member, all: all, size: 26)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) {
                    Image(systemName: EventIcon.symbol(for: event))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(tint)
                    Text(event.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                }
                Text(detail).font(.caption2.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 7).padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(tint.opacity(0.16)))
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 12, style: .continuous)
                .fill(tint).frame(width: 4)
        }
        .accessibilityElement(children: .combine)
    }

    private var detail: String {
        var parts: [String] = []
        if showDay, event.dayKey > FamilyCalendarEvent.dayKey(now) {
            parts.append(CalendarText.dayLabel(event.dayKey, at: now))
        }
        parts.append(CalendarText.timeText(event, at: now))
        parts.append(member?.name ?? "Everyone")
        return parts.joined(separator: " · ")
    }
}

/// Small widget chip: frosted white on the brand gradient.
struct GlassChip: View {
    let event: FamilyCalendarEvent
    let member: FamilyCalendarMember?
    let all: [FamilyCalendarMember]
    let now: Date

    var body: some View {
        HStack(spacing: 6) {
            MemberBadge(member: member, all: all, size: 22)
            VStack(alignment: .leading, spacing: 0) {
                Text(event.title).font(.caption.weight(.bold)).lineLimit(1)
                Text(CalendarText.shortWhen(event, at: now))
                    .font(.system(size: 10, weight: .semibold)).opacity(0.85).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(5)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.white.opacity(0.22)))
        .accessibilityElement(children: .combine)
    }
}

/// A playful activity icon from the event's category or title.
enum EventIcon {
    static func symbol(for event: FamilyCalendarEvent) -> String {
        let title = event.title.lowercased()
        let keywords: [(String, [String])] = [
            ("birthday.cake.fill", ["birthday", "party", "bday"]),
            ("soccerball", ["soccer", "football"]),
            ("figure.pool.swim", ["swim"]),
            ("basketball.fill", ["basketball"]),
            ("tennis.racket", ["tennis", "badminton"]),
            ("figure.run", ["run", "athletic", "track", "sports day", "pe "]),
            ("music.note", ["piano", "music", "violin", "guitar", "choir", "band", "concert"]),
            ("paintpalette.fill", ["art", "paint", "draw", "craft"]),
            ("theatermasks.fill", ["drama", "play", "theatre", "theater", "dance", "ballet"]),
            ("cross.case.fill", ["doctor", "dentist", "clinic", "hospital", "vaccin"]),
            ("fork.knife", ["dinner", "lunch", "breakfast", "brunch", "restaurant"]),
            ("airplane", ["flight", "trip", "vacation", "holiday", "travel"]),
            ("book.fill", ["exam", "test", "quiz", "homework", "reading", "library"]),
            ("graduationcap.fill", ["school", "class", "parent-teacher", "ptc", "assembly"]),
            ("car.fill", ["pick up", "pickup", "drop off", "drive"]),
        ]
        for (symbol, words) in keywords where words.contains(where: { title.contains($0) }) {
            return symbol
        }
        switch event.category {
        case "school": return "graduationcap.fill"
        case "deadline": return "flag.fill"
        case "sports": return "figure.run"
        case "arts": return "paintpalette.fill"
        case "social": return "party.popper.fill"
        default: return "star.fill"
        }
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
    static let brand = FamilyTheme.purple

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
                    start: laterToday, end: laterToday.addingTimeInterval(3600), allDay: false, memberID: "a", category: "sports"),
                FamilyCalendarEvent(id: "2", title: "Family dinner", dayKey: today, endDayKey: nil,
                    start: laterToday.addingTimeInterval(2 * 3600), end: nil, allDay: false, memberID: nil),
                FamilyCalendarEvent(id: "3", title: "Book fair", dayKey: tomorrow, endDayKey: nil,
                    start: nil, end: nil, allDay: true, memberID: "b", category: "school"),
                FamilyCalendarEvent(id: "4", title: "Soccer", dayKey: tomorrow, endDayKey: nil,
                    start: at(tomorrowDate, 17), end: at(tomorrowDate, 18), allDay: false, memberID: "b", category: "sports"),
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
