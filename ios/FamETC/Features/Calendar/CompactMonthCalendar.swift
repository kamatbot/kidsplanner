import SwiftUI

/// iPhone-portrait Month in the soft layout (docs/design/soft-rings/IOS-BRIEF.md
/// §4): a Monday-first grid of soft day cells with one dot per owner (child
/// colour, violet for family), then the selected day's events and homework.
/// Days outside the month are hatched and not tappable. iPad and landscape keep
/// `MonthCalendarView` / `WeekCalendarView`.
struct CompactMonthCalendar: View {
    @Environment(AppStore.self) private var store
    let events: [CalendarEvent]
    let familyEvents: [FamilyEvent]
    let homework: [HomeworkItem]
    var showKidLabels = false
    @Binding var selectedDayKey: String
    var onAdd: ((Date) -> Void)?
    /// Audience chips and the Week | Month pill, scrolled with the content.
    var accessory: AnyView? = nil

    @State private var monthStart = MonthCalendarView.firstOfMonth(Date())
    @State private var eventRef: TodayEventRef?
    @State private var schoolDetail: AgendaItem?

    private let calendar = Calendar.current

    private static let monthTitle: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMMMyyyy")
        return formatter
    }()
    private static let dayTitle: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEEEdMMMM")
        return formatter
    }()
    /// Monday-first short weekday names for the header row.
    private static let weekdayHeaders: [String] = {
        let symbols = Calendar.current.shortStandaloneWeekdaySymbols
        return Array(symbols.dropFirst()) + Array(symbols.prefix(1))
    }()

    private struct MonthCell: Identifiable {
        let id: Int
        let key: String?
        let day: Int
    }

    private var selectedDate: Date { DateFmt.ymd.date(from: selectedDayKey) ?? Date() }

    private var cells: [MonthCell] {
        let leading = (calendar.component(.weekday, from: monthStart) + 5) % 7
        let count = calendar.range(of: .day, in: .month, for: monthStart)?.count ?? 30
        var result = (0..<leading).map { MonthCell(id: $0, key: nil, day: 0) }
        for offset in 0..<count {
            let date = calendar.date(byAdding: .day, value: offset, to: monthStart) ?? monthStart
            result.append(MonthCell(id: leading + offset, key: DateFmt.ymd.string(from: date), day: offset + 1))
        }
        let trailing = (7 - result.count % 7) % 7
        result += (0..<trailing).map { MonthCell(id: leading + count + $0, key: nil, day: 0) }
        return result
    }

    var body: some View {
        let byDay = Agenda.itemsByDay(events: events, familyEvents: familyEvents, homework: homework)
        let selectedItems = byDay[selectedDayKey] ?? []
        SurfaceScaffold(title: "Calendar", trailing: { addButton }) {
            if let accessory { accessory }
            monthHeader
            weekdayRow
            grid(byDay)
            dayHeader
            dayContent(selectedItems)
        }
        .refreshable { await store.refreshDashboard() }
        .onAppear { syncMonth() }
        .onChange(of: selectedDayKey) { _, _ in syncMonth() }
        .sheet(item: $eventRef) { EventDetailSheet(eventId: $0.eventID, occurrenceDate: $0.occurrenceDate) }
        .sheet(item: $schoolDetail) { SchoolAgendaDetail(item: $0) }
    }

    @ViewBuilder private var addButton: some View {
        if let onAdd {
            CircleIconButton(systemImage: "plus", label: "New event", hint: "Add an event on the selected day") {
                onAdd(selectedDate)
            }
        }
    }

    private var monthHeader: some View {
        HStack(spacing: Space.sm) {
            Text(Self.monthTitle.string(from: monthStart))
                .font(Typography.sectionTitle)
                .foregroundStyle(Palette.frInk)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Space.sm)
            CircleIconButton(systemImage: "chevron.left", label: "Previous month") { shiftMonth(-1) }
            CircleIconButton(systemImage: "chevron.right", label: "Next month") { shiftMonth(1) }
        }
    }

    private var weekdayRow: some View {
        HStack(spacing: 6) {
            ForEach(Array(Self.weekdayHeaders.enumerated()), id: \.offset) { _, name in
                Text(name)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.frInk2)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }

    private func grid(_ byDay: [String: [AgendaItem]]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 7), spacing: 8) {
            ForEach(cells) { cell in
                if let key = cell.key {
                    dayCell(key: key, day: cell.day, items: byDay[key] ?? [])
                } else {
                    HatchedDayCell()
                }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Self.monthTitle.string(from: monthStart))
    }

    private func dayCell(key: String, day: Int, items: [AgendaItem]) -> some View {
        let selected = key == selectedDayKey
        let isToday = key == Agenda.todayKey()
        let dots = ownerDots(items)
        return Button {
            Haptics.selection()
            selectedDayKey = key
        } label: {
            VStack(spacing: 4) {
                Text("\(day)")
                    .font(Theme.font(15, weight: selected || isToday ? .bold : .medium, relativeTo: .body))
                    .monospacedDigit()
                    .foregroundStyle(selected ? Palette.frOnYou : (isToday ? Palette.frYouInk : Palette.frInk))
                HStack(spacing: 3) {
                    ForEach(Array(dots.enumerated()), id: \.offset) { _, color in
                        Circle()
                            .fill(selected ? Palette.frOnYou : color)
                            .frame(width: 5, height: 5)
                    }
                }
                .frame(height: 5)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(selected ? Palette.frYou : Palette.frCard,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isToday && !selected ? Palette.frYou : Color.clear, lineWidth: 1.5)
            )
            .shadow(color: selected ? Palette.frYou.opacity(0.3) : Color.adaptive(Color(hex: 0x101828, alpha: 0.05), .clear),
                    radius: selected ? 8 : 3, y: selected ? 5 : 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(spokenDay(key: key, count: items.count, isToday: isToday))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    @ViewBuilder private var dayHeader: some View {
        let title = Self.dayTitle.string(from: selectedDate)
        if let onAdd {
            SectionHeader(title: title, actionTitle: "Add", actionSystemImage: "plus",
                          actionIdentifier: "calendar.day.add") { onAdd(selectedDate) }
        } else {
            SectionHeader(title: title)
        }
    }

    @ViewBuilder private func dayContent(_ items: [AgendaItem]) -> some View {
        if items.isEmpty {
            Card(padding: Space.lg) {
                Text("Nothing on this day.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.frInk2)
            }
        } else {
            let featured = items.first { $0.kind != .homework }
            if let featured {
                Button { open(featured) } label: {
                    EventArtCard(title: featured.title, detail: cardDetail(featured), kid: kid(for: featured),
                                 activity: EventArt.activity(title: featured.title, subtitle: featured.subtitle),
                                 minHeight: 168)
                }
                .buttonStyle(PressableStyle())
                .accessibilityHint("Opens the event")
            }
            let rest = items.filter { $0.id != featured?.id }
            if !rest.isEmpty {
                Card {
                    VStack(spacing: 0) {
                        ForEach(rest) { item in
                            row(item)
                            if item.id != rest.last?.id { Divider().overlay(Palette.border) }
                        }
                    }
                }
            }
        }
    }

    /// Homework rows keep AgendaRow's own done control, so they are never
    /// wrapped in a second button; events open their detail.
    @ViewBuilder private func row(_ item: AgendaItem) -> some View {
        if item.kind == .homework {
            AgendaRow(item: item, showKidLabel: showKidLabels)
        } else {
            Button { open(item) } label: { AgendaRow(item: item, showKidLabel: showKidLabels) }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the event")
        }
    }

    private func cardDetail(_ item: AgendaItem) -> String {
        var parts = [item.time ?? "All day"]
        if item.familyEvent == nil, let place = item.subtitle, !place.isEmpty { parts.append(place) }
        return parts.joined(separator: " · ")
    }

    private func kid(for item: AgendaItem) -> Kid? {
        guard let id = item.kidId else { return nil }
        return store.kids.first { $0.id == id }
    }

    private func ownerDots(_ items: [AgendaItem]) -> [Color] {
        var owners: [String] = []
        var dots: [Color] = []
        for item in items {
            let owner = item.kidId ?? "family"
            guard !owners.contains(owner) else { continue }
            owners.append(owner)
            dots.append(Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.frYou)
            if dots.count == 3 { break }
        }
        return dots
    }

    private func spokenDay(key: String, count: Int, isToday: Bool) -> String {
        let date = DateFmt.ymd.date(from: key).map { Self.dayTitle.string(from: $0) } ?? key
        let items = count == 0 ? "nothing planned" : "\(count) item\(count == 1 ? "" : "s")"
        return "\(date)\(isToday ? ", today" : ""), \(items)"
    }

    private func open(_ item: AgendaItem) {
        if let event = item.familyEvent {
            eventRef = TodayEventRef(eventID: event.id, occurrenceDate: item.dayKey)
        } else {
            schoolDetail = item
        }
    }

    private func syncMonth() {
        let first = MonthCalendarView.firstOfMonth(selectedDate)
        if first != monthStart { monthStart = first }
    }

    /// Moving to another month selects today when it is in that month,
    /// otherwise the first day, so the list below always matches the grid.
    private func shiftMonth(_ delta: Int) {
        guard let next = calendar.date(byAdding: .month, value: delta, to: monthStart) else { return }
        monthStart = next
        let today = Date()
        let target = MonthCalendarView.firstOfMonth(today) == next ? today : next
        selectedDayKey = DateFmt.ymd.string(from: target)
    }
}

/// A day outside the displayed month: diagonal hatching, not interactive.
private struct HatchedDayCell: View {
    var body: some View {
        Canvas { context, size in
            var path = Path()
            var x: CGFloat = -size.height
            while x < size.width {
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                x += 7
            }
            context.stroke(path, with: .color(Palette.frRule), lineWidth: 1.2)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 48)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityHidden(true)
    }
}
