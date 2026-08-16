import SwiftUI

/// A full month calendar grid (like the web) for iPad + iPhone-landscape. Shows
/// school events, deadlines and homework as chips per day. Parents can DRAG a
/// homework chip onto another day to reschedule its due date (optimistic, via
/// AppStore.rescheduleHomework — the server ignores a kid's dueDate change, so
/// dragging is gated on isParent).
struct MonthCalendarView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    let events: [CalendarEvent]
    let familyEvents: [FamilyEvent]
    let homework: [HomeworkItem]
    var showKidLabels = false
    var compactLandscape = false
    var onAdd: (() -> Void)?
    @State private var monthAnchor = MonthCalendarView.firstOfMonth(Date())

    private let cal = Calendar.current
    private var gridSpacing: CGFloat { compactLandscape ? Space.xs : 6 }
    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: gridSpacing), count: 7)
    }
    private var weekCount: Int { max(1, gridDays.count / 7) }

    private var monthEventCount: Int {
        gridDays.compactMap { $0 }
            .filter { cal.isDate($0, equalTo: monthAnchor, toGranularity: .month) }
            .reduce(0) { total, date in
                total + Agenda.items(on: DateFmt.ymd.string(from: date), events: events, familyEvents: familyEvents, homework: homework).count
            }
    }

    var body: some View {
        GeometryReader { proxy in
            VStack(spacing: compactLandscape ? Space.xs : Space.md) {
                header
                    .frame(height: 44)
                weekdayRow
                    .frame(height: 16)
                ScrollView {
                    LazyVGrid(columns: columns, spacing: gridSpacing) {
                        ForEach(Array(gridDays.enumerated()), id: \.offset) { _, date in
                            if let date {
                                DayCell(date: date, key: DateFmt.ymd.string(from: date),
                                        dayNumber: cal.component(.day, from: date),
                                        events: events, familyEvents: familyEvents, homework: homework,
                                        showKidLabels: showKidLabels,
                                        maxVisibleItems: compactLandscape ? 1 : 3)
                                    .frame(height: cellHeight(availableHeight: proxy.size.height))
                            } else {
                                Color.clear.frame(height: cellHeight(availableHeight: proxy.size.height))
                            }
                        }
                    }
                    .padding(.bottom, compactLandscape || hSize == .compact ? Layout.tabBarClearance : Space.md)
                }
                if !compactLandscape {
                    MicroLabel(text: "\(monthEventCount) item\(monthEventCount == 1 ? "" : "s") this month")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, compactLandscape ? Space.md : Space.lg)
            .padding(.vertical, compactLandscape ? Space.xs : Space.lg)
        }
        .background(ScreenBackground())
        .refreshable { await store.refreshDashboard() }
    }

    private func cellHeight(availableHeight: CGFloat) -> CGFloat {
        guard compactLandscape else { return hSize == .regular ? 104 : 72 }
        return Self.compactCellHeight(
            availableHeight: availableHeight,
            weekCount: weekCount,
            gridSpacing: gridSpacing
        )
    }

    static func compactCellHeight(
        availableHeight: CGFloat,
        weekCount: Int,
        gridSpacing: CGFloat = Space.xs
    ) -> CGFloat {
        let fixedHeight = 44 + 16 + (Space.xs * 2) + (Space.xs * 2) + Layout.tabBarClearance
        let rowGaps = CGFloat(max(0, weekCount - 1)) * gridSpacing
        let availableRows = availableHeight - fixedHeight - rowGaps
        return min(72, max(52, floor(availableRows / CGFloat(weekCount))))
    }

    private var header: some View {
        HStack {
            Text(monthAnchor.formatted(.dateTime.month(.wide).year()))
                .font(compactLandscape ? Typography.cardTitle : Typography.title)
                .foregroundStyle(Palette.text)
            Spacer()
            if let onAdd {
                Button(action: onAdd) {
                    Image(systemName: "plus").font(.system(size: 15, weight: .bold)).foregroundStyle(Palette.onAccent)
                        .frame(width: 44, height: 44).background(Palette.accent, in: Circle())
                }
                .accessibilityLabel("New event")
            }
            Button { shift(-1) } label: { chevron("chevron.left") }
            Button { monthAnchor = Self.firstOfMonth(Date()) } label: {
                Text("Today").font(Typography.caption.weight(.bold)).foregroundStyle(Palette.accent)
                    .padding(.horizontal, Space.md)
                    .frame(height: 36)
                    .background(Palette.accentSoft, in: Capsule())
                    .frame(minHeight: 44)
            }
            Button { shift(1) } label: { chevron("chevron.right") }
        }
    }
    private func chevron(_ symbol: String) -> some View {
        Image(systemName: symbol).font(.system(size: 15, weight: .bold)).foregroundStyle(Palette.accent)
            .frame(width: 36, height: 36).background(Palette.accentSoft, in: Circle())
            .frame(width: 44, height: 44)
    }

    private var weekdayRow: some View {
        HStack(spacing: 6) {
            ForEach(weekdaySymbols.indices, id: \.self) { i in
                Text(weekdaySymbols[i]).font(Typography.caption.weight(.bold))
                    .foregroundStyle(Palette.textSecond).frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: date math

    private var weekdaySymbols: [String] {
        let syms = cal.veryShortWeekdaySymbols
        let start = cal.firstWeekday - 1
        return Array(syms[start...] + syms[..<start])
    }
    private var gridDays: [Date?] {
        let first = monthAnchor
        let numDays = cal.range(of: .day, in: .month, for: first)?.count ?? 30
        let firstWeekday = cal.component(.weekday, from: first)
        let leading = (firstWeekday - cal.firstWeekday + 7) % 7
        var days: [Date?] = Array(repeating: nil, count: leading)
        for d in 0..<numDays { days.append(cal.date(byAdding: .day, value: d, to: first)) }
        while days.count % 7 != 0 { days.append(nil) }
        return days
    }
    private func shift(_ n: Int) {
        if let d = cal.date(byAdding: .month, value: n, to: monthAnchor) { monthAnchor = Self.firstOfMonth(d) }
    }
    static func firstOfMonth(_ d: Date) -> Date {
        let c = Calendar.current
        return c.date(from: c.dateComponents([.year, .month], from: d)) ?? d
    }
}

// MARK: - One day cell (drop target + chips)

private struct DayCell: View {
    @Environment(AppStore.self) private var store
    let date: Date
    let key: String
    let dayNumber: Int
    let events: [CalendarEvent]
    let familyEvents: [FamilyEvent]
    let homework: [HomeworkItem]
    let showKidLabels: Bool
    let maxVisibleItems: Int
    @State private var targeted = false
    @State private var eventDetailRef: DayEventRef?

    private var items: [AgendaItem] { Agenda.items(on: key, events: events, familyEvents: familyEvents, homework: homework) }
    private var isToday: Bool { key == Agenda.todayKey() }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 2) {
                Text("\(dayNumber)")
                    .font(Typography.mono(12, isToday ? .heavy : .semibold))
                    .foregroundStyle(isToday ? Palette.onAccent : Palette.text)
                    .frame(width: 21, height: 21)
                    .background(isToday ? Palette.accent : Color.clear, in: Circle())
                Spacer(minLength: 0)
                if items.count > maxVisibleItems {
                    Text("+\(items.count - maxVisibleItems)")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Palette.textSecond)
                }
            }
            ForEach(items.prefix(maxVisibleItems)) { chip($0) }
            Spacer(minLength: 0)
        }
        .padding(4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(targeted ? Palette.accentSoft : Palette.panel, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(isToday ? Palette.accent : Palette.border, lineWidth: isToday ? 2 : 1)
        )
        .dropDestination(for: String.self) { ids, _ in
            guard store.isParent, let id = ids.first else { return false }
            Haptics.selection()
            Task { await store.rescheduleHomework(id, to: key) }
            return true
        } isTargeted: { targeted = $0 }
        .sheet(item: $eventDetailRef) { ref in EventDetailSheet(eventId: ref.eventId, occurrenceDate: ref.occurrenceDate) }
    }

    @ViewBuilder private func chip(_ item: AgendaItem) -> some View {
        // Kid-color bar when the item is tied to a specific kid (matches the
        // Today schedule + canvas-1b), otherwise falls back to a kind color.
        // Trips (docs/TRIPS-PLAN.md): read-only trip-derived events carry
        // `category == "trip"` — teal, matching AgendaRow's airplane icon.
        let color: Color = Agenda.kidColor(item.kidId, kids: store.kids)
            ?? (item.familyEvent?.category == "trip" ? Palette.teal
                : (item.kind == .homework ? Palette.blue : (item.kind == .deadline ? Palette.coral : Palette.accent)))
        let kidName = showKidLabels ? Agenda.kidName(item.kidId, kids: store.kids) : nil
        let titleText = (item.familyEvent?.isRecurring == true ? "↻ " : "")
            + (kidName.map { "\($0): " } ?? "") + item.title
        let label = HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 1, style: .continuous).fill(color).frame(width: 2.5)
            Text(titleText)
                .font(.system(size: 9, weight: .semibold))
                .lineLimit(1)
                .foregroundStyle(Palette.text)
                .strikethrough(item.homework?.isDone == true, color: Palette.textSecond)
        }
        .padding(.vertical, 2).padding(.trailing, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
        if item.kind == .homework, store.isParent, let hw = item.homework {
            label.draggable(hw.id)
        } else if let fe = item.familyEvent {
            Button {
                eventDetailRef = DayEventRef(id: "\(fe.id)-\(fe.date)", eventId: fe.id, occurrenceDate: fe.date)
            } label: { label }
            .buttonStyle(.plain)
        } else {
            label
        }
    }
}

/// Wrapper so a (series id, occurrence date) pair can drive `.sheet(item:)` —
/// occurrences of a recurring event share `id`, so the id alone isn't unique.
private struct DayEventRef: Identifiable {
    let id: String
    let eventId: String
    let occurrenceDate: String
}
