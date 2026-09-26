import SwiftUI

/// A real-agenda day strip. Homework is deliberately excluded: its source is
/// Homework, while these blocks are calendar events and retain their detail path.
struct FamilyRingsDayStrip: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var widthClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var eventRef: FamilyRingsDayEventRef?
    @State private var schoolDetail: AgendaItem?
    var kidID: String? = nil
    var onOpenMeals: () -> Void = {}

    private var today: String { Agenda.todayKey() }
    private var items: [AgendaItem] {
        Agenda.items(on: today, events: store.visibleEvents, familyEvents: store.visibleFamilyEvents, homework: store.homework)
            .filter { $0.kind != .homework && (kidID == nil || $0.kidId == nil || $0.kidId == kidID) }
    }
    private var allDay: [AgendaItem] { items.filter { $0.time == nil } }
    private var timed: [AgendaItem] { items.filter { $0.time != nil && minute($0.sortKey) >= 420 && minute($0.sortKey) < 1260 } }
    private var outOfHours: [AgendaItem] { items.filter { $0.time != nil && (minute($0.sortKey) < 420 || minute($0.sortKey) >= 1260) } }
    private var tomorrowFirst: AgendaItem? {
        Agenda.items(on: Agenda.dayKey(offset: 1), events: store.visibleEvents, familyEvents: store.visibleFamilyEvents, homework: store.homework)
            .first { $0.kind != .homework && (kidID == nil || $0.kidId == nil || $0.kidId == kidID) }
    }
    private var dinner: MenuEntry? { store.meals?.menu.first { $0.date == today && ($0.slot ?? "dinner") == "dinner" } }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.md) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline) {
                        MicroLabel(text: "Today · \(items.count) event\(items.count == 1 ? "" : "s")")
                        Spacer()
                        if store.isParent { tonight }
                    }
                    VStack(alignment: .leading, spacing: Space.xs) {
                    MicroLabel(text: "Today · \(items.count) event\(items.count == 1 ? "" : "s")")
                    if store.isParent { tonight }
                    }
                }
                if !allDay.isEmpty || !outOfHours.isEmpty { chips(allDay + outOfHours) }
                if typeSize.isAccessibilitySize { accessibleList }
                else if items.isEmpty {
                    Text("Nothing on the calendar today").font(Typography.body).foregroundStyle(Palette.textSecond)
                } else if !timed.isEmpty { timeline }
                if Calendar.current.component(.hour, from: Date()) >= 21, let tomorrowFirst {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        MicroLabel(text: "Tomorrow")
                        eventButton(tomorrowFirst, compact: true)
                    }
                }
            }
        }
        .accessibilityIdentifier("today.daystrip")
        .sheet(item: $eventRef) { EventDetailSheet(eventId: $0.eventID, occurrenceDate: $0.occurrenceDate) }
        .sheet(item: $schoolDetail) { SchoolAgendaDetail(item: $0) }
    }

    private var tonight: some View {
        Button(action: onOpenMeals) {
            Label(dinner.map { "Tonight: \($0.title)" } ?? "Tonight: dinner not planned · Plan tonight", systemImage: "fork.knife")
                .font(Typography.chip).foregroundStyle(Palette.frFamsInk).lineLimit(1)
                .padding(.horizontal, Space.sm).frame(minHeight: 44)
                .background(Palette.frFamsSoft, in: Capsule())
        }.buttonStyle(.plain).accessibilityIdentifier("today.tonight")
    }

    private func chips(_ values: [AgendaItem]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), alignment: .leading)], alignment: .leading, spacing: Space.sm) {
            ForEach(values) { item in eventButton(item, compact: true) }
        }
    }

    private var timeline: some View {
        GeometryReader { geometry in
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                TimelineView(.periodic(from: .now, by: 300)) { context in
                    let scale: CGFloat = widthClass == .regular ? max(44, (geometry.size.width - 20) / 14) : 64
                    let trackWidth: CGFloat = 14 * scale + 20
                    let lanes = laneCount
                    VStack(alignment: .leading, spacing: Space.xs) {
                        ZStack(alignment: .topLeading) {
                            RoundedRectangle(cornerRadius: Radius.field).fill(Palette.frCard2)
                            ForEach(7...21, id: \.self) { hour in
                                Rectangle().fill(Palette.frRule).frame(width: 1)
                                    .frame(height: CGFloat(lanes) * 36 + 8)
                                    .offset(x: CGFloat(hour - 7) * scale)
                            }
                            ForEach(timed) { item in block(item, scale: scale) }
                            nowMarker(context.date, scale: scale)
                        }
                        .frame(width: trackWidth, height: CGFloat(lanes) * 36 + 8, alignment: .topLeading)
                        HStack(spacing: 0) { ForEach(7...21, id: \.self) { Text("\($0)").font(Typography.caption).foregroundStyle(Palette.textSecond).frame(width: scale, alignment: .leading) } }
                            .frame(width: trackWidth, alignment: .leading)
                    }
                }
            }
            .task { proxy.scrollTo("now", anchor: .center) }
        }
        }
        .frame(height: CGFloat(laneCount) * 36 + 36)
    }

    private var laneCount: Int {
        var ends: [Int] = []
        for item in timed.sorted(by: { $0.sortKey < $1.sortKey }) {
            let start = minute(item.sortKey), end = endMinute(item)
            if let lane = ends.firstIndex(where: { $0 <= start }) { ends[lane] = end } else { ends.append(end) }
        }
        return max(1, ends.count)
    }

    private func lane(for item: AgendaItem) -> Int {
        var ends: [Int] = []
        for candidate in timed.sorted(by: { $0.sortKey < $1.sortKey }) {
            let start = minute(candidate.sortKey), end = endMinute(candidate)
            let lane: Int
            if let found = ends.firstIndex(where: { $0 <= start }) { lane = found; ends[lane] = end } else { lane = ends.count; ends.append(end) }
            if candidate.id == item.id { return lane }
        }
        return 0
    }

    private func block(_ item: AgendaItem, scale: CGFloat) -> some View {
        let start = CGFloat(minute(item.sortKey) - 420) / 60 * scale
        return eventButton(item, compact: false)
            .frame(width: max(44, CGFloat(min(1260, endMinute(item)) - minute(item.sortKey)) / 60 * scale - 4), height: 32, alignment: .leading)
            .offset(x: start + 2, y: CGFloat(lane(for: item)) * 36 + 4)
    }

    private func eventButton(_ item: AgendaItem, compact: Bool) -> some View {
        Button { open(item) } label: {
            Text(compact ? "\(timeRange(item)) · \(item.title)" : "\(item.title) \(timeRange(item))")
                .font(Typography.caption.weight(.semibold)).lineLimit(1).truncationMode(.tail)
                .foregroundStyle(item.familyEvent == nil ? (Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.frYouInk) : Palette.frYouInk)
                .padding(.horizontal, Space.sm).frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                .background(item.familyEvent == nil ? (Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.frYou).opacity(0.16) : Palette.frYouSoft, in: RoundedRectangle(cornerRadius: 9))
        }.buttonStyle(.plain).contentShape(Rectangle()).frame(minHeight: 44).accessibilityLabel("\(item.title), \(timeRange(item))").accessibilityIdentifier("today.dayevent.\(item.id)")
    }

    private var accessibleList: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            ForEach(items) { item in eventButton(item, compact: true) }
            if items.isEmpty { Text("Nothing on the calendar today").foregroundStyle(Palette.textSecond) }
        }
    }

    private func nowMarker(_ date: Date, scale: CGFloat) -> some View {
        let now = Calendar.current.component(.hour, from: date) * 60 + Calendar.current.component(.minute, from: date)
        let x = max(0, min(14 * scale, CGFloat(now - 420) / 60 * scale))
        return VStack(alignment: .leading, spacing: 0) { Rectangle().fill(Palette.frYou).frame(width: 2, height: CGFloat(laneCount) * 36 - 12); Text("Now \(date.formatted(date: .omitted, time: .shortened))").font(Typography.caption).foregroundStyle(Palette.frOnYou).padding(4).background(Palette.frYou, in: Capsule()).id("now") }.offset(x: x)
    }

    private func endMinute(_ item: AgendaItem) -> Int {
        let start = minute(item.sortKey)
        if let end = item.familyEvent?.endTime { return max(start + 15, minute(end)) }
        if let source = store.visibleEvents.first(where: { "ev-\($0.id)" == item.id }),
           let raw = source.end, let end = Agenda.parseISO(raw) {
            if DateFmt.ymd.string(from: end) > item.dayKey { return 1260 }
            return max(start + 15, Calendar.current.component(.hour, from: end) * 60 + Calendar.current.component(.minute, from: end))
        }
        return start + 60
    }
    private func timeRange(_ item: AgendaItem) -> String {
        guard let start = item.time else { return "All day" }
        if let end = item.familyEvent?.endTime { return "\(start)–\(end)" }
        if let source = store.visibleEvents.first(where: { "ev-\($0.id)" == item.id }),
           let raw = source.end, let end = Agenda.parseISO(raw) {
            return "\(start)–\(end.formatted(date: .omitted, time: .shortened))"
        }
        return start
    }
    private func open(_ item: AgendaItem) { if let event = item.familyEvent { eventRef = .init(eventID: event.id, occurrenceDate: item.dayKey) } else { schoolDetail = item } }
    private func minute(_ value: String) -> Int { let parts = value.split(separator: ":").compactMap { Int($0) }; return parts.count == 2 ? parts[0] * 60 + parts[1] : 0 }
}

private struct FamilyRingsDayEventRef: Identifiable { let eventID: String; let occurrenceDate: String; var id: String { eventID + occurrenceDate } }
private struct SchoolAgendaDetail: View {
    @Environment(\.dismiss) private var dismiss
    let item: AgendaItem
    var body: some View {
        NavigationStack {
            List {
                Text(item.title).font(Typography.title)
                Text(item.time ?? "All day")
                if let subtitle = item.subtitle { Text(subtitle) }
            }
            .navigationTitle("Calendar event")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
