import SwiftUI

/// A full month calendar grid (like the web) for iPad + iPhone-landscape. Shows
/// school events, deadlines and homework as chips per day. Parents can DRAG a
/// homework chip onto another day to reschedule its due date (optimistic, via
/// AppStore.rescheduleHomework — the server ignores a kid's dueDate change, so
/// dragging is gated on isParent).
struct MonthCalendarView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    var onAdd: () -> Void
    @State private var monthAnchor = MonthCalendarView.firstOfMonth(Date())

    private let cal = Calendar.current
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 7)
    private var cellHeight: CGFloat { hSize == .regular ? 104 : 72 }

    private var monthEventCount: Int {
        gridDays.compactMap { $0 }
            .filter { cal.isDate($0, equalTo: monthAnchor, toGranularity: .month) }
            .reduce(0) { total, date in
                total + Agenda.items(on: DateFmt.ymd.string(from: date), events: store.events, familyEvents: store.familyEvents, homework: store.homework).count
            }
    }

    var body: some View {
        VStack(spacing: Space.md) {
            header
            weekdayRow
            ScrollView {
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(Array(gridDays.enumerated()), id: \.offset) { _, date in
                        if let date {
                            DayCell(date: date, key: DateFmt.ymd.string(from: date),
                                    dayNumber: cal.component(.day, from: date))
                                .frame(height: cellHeight)
                        } else {
                            Color.clear.frame(height: cellHeight)
                        }
                    }
                }
                .padding(.bottom, hSize == .compact ? Layout.tabBarClearance : Space.md)
            }
            MicroLabel(text: "\(monthEventCount) item\(monthEventCount == 1 ? "" : "s") this month")
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(Space.lg)
        .background(ScreenBackground())
        .refreshable { await store.refreshDashboard() }
    }

    private var header: some View {
        HStack {
            Text(monthAnchor.formatted(.dateTime.month(.wide).year()))
                .font(Typography.title).foregroundStyle(Palette.text)
            Spacer()
            Button(action: onAdd) {
                Image(systemName: "plus").font(.system(size: 15, weight: .bold)).foregroundStyle(Palette.onAccent)
                    .frame(width: 36, height: 36).background(Palette.accent, in: Circle())
            }
            .accessibilityLabel("New event")
            Button { shift(-1) } label: { chevron("chevron.left") }
            Button { monthAnchor = Self.firstOfMonth(Date()) } label: {
                Text("Today").font(Typography.caption.weight(.bold)).foregroundStyle(Palette.accent)
                    .padding(.horizontal, Space.md).padding(.vertical, 7)
                    .background(Palette.accentSoft, in: Capsule())
            }
            Button { shift(1) } label: { chevron("chevron.right") }
        }
    }
    private func chevron(_ symbol: String) -> some View {
        Image(systemName: symbol).font(.system(size: 15, weight: .bold)).foregroundStyle(Palette.accent)
            .frame(width: 36, height: 36).background(Palette.accentSoft, in: Circle())
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
    @State private var targeted = false

    private var items: [AgendaItem] { Agenda.items(on: key, events: store.events, familyEvents: store.familyEvents, homework: store.homework) }
    private var isToday: Bool { key == Agenda.todayKey() }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(dayNumber)")
                .font(Typography.mono(12, isToday ? .heavy : .semibold))
                .foregroundStyle(isToday ? Palette.onAccent : Palette.text)
                .frame(width: 21, height: 21)
                .background(isToday ? Palette.accent : Color.clear, in: Circle())
            ForEach(items.prefix(3)) { chip($0) }
            if items.count > 3 {
                Text("+\(items.count - 3)").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.textSecond)
            }
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
    }

    @ViewBuilder private func chip(_ item: AgendaItem) -> some View {
        // Kid-color bar when the item is tied to a specific kid (matches the
        // Today schedule + canvas-1b), otherwise falls back to a kind color.
        let color: Color = Agenda.kidColor(item.kidId, kids: store.kids)
            ?? (item.kind == .homework ? Palette.blue : (item.kind == .deadline ? Palette.coral : Palette.accent))
        let label = HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 1, style: .continuous).fill(color).frame(width: 2.5)
            Text(item.title)
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
        } else {
            label
        }
    }
}
