import SwiftUI

/// The timed calendar surface for regular-width windows and compact landscape.
/// It keeps seven days visible at once while allowing vertical scrolling beyond
/// the useful daytime range. Phone portrait retains the separate agenda.
struct WeekCalendarView: View {
    @Environment(AppStore.self) private var store

    let events: [CalendarEvent]
    let familyEvents: [FamilyEvent]
    let homework: [HomeworkItem]
    var showKidLabels = false
    var compactLandscape = false
    var onAdd: ((Date, String?) -> Void)?

    @State private var weekStart = WeekCalendarMath.monday(containing: Date())
    @State private var eventDetailRef: WeekEventRef?

    private var timeAxisWidth: CGFloat { compactLandscape ? 42 : 50 }
    private var hourHeight: CGFloat { compactLandscape ? 44 : 56 }
    private var timelineHeight: CGFloat { 24 * hourHeight + 44 }
    private var days: [Date] { WeekCalendarMath.weekDates(startingAt: weekStart) }
    private var maxAllDayItemCount: Int {
        days.map { items(for: $0).filter { !$0.isTimed }.count }.max() ?? 0
    }
    private var hasAllDayItems: Bool { maxAllDayItemCount > 0 }
    private var allDayContentHeight: CGFloat {
        guard hasAllDayItems else { return 0 }
        let itemHeight = CGFloat(maxAllDayItemCount * 44)
        let spacing = CGFloat(max(0, maxAllDayItemCount - 1) * 3)
        return itemHeight + spacing + 8
    }
    private var weekItems: [WeekCalendarItem] {
        WeekCalendarData.items(events: events, familyEvents: familyEvents, homework: homework)
    }

    var body: some View {
        GeometryReader { proxy in
            VStack(spacing: compactLandscape ? Space.xs : Space.sm) {
                header
                allDayBand
                timeline(width: proxy.size.width)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .layoutPriority(1)
            .padding(.horizontal, Space.md)
            .padding(.top, compactLandscape ? 0 : Space.sm)
        }
        .background(ScreenBackground())
        .refreshable { await store.refreshDashboard() }
        .sheet(item: $eventDetailRef) { ref in
            EventDetailSheet(eventId: ref.eventId, occurrenceDate: ref.occurrenceDate)
        }
    }

    private var header: some View {
        HStack(spacing: Space.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(weekLabel)
                    .font(compactLandscape ? Typography.cardTitle : Typography.title)
                    .foregroundStyle(Palette.text)
                if !compactLandscape {
                    Text("Week calendar")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
            }
            Spacer(minLength: Space.sm)
            if onAdd != nil {
                Button { addForDisplayedWeek() } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Palette.onAccent)
                        .frame(width: 44, height: 44)
                        .background(Palette.accent, in: Circle())
                }
                .accessibilityLabel("New event")
                .accessibilityHint("Adds an event to the displayed week")
            }
            Button { shiftWeek(-1) } label: { navigationIcon("chevron.left") }
                .accessibilityLabel("Previous week")
            Button { weekStart = WeekCalendarMath.monday(containing: Date()) } label: {
                Text("Today")
                    .font(Typography.caption.weight(.bold))
                    .foregroundStyle(Palette.accent)
                    .padding(.horizontal, Space.md)
                    .frame(height: 36)
                    .background(Palette.accentSoft, in: Capsule())
                    .frame(minHeight: 44)
            }
            .accessibilityLabel("This week")
            Button { shiftWeek(1) } label: { navigationIcon("chevron.right") }
                .accessibilityLabel("Next week")
        }
    }

    private func navigationIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Palette.accent)
            .frame(width: 36, height: 36)
            .background(Palette.accentSoft, in: Circle())
            .frame(width: 44, height: 44)
    }

    private var allDayBand: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear
                    .frame(width: timeAxisWidth, height: 1)
                ForEach(days, id: \.self) { day in
                    dayHeader(day)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 38)
            .background(Palette.panel2)

            if hasAllDayItems {
                HStack(alignment: .top, spacing: 0) {
                    Text("ALL-DAY")
                        .font(Typography.mono(9, .bold))
                        .foregroundStyle(Palette.textSecond)
                        .frame(width: timeAxisWidth, height: allDayContentHeight, alignment: .topLeading)
                        .padding(.top, 5)
                    ForEach(days, id: \.self) { day in
                        allDayItems(for: day)
                            .frame(maxWidth: .infinity)
                            .frame(height: allDayContentHeight)
                            .padding(.horizontal, 2)
                    }
                }
                .background(Palette.panel)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .clipShape(RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                .strokeBorder(Palette.border, lineWidth: 1)
        )
    }

    private func dayHeader(_ date: Date) -> some View {
        let today = Calendar.current.isDateInToday(date)
        return VStack(spacing: 1) {
            Text(date.formatted(.dateTime.weekday(.abbreviated)))
                .font(Typography.caption.weight(.bold))
                .foregroundStyle(Palette.textSecond)
            Text(date.formatted(.dateTime.day()))
                .font(Typography.mono(13, today ? .bold : .semibold))
                .foregroundStyle(today ? Palette.onAccent : Palette.text)
                .frame(width: 23, height: 23)
                .background(today ? Palette.accent : Color.clear, in: Circle())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(date.formatted(.dateTime.weekday(.wide).month(.wide).day().year()))
    }

    @ViewBuilder
    private func allDayItems(for date: Date) -> some View {
        let items = items(for: date).filter { !$0.isTimed }
        if items.isEmpty {
            Color.clear
                .frame(maxWidth: .infinity, minHeight: allDayContentHeight)
                .accessibilityHidden(true)
        } else {
            VStack(alignment: .leading, spacing: 3) {
                ForEach(items) { item in
                    eventLabel(item, compact: true)
                }
            }
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .contain)
        }
    }

    private func timeline(width: CGFloat) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                ZStack(alignment: .topLeading) {
                    HStack(alignment: .top, spacing: 0) {
                        timeAxis
                            .frame(width: timeAxisWidth)
                        ForEach(days, id: \.self) { day in
                            WeekTimelineDayColumn(
                                date: day,
                                items: items(for: day),
                                hourHeight: hourHeight,
                                timelineHeight: timelineHeight,
                                showKidLabels: showKidLabels,
                                kids: store.kids,
                                onAdd: onAdd,
                                onFamilyEvent: openFamilyEvent
                            )
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .frame(minWidth: max(width - (Space.md * 2), 0), maxWidth: .infinity)
                    .frame(height: timelineHeight)

                    VStack(spacing: 0) {
                        Color.clear
                            .frame(height: CGFloat(WeekCalendarMath.initialHour) * hourHeight)
                        Color.clear
                            .frame(width: 1, height: 1)
                            .id("week-hour-8")
                        Spacer(minLength: 0)
                    }
                    .frame(width: 1, height: timelineHeight, alignment: .top)
                    .allowsHitTesting(false)
                }
                .padding(.bottom, Layout.tabBarClearance)
            }
            .scrollIndicators(.visible)
            .onAppear { scrollToInitialHour(proxy) }
            .onChange(of: weekStart) { _, _ in scrollToInitialHour(proxy) }
        }
    }

    private var timeAxis: some View {
        VStack(alignment: .trailing, spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                Text(WeekCalendarMath.hourLabel(hour))
                    .font(Typography.mono(10))
                    .foregroundStyle(Palette.textSecond)
                    .frame(height: hourHeight, alignment: .topTrailing)
                    .frame(maxWidth: .infinity, alignment: .topTrailing)
                    .padding(.trailing, 5)
            }
            Spacer(minLength: 44)
        }
        .frame(height: timelineHeight, alignment: .top)
    }

    private var weekLabel: String {
        let end = days.last ?? weekStart
        let startText = weekStart.formatted(.dateTime.month(.abbreviated).day())
        let endText = end.formatted(.dateTime.month(.abbreviated).day().year())
        return "\(startText)–\(endText)"
    }

    private func items(for date: Date) -> [WeekCalendarItem] {
        let key = DateFmt.ymd.string(from: date)
        return weekItems.filter { $0.dateKey == key }
    }

    private func shiftWeek(_ amount: Int) {
        if let shifted = Calendar.current.date(byAdding: .day, value: amount * 7, to: weekStart) {
            weekStart = WeekCalendarMath.monday(containing: shifted)
        }
    }

    private func addForDisplayedWeek() {
        let today = Date()
        let date = days.first(where: { Calendar.current.isDate($0, inSameDayAs: today) }) ?? weekStart
        onAdd?(date, nil)
    }

    private func scrollToInitialHour(_ proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo("week-hour-8", anchor: .top)
            }
        }
    }

    @ViewBuilder
    private func eventLabel(_ item: WeekCalendarItem, compact: Bool) -> some View {
        let label = WeekEventLabel(item: item, compact: compact, showKidLabels: showKidLabels, kids: store.kids)
        if item.familyEventID != nil {
            Button {
                openFamilyEvent(item)
            } label: {
                label
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens event details")
        } else {
            label
                .accessibilityHint("Read-only calendar item")
        }
    }

    private func openFamilyEvent(_ item: WeekCalendarItem) {
        guard let eventId = item.familyEventID else { return }
        eventDetailRef = WeekEventRef(
            id: "\(eventId)-\(item.occurrenceDate ?? item.dateKey)",
            eventId: eventId,
            occurrenceDate: item.occurrenceDate ?? item.dateKey
        )
    }
}

private struct WeekTimelineDayColumn: View {
    let date: Date
    let items: [WeekCalendarItem]
    let hourHeight: CGFloat
    let timelineHeight: CGFloat
    let showKidLabels: Bool
    let kids: [Kid]
    let onAdd: ((Date, String?) -> Void)?
    let onFamilyEvent: (WeekCalendarItem) -> Void

    private var timedItems: [WeekCalendarItem] { items.filter(\.isTimed) }
    private var placements: [String: WeekEventPlacement] {
        WeekCalendarMath.placements(for: timedItems.compactMap { item in
            guard let start = item.startMinute, let end = item.endMinute else { return nil }
            return WeekTimedInterval(id: item.id, startMinute: start, endMinute: end)
        })
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                Palette.panel
                    .contentShape(Rectangle())
                    .overlay(alignment: .top) {
                        VStack(spacing: 0) {
                            ForEach(0...24, id: \.self) { hour in
                                Rectangle()
                                    .fill(Palette.grid)
                                    .frame(height: 1)
                                    .offset(y: CGFloat(hour) * hourHeight)
                            }
                        }
                        .allowsHitTesting(false)
                    }
                if onAdd != nil {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture(count: 1, coordinateSpace: .local) { point in
                            let slot = WeekCalendarMath.selectedSlot(
                                date: date,
                                offset: point.y,
                                hourHeight: hourHeight
                            )
                            onAdd?(slot.date, WeekCalendarMath.timeString(for: slot.minute))
                        }
                        .accessibilityLabel("Empty time slots for \(date.formatted(.dateTime.weekday(.wide).month(.wide).day()))")
                        .accessibilityHint("Double tap an empty time to create a new event")
                }
                ForEach(timedItems) { item in
                    if let placement = placements[item.id], let start = item.startMinute, let end = item.endMinute {
                        let y = WeekCalendarMath.offset(for: start, hourHeight: hourHeight)
                        let naturalHeight = WeekCalendarMath.durationHeight(start: start, end: end, hourHeight: hourHeight)
                        let height = min(max(44, naturalHeight), max(44, timelineHeight - y - 2))
                        let columnWidth = proxy.size.width / CGFloat(placement.columnCount)
                        timedEventBlock(
                            item,
                            width: max(24, columnWidth - 5),
                            height: height,
                            x: CGFloat(placement.column) * columnWidth + 2,
                            y: y,
                            onFamilyEvent: onFamilyEvent
                        )
                    }
                }
            }
            .frame(height: timelineHeight)
        }
        .frame(height: timelineHeight)
    }

    @ViewBuilder
    private func timedEventBlock(
        _ item: WeekCalendarItem,
        width: CGFloat,
        height: CGFloat,
        x: CGFloat,
        y: CGFloat,
        onFamilyEvent: @escaping (WeekCalendarItem) -> Void
    ) -> some View {
        let label = WeekEventLabel(item: item, compact: false, showKidLabels: showKidLabels, kids: kids)
        if item.familyEventID != nil {
            Button { onFamilyEvent(item) } label: { label }
                .buttonStyle(.plain)
                .frame(width: width, height: height, alignment: .topLeading)
                .offset(x: x, y: y)
                .accessibilityHint("Opens event details")
        } else {
            label
                .frame(width: width, height: height, alignment: .topLeading)
                .offset(x: x, y: y)
                .overlay {
                    // Consume taps on read-only blocks so they cannot fall
                    // through to the empty-slot creator beneath them.
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture {}
                }
                .accessibilityHint("Read-only calendar item")
        }
    }
}

private struct WeekEventLabel: View {
    let item: WeekCalendarItem
    let compact: Bool
    let showKidLabels: Bool
    let kids: [Kid]

    private var color: Color {
        Agenda.kidColor(item.kidID, kids: kids)
            ?? (item.category == "trip" ? Palette.teal
                : (item.kind == .homework ? Palette.blue
                    : (item.kind == .deadline ? Palette.coral : Palette.accent)))
    }

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(color)
                .frame(width: compact ? 2.5 : 3)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .lineLimit(compact ? 1 : 3)
                    .minimumScaleFactor(0.75)
                if !compact, let time = item.displayTime {
                    Text(time)
                        .font(Typography.mono(9))
                        .foregroundStyle(Palette.textSecond)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, compact ? 3 : 5)
        .padding(.horizontal, compact ? 3 : 4)
        .frame(maxWidth: .infinity, minHeight: compact ? 44 : nil, maxHeight: .infinity, alignment: .topLeading)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .strokeBorder(color.opacity(0.28), lineWidth: 1)
        )
        .strikethrough(item.isDone, color: Palette.textSecond)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var title: String {
        let recurring = item.isRecurring ? "↻ " : ""
        let kid = showKidLabels ? (Agenda.kidName(item.kidID, kids: kids).map { "\($0): " } ?? "") : ""
        return recurring + kid + item.title
    }

    private var accessibilityText: String {
        let day = DateFmt.ymd.date(from: item.dateKey)?.formatted(.dateTime.weekday(.wide).month(.wide).day()) ?? item.dateKey
        let time = item.displayTime.map { " at \($0)" } ?? " all day"
        return "\(title), \(day)\(time)"
    }
}

private struct WeekEventRef: Identifiable {
    let id: String
    let eventId: String
    let occurrenceDate: String
}

struct WeekCalendarItem: Identifiable {
    enum Kind: Equatable { case event, deadline, homework, family }

    let id: String
    let title: String
    let dateKey: String
    let startMinute: Int?
    let endMinute: Int?
    let kind: Kind
    let subtitle: String?
    let kidID: String?
    let category: String?
    let isDone: Bool
    let isRecurring: Bool
    let familyEventID: String?
    let occurrenceDate: String?

    var isTimed: Bool { startMinute != nil && endMinute != nil }
    var displayTime: String? {
        guard let startMinute else { return nil }
        return WeekCalendarMath.timeString(for: startMinute)
    }
}

enum WeekCalendarData {
    static func items(
        events: [CalendarEvent],
        familyEvents: [FamilyEvent],
        homework: [HomeworkItem]
    ) -> [WeekCalendarItem] {
        events.compactMap(calendarItem(from:))
            + familyEvents.flatMap(familyItems(from:))
            + homework.map(homeworkItem(from:))
    }

    private static func calendarItem(from event: CalendarEvent) -> WeekCalendarItem? {
        let raw = event.start ?? ""
        let allDay = (event.allDay ?? false) || raw.count <= 10
        let kind: WeekCalendarItem.Kind = (event.isDeadline ?? false) || event.type == "deadline" ? .deadline : .event
        guard !raw.isEmpty else { return nil }
        if allDay {
            return WeekCalendarItem(
                id: "ev-\(event.id)", title: event.title, dateKey: String(raw.prefix(10)),
                startMinute: nil, endMinute: nil, kind: kind, subtitle: event.feedLabel ?? event.location,
                kidID: event.kidId, category: nil, isDone: false, isRecurring: false,
                familyEventID: nil, occurrenceDate: nil
            )
        }
        guard let startDate = Agenda.parseISO(raw) else { return nil }
        let dateKey = DateFmt.ymd.string(from: startDate)
        let startMinute = minute(from: startDate)
        let endMinute = event.end.flatMap { Agenda.parseISO($0) }.map { endDate in
            let endKey = DateFmt.ymd.string(from: endDate)
            return endKey == dateKey ? max(startMinute + 30, minute(from: endDate)) : 1440
        } ?? startMinute + 60
        return WeekCalendarItem(
            id: "ev-\(event.id)", title: event.title, dateKey: dateKey,
            startMinute: startMinute, endMinute: min(1440, endMinute), kind: kind,
            subtitle: event.feedLabel ?? event.location, kidID: event.kidId, category: nil,
            isDone: false, isRecurring: false, familyEventID: nil, occurrenceDate: nil
        )
    }

    private static func familyItems(from event: FamilyEvent) -> [WeekCalendarItem] {
        let startMinute = event.time.flatMap(parseMinute)
        let endMinute = startMinute.map { start in
            event.endTime.flatMap(parseMinute).map { max(start + 30, $0) } ?? start + 60
        }
        var result = [familyItem(event, dateKey: event.date, startMinute: startMinute, endMinute: endMinute)]
        guard let endDate = event.endDate, endDate > event.date,
              let startDate = DateFmt.ymd.date(from: event.date),
              let finalDate = DateFmt.ymd.date(from: endDate) else { return result }
        var date = startDate
        for _ in 0..<120 {
            guard let next = Calendar.current.date(byAdding: .day, value: 1, to: date), next <= finalDate else { break }
            date = next
            result.append(familyItem(event, dateKey: DateFmt.ymd.string(from: date), startMinute: nil, endMinute: nil))
        }
        return result
    }

    private static func familyItem(_ event: FamilyEvent, dateKey: String, startMinute: Int?, endMinute: Int?) -> WeekCalendarItem {
        WeekCalendarItem(
            id: "fe-\(event.id)-\(dateKey)", title: event.title, dateKey: dateKey,
            startMinute: startMinute, endMinute: endMinute, kind: .family,
            subtitle: event.notes, kidID: event.kidId, category: event.category,
            isDone: false, isRecurring: event.isRecurring, familyEventID: event.id,
            occurrenceDate: dateKey
        )
    }

    private static func homeworkItem(from homework: HomeworkItem) -> WeekCalendarItem {
        let startMinute = homework.dueTime.flatMap(parseMinute)
        return WeekCalendarItem(
            id: "hw-\(homework.id)", title: homework.title, dateKey: homework.dueDate,
            startMinute: startMinute, endMinute: startMinute.map { $0 + 60 }, kind: .homework,
            subtitle: homework.subject ?? "Homework", kidID: homework.kidId, category: nil,
            isDone: homework.isDone, isRecurring: false, familyEventID: nil, occurrenceDate: nil
        )
    }

    private static func parseMinute(_ value: String) -> Int? {
        guard let date = EventFmt.hm.date(from: value) else { return nil }
        return minute(from: date)
    }

    private static func minute(from date: Date) -> Int {
        let calendar = Calendar.current
        return calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
    }
}

struct WeekTimedInterval: Identifiable, Equatable {
    let id: String
    let startMinute: Int
    let endMinute: Int
}

struct WeekEventPlacement: Equatable {
    let column: Int
    let columnCount: Int
}

struct WeekCalendarSlot: Equatable {
    let date: Date
    let minute: Int
}

enum WeekCalendarMath {
    static let initialHour = 8

    static func monday(containing date: Date, calendar: Calendar = .current) -> Date {
        let local = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: local)
        let daysSinceMonday = (weekday + 5) % 7
        return calendar.date(byAdding: .day, value: -daysSinceMonday, to: local) ?? local
    }

    static func weekDates(startingAt monday: Date, calendar: Calendar = .current) -> [Date] {
        (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: calendar.startOfDay(for: monday)) }
    }

    static func offset(for minute: Int, hourHeight: CGFloat) -> CGFloat {
        CGFloat(max(0, min(1440, minute))) / 60 * hourHeight
    }

    static func minute(for offset: CGFloat, hourHeight: CGFloat, snap: Int = 30) -> Int {
        let raw = max(0, min(1439, offset / hourHeight * 60))
        let snapped = Int((raw / CGFloat(snap)).rounded()) * snap
        return min(1430, max(0, snapped))
    }

    static func selectedSlot(
        date: Date,
        offset: CGFloat,
        hourHeight: CGFloat,
        snap: Int = 30,
        calendar: Calendar = .current
    ) -> WeekCalendarSlot {
        let minute = self.minute(for: offset, hourHeight: hourHeight, snap: snap)
        let day = calendar.startOfDay(for: date)
        let selectedDate = calendar.date(byAdding: .minute, value: minute, to: day) ?? day
        return WeekCalendarSlot(date: selectedDate, minute: minute)
    }

    static func durationHeight(start: Int, end: Int, hourHeight: CGFloat) -> CGFloat {
        CGFloat(max(30, min(1440, end) - max(0, start))) / 60 * hourHeight
    }

    static func timeString(for minute: Int) -> String {
        let hour = max(0, min(23, minute / 60))
        let minutePart = max(0, min(59, minute % 60))
        return String(format: "%02d:%02d", hour, minutePart)
    }

    static func hourLabel(_ hour: Int) -> String {
        let h = hour == 0 ? 12 : (hour > 12 ? hour - 12 : hour)
        return "\(h)\(hour < 12 ? "a" : "p")"
    }

    static func placements(for intervals: [WeekTimedInterval]) -> [String: WeekEventPlacement] {
        let valid = intervals.filter { $0.endMinute > $0.startMinute }
        var result: [String: WeekEventPlacement] = [:]
        var remaining = Set(valid.map(\.id))

        while let firstID = remaining.first,
              let firstIndex = valid.firstIndex(where: { $0.id == firstID }) {
            var component = [firstIndex]
            remaining.remove(firstID)
            var cursor = 0
            while cursor < component.count {
                for candidate in valid.indices where remaining.contains(valid[candidate].id) {
                    if component.contains(where: { overlaps(valid[$0], valid[candidate]) }) {
                        component.append(candidate)
                        remaining.remove(valid[candidate].id)
                    }
                }
                cursor += 1
            }

            let sorted = component.map { valid[$0] }.sorted {
                ($0.startMinute, $0.endMinute, $0.id) < ($1.startMinute, $1.endMinute, $1.id)
            }
            var columns: [[WeekTimedInterval]] = []
            for interval in sorted {
                var column = 0
                while column < columns.count && columns[column].contains(where: { overlaps($0, interval) }) {
                    column += 1
                }
                if column == columns.count { columns.append([]) }
                columns[column].append(interval)
            }
            for interval in sorted {
                let column = columns.firstIndex(where: { $0.contains(interval) }) ?? 0
                result[interval.id] = WeekEventPlacement(column: column, columnCount: columns.count)
            }
        }
        return result
    }

    private static func overlaps(_ lhs: WeekTimedInterval, _ rhs: WeekTimedInterval) -> Bool {
        lhs.startMinute < rhs.endMinute && rhs.startMinute < lhs.endMinute
    }
}
