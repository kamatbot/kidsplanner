import SwiftUI

/// Calendar tab. Portrait iPad offers the full Month grid or timed Week view;
/// landscape uses the timed Week view directly so events stay legible at their
/// actual times. iPhone portrait offers the soft-layout compact Month (day
/// cells plus the selected day) or a seven-day agenda list for Week.
struct CalendarScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var showAddEvent = false
    @State private var addEventDate = Date()
    @State private var addEventTime: String?
    @State private var mode: CalendarMode = .month
    @State private var audience: CalendarAudience = .parents
    /// iPhone-portrait Month's selected day; Today's week strip sets it through
    /// `AppStore.pendingCalendarDayKey`.
    @State private var selectedDayKey = Agenda.todayKey()
    /// The same week-strip day for the iPad and landscape grids, which move to
    /// it once and clear it.
    @State private var gridFocusDayKey: String?

    private var displayData: CalendarDisplayData {
        CalendarDisplayData.resolve(
            audience: audience,
            isParent: store.isParent,
            events: store.events,
            familyEvents: store.familyEvents,
            homework: store.homework,
            kidScope: store.kidScope
        )
    }
    private var isTimetable: Bool { store.isParent && audience == .timetable }

    var body: some View {
        GeometryReader { proxy in
            let isLandscape = CalendarMode.isLandscape(width: proxy.size.width, height: proxy.size.height)
            let displayedMode = mode.resolved(isLandscape: isLandscape)
            let useGrid = hSize == .regular || isLandscape

            VStack(spacing: 0) {
                // iPhone portrait scrolls the audience chips and the Week | Month
                // pill with its content (`compactAccessory`); grids keep them fixed.
                // The grids keep one slim toolbar: audience chips on the left and
                // the Next 7 days homework pill in the otherwise empty right side,
                // so the week grid starts high enough to show the morning.
                if useGrid {
                    let showsWorkload = hSize == .regular
                    if isLandscape {
                        // Landscape: one row. Chips on the left, the homework
                        // pill in the otherwise empty right side.
                        if store.isParent || showsWorkload {
                            HStack(alignment: .center, spacing: Space.md) {
                                if store.isParent {
                                    CalendarAudienceBar(selection: $audience, kids: store.kids, compact: true)
                                } else {
                                    Spacer(minLength: 0)
                                }
                                if showsWorkload {
                                    HomeworkWorkloadPill(homework: displayData.homework)
                                        .fixedSize()
                                }
                            }
                            .padding(.horizontal, Space.md)
                            .padding(.top, Space.xs)
                            .padding(.bottom, Space.xs)
                        }
                    } else {
                        // Portrait: chips get the full width (an 11-inch iPad
                        // clipped Timetable), then the homework pill and the
                        // Week | Month switch share the second row.
                        if store.isParent {
                            CalendarAudienceBar(selection: $audience, kids: store.kids, compact: true)
                                .padding(.horizontal, Space.lg)
                                .padding(.top, Space.sm)
                        }
                        HStack(spacing: Space.md) {
                            if showsWorkload {
                                HomeworkWorkloadPill(homework: displayData.homework)
                                    .fixedSize()
                            }
                            Spacer(minLength: Space.sm)
                            modePill
                                .frame(width: 220)
                        }
                        .padding(.horizontal, Space.lg)
                        .padding(.top, Space.sm)
                    }
                }
                if store.isLoadingCalendar && store.events.isEmpty && store.familyEvents.isEmpty {
                    ProgressView("Loading your calendar…")
                        .font(Typography.body)
                        .padding(Space.lg)
                }
                if store.calendarError != nil {
                    VStack(alignment: .leading, spacing: Space.sm) {
                        Label("Calendar couldn't refresh", systemImage: "wifi.exclamationmark")
                            .font(Typography.cardTitle)
                        Text(store.events.isEmpty && store.familyEvents.isEmpty
                             ? "Your events couldn't be loaded. Check your connection and try again."
                             : "Saved events are still shown. Try again to check for changes.")
                            .font(Typography.body).foregroundStyle(Palette.textSecond)
                        Button("Retry calendar") { Task { await store.loadCalendarAndHomework(force: true) } }
                            .frame(minHeight: 44)
                            .disabled(store.isLoadingCalendar)
                            .accessibilityIdentifier("calendar.retry")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Space.lg)
                    .background(Palette.panel)
                }
                if store.homeworkError != nil {
                    HomeworkSyncErrorNotice(isRetrying: store.isLoadingHomework) {
                        Task { await store.loadCalendarAndHomework(force: true) }
                    }
                    .padding(.horizontal, hSize == .regular ? Space.lg : Space.md)
                    .padding(.top, Space.sm)
                }
                Group {
                    if store.events.isEmpty && store.familyEvents.isEmpty && store.homework.isEmpty
                        && (store.isLoadingCalendar || store.calendarError != nil) {
                        Spacer()
                    } else if useGrid && displayedMode == .month {
                        MonthCalendarView(
                            events: displayData.events,
                            familyEvents: displayData.familyEvents,
                            homework: displayData.homework,
                            showKidLabels: isTimetable,
                            compactLandscape: isLandscape,
                            onAdd: isTimetable ? nil : { presentAddEvent(date: Date()) },
                            focusDayKey: $gridFocusDayKey
                        )
                    } else if useGrid && displayedMode == .week {
                        WeekCalendarView(
                            events: displayData.events,
                            familyEvents: displayData.familyEvents,
                            homework: displayData.homework,
                            showKidLabels: isTimetable,
                            compactLandscape: isLandscape,
                            onAdd: isTimetable ? nil : presentAddEvent(date:time:),
                            focusDayKey: $gridFocusDayKey
                        )
                    } else if displayedMode == .month {
                        CompactMonthCalendar(
                            events: displayData.events,
                            familyEvents: displayData.familyEvents,
                            homework: displayData.homework,
                            showKidLabels: isTimetable,
                            selectedDayKey: $selectedDayKey,
                            onAdd: isTimetable ? nil : { presentAddEvent(date: $0) },
                            accessory: compactAccessory
                        )
                    } else {
                        CalendarAgendaList(
                            events: displayData.events,
                            familyEvents: displayData.familyEvents,
                            homework: displayData.homework,
                            showKidLabels: isTimetable,
                            includeCurrentWeek: isTimetable,
                            emptyTitle: isTimetable ? "No timetable lessons" : "Nothing on the calendar yet",
                            emptyDetail: isTimetable
                                ? "Imported lessons for your children will appear here after their school timetables sync."
                                : "School events and homework show up here. Subscribe to your school's calendar and add homework from Settings, then pull to refresh.",
                            onAdd: isTimetable ? nil : { presentAddEvent(date: Date()) },
                            days: 7,
                            accessory: compactAccessory
                        )
                    }
                }
            }
        }
        .background(ScreenBackground(glow: true))
        .sheet(isPresented: $showAddEvent) {
            AddEventSheet(initialDate: addEventDate, initialTime: addEventTime)
        }
        .onChange(of: store.kids.map(\.id)) { _, kidIDs in
            guard case let .kid(id) = audience, !kidIDs.contains(id) else { return }
            audience = .parents
        }
        .onAppear { consumePendingDay() }
        .onChange(of: store.pendingCalendarDayKey) { _, _ in consumePendingDay() }
    }

    /// Today's week strip handed over a day. iPhone portrait shows it in the
    /// compact Month; a regular-width Calendar keeps the chosen Week or Month
    /// and its grid moves to the day.
    private func consumePendingDay() {
        guard let key = store.pendingCalendarDayKey else { return }
        store.pendingCalendarDayKey = nil
        selectedDayKey = key
        gridFocusDayKey = key
        if hSize != .regular { mode = .month }
    }

    private var compactAccessory: AnyView {
        AnyView(
            VStack(alignment: .leading, spacing: Space.md) {
                if store.isParent {
                    CalendarAudienceBar(selection: $audience, kids: store.kids, compact: true)
                }
                modePill
            }
        )
    }

    private func presentAddEvent(date: Date, time: String? = nil) {
        addEventDate = date
        addEventTime = time
        showAddEvent = true
    }

    private var modePill: some View {
        PillSegmentedControl(label: "Calendar view", selection: $mode, options: CalendarMode.allCases,
                             title: { $0.label })
    }
}

enum CalendarAudience: Hashable {
    case parents
    case kid(String)
    case timetable
}

struct CalendarDisplayData {
    let events: [CalendarEvent]
    let familyEvents: [FamilyEvent]
    let homework: [HomeworkItem]

    static func resolve(
        audience: CalendarAudience,
        isParent: Bool,
        events: [CalendarEvent],
        familyEvents: [FamilyEvent],
        homework: [HomeworkItem],
        kidScope: String?
    ) -> CalendarDisplayData {
        if !isParent {
            guard let kidScope else {
                return CalendarDisplayData(events: [], familyEvents: [], homework: [])
            }
            return CalendarDisplayData(
                events: events.filter { $0.kidId == nil || $0.kidId == kidScope },
                familyEvents: familyEvents.filter { $0.kidId == nil || $0.kidId == kidScope },
                homework: homework
            )
        }

        switch audience {
        case .parents:
            return CalendarDisplayData(
                events: events.filter { !$0.isImportedTimetable },
                familyEvents: familyEvents.filter { !$0.isImportedTimetable },
                homework: homework
            )
        case let .kid(kidID):
            return CalendarDisplayData(
                events: events.filter { $0.kidId == nil || $0.kidId == kidID },
                familyEvents: familyEvents.filter { $0.kidId == nil || $0.kidId == kidID },
                homework: homework.filter { $0.kidId == nil || $0.kidId == kidID }
            )
        case .timetable:
            return CalendarDisplayData(
                events: events.filter(\.isImportedTimetable),
                familyEvents: familyEvents.filter(\.isImportedTimetable),
                homework: []
            )
        }
    }
}

// MARK: - Next 7 days workload

struct HomeworkWorkloadBucket: Identifiable {
    let dayKey: String
    let date: Date
    let assignments: [HomeworkItem]

    var id: String { dayKey }
    var knownEffortMinutes: Int {
        assignments.compactMap(\.effortMin).reduce(0) { $0 + max(0, $1) }
    }
    var knownEffortCount: Int { assignments.compactMap(\.effortMin).count }
    var hasCompleteEffortCoverage: Bool { knownEffortCount == assignments.count }
    var isHeavy: Bool { assignments.count >= 2 || knownEffortMinutes >= 90 }
}

struct HomeworkWorkloadRanking {
    enum Basis: Equatable {
        case completeEffortEstimates
        case assignmentCount
    }

    let bucket: HomeworkWorkloadBucket
    let basis: Basis
}

/// Pure workload bucketing: only open assignments inside the next seven local
/// calendar days are included. Empty days are omitted from the visual strip.
enum HomeworkWorkload {
    static func buckets(
        from homework: [HomeworkItem],
        startingAt startDate: Date = Date(),
        calendar: Calendar = .current
    ) -> [HomeworkWorkloadBucket] {
        let start = calendar.startOfDay(for: startDate)
        return (0..<7).compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: offset, to: start) else { return nil }
            let dayKey = DateFmt.ymd.string(from: date)
            let assignments = homework
                .filter { !$0.isDone && $0.dueDate == dayKey }
                .sorted { lhs, rhs in
                    let lhsTime = lhs.dueTime ?? "23:59"
                    let rhsTime = rhs.dueTime ?? "23:59"
                    if lhsTime != rhsTime { return lhsTime < rhsTime }
                    let titleOrder = lhs.title.localizedCaseInsensitiveCompare(rhs.title)
                    if titleOrder != .orderedSame { return titleOrder == .orderedAscending }
                    return lhs.id < rhs.id
                }
            guard !assignments.isEmpty else { return nil }
            return HomeworkWorkloadBucket(dayKey: dayKey, date: date, assignments: assignments)
        }
    }

    static func heaviest(in buckets: [HomeworkWorkloadBucket]) -> HomeworkWorkloadRanking? {
        let candidates = buckets.filter(\.isHeavy)
        guard !candidates.isEmpty else { return nil }

        let basis: HomeworkWorkloadRanking.Basis = candidates.allSatisfy(\.hasCompleteEffortCoverage)
            ? .completeEffortEstimates
            : .assignmentCount
        let bucket = candidates.max { lhs, rhs in
            switch basis {
            case .completeEffortEstimates where lhs.knownEffortMinutes != rhs.knownEffortMinutes:
                return lhs.knownEffortMinutes < rhs.knownEffortMinutes
            case .assignmentCount where lhs.assignments.count != rhs.assignments.count:
                return lhs.assignments.count < rhs.assignments.count
            default:
                return lhs.dayKey > rhs.dayKey
            }
        }
        return bucket.map { HomeworkWorkloadRanking(bucket: $0, basis: basis) }
    }
}

private struct HomeworkSyncErrorNotice: View {
    let isRetrying: Bool
    let retry: () -> Void

    var body: some View {
        HStack(spacing: Space.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Palette.warn)
                .accessibilityHidden(true)
            Text("Homework couldn’t refresh. Existing items remain visible.")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Space.sm)
            if isRetrying {
                ProgressView()
                    .controlSize(.small)
                    .tint(Palette.accent)
                    .accessibilityLabel("Retrying homework sync")
            }
            Button("Retry", action: retry)
                .font(Typography.caption.weight(.semibold))
                .foregroundStyle(Palette.accent)
                .frame(minWidth: 44, minHeight: 44)
                .buttonStyle(.plain)
                .disabled(isRetrying)
        }
        .padding(.horizontal, Space.md)
        .padding(.vertical, Space.sm)
        .background(Palette.warn.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Palette.warn.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

/// iPad Calendar's "Next 7 days" homework summary as one pill in the toolbar.
/// It used to be a full-width card above the week grid, which pushed the
/// grid's morning hours off screen. The pill keeps the headline (open count
/// and the heaviest day) visible; tapping it shows every day and assignment.
private struct HomeworkWorkloadPill: View {
    let homework: [HomeworkItem]
    @State private var showsDetail = false

    private var buckets: [HomeworkWorkloadBucket] { HomeworkWorkload.buckets(from: homework) }
    private var assignmentCount: Int { buckets.reduce(0) { $0 + $1.assignments.count } }

    var body: some View {
        let buckets = buckets
        let heaviest = HomeworkWorkload.heaviest(in: buckets)?.bucket
        Button {
            Haptics.selection()
            showsDetail = true
        } label: {
            HStack(spacing: Space.sm) {
                Image(systemName: "book.closed.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.frYouInk)
                    .accessibilityHidden(true)
                Text(buckets.isEmpty ? "No homework due this week" : "\(assignmentCount) due in 7 days")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.frInk)
                    .lineLimit(1)
                if let heaviest {
                    Text("·").foregroundStyle(Palette.frInk2).accessibilityHidden(true)
                    Label(Self.shortDay(heaviest), systemImage: "exclamationmark.circle.fill")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.warn)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.frInk2)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, Space.lg)
            .frame(minHeight: 44)
            .background(Palette.frCard, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.frRule, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Homework in the next 7 days")
        .accessibilityValue(HomeworkWorkloadSummary.text(buckets: buckets, assignmentCount: assignmentCount))
        .accessibilityHint("Shows homework due each day")
        .popover(isPresented: $showsDetail, arrowEdge: .top) {
            HomeworkWorkloadOverview(buckets: buckets, assignmentCount: assignmentCount)
        }
    }

    private static func shortDay(_ bucket: HomeworkWorkloadBucket) -> String {
        if bucket.dayKey == Agenda.todayKey() { return "Heavy today" }
        return "Heavy \(bucket.date.formatted(.dateTime.weekday(.abbreviated)))"
    }
}

enum HomeworkWorkloadSummary {
    static func text(buckets: [HomeworkWorkloadBucket], assignmentCount: Int) -> String {
        guard !buckets.isEmpty else { return "No open homework is due in the next 7 days." }
        guard let ranking = HomeworkWorkload.heaviest(in: buckets) else {
            return "\(assignmentCount) open assignment\(assignmentCount == 1 ? " is" : "s are") due, with no heavy days."
        }
        let heaviest = ranking.bucket
        if ranking.basis == .assignmentCount {
            if heaviest.dayKey == Agenda.todayKey() {
                return "Today has the most assignments due — choose one to begin now."
            }
            let weekday = heaviest.date.formatted(.dateTime.weekday(.wide))
            return "\(weekday) has the most assignments due — start before then."
        }
        if heaviest.dayKey == Agenda.todayKey() {
            return "Today has the heaviest workload based on known estimates — choose one assignment to begin now."
        }
        let weekday = heaviest.date.formatted(.dateTime.weekday(.wide))
        return "\(weekday) has the heaviest workload based on known estimates — start before then."
    }
}

/// The pill's popover: the summary sentence, then each day with its
/// assignments, effort and heavy-day flag.
private struct HomeworkWorkloadOverview: View {
    let buckets: [HomeworkWorkloadBucket]
    let assignmentCount: Int

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.lg) {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("Next 7 days")
                        .font(Typography.title)
                        .foregroundStyle(Palette.text)
                        .accessibilityAddTraits(.isHeader)
                    Text(HomeworkWorkloadSummary.text(buckets: buckets, assignmentCount: assignmentCount))
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(buckets) { bucket in
                    VStack(alignment: .leading, spacing: Space.sm) {
                        HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                            Text(bucket.date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))
                                .font(Typography.body.weight(.bold))
                                .foregroundStyle(Palette.text)
                                .accessibilityAddTraits(.isHeader)
                            Spacer(minLength: Space.sm)
                            Text(Self.meta(bucket))
                                .font(Typography.caption)
                                .foregroundStyle(Palette.textSecond)
                            if bucket.isHeavy {
                                Label("Heavy", systemImage: "exclamationmark.circle.fill")
                                    .font(Typography.caption.weight(.semibold))
                                    .foregroundStyle(Palette.warn)
                            }
                        }
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(bucket.assignments.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { Divider().overlay(Palette.border) }
                                HomeworkWorkloadRow(item: item)
                                    .padding(.vertical, Space.sm)
                            }
                        }
                        .padding(.horizontal, Space.md)
                        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                    }
                }
            }
            .padding(Space.xl)
        }
        .frame(minWidth: 360, idealWidth: 420, maxWidth: 480, minHeight: 200, maxHeight: 600)
        .background(Palette.panel)
    }

    private static func meta(_ bucket: HomeworkWorkloadBucket) -> String {
        let count = "\(bucket.assignments.count) due"
        return bucket.knownEffortCount == 0 ? count : "\(count) · \(bucket.knownEffortMinutes) min known"
    }
}

private struct HomeworkWorkloadRow: View {
    let item: HomeworkItem

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(item.title)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Space.md) {
                if let subject = item.subject, !subject.isEmpty {
                    Text(subject)
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
                if let effort = item.effortMin {
                    Label("\(effort) min", systemImage: "clock")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
            }
            if let step = item.firstIncompleteChecklistItem {
                Label(step.text, systemImage: "arrow.right")
                    .font(Typography.body)
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Next step: \(step.text)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

private struct CalendarAudienceBar: View {
    @Binding var selection: CalendarAudience
    let kids: [Kid]
    var compact = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.sm) {
                audienceButton(.parents, label: "Parents")
                ForEach(kids) { kid in
                    audienceButton(.kid(kid.id), label: kid.name, color: kid.profileColor, kid: kid)
                }
                audienceButton(.timetable, label: "Timetable", color: Palette.accent)
            }
            .padding(.horizontal, compact ? 0 : Space.lg)
            .padding(.vertical, compact ? 0 : Space.sm)
        }
        .accessibilityLabel("Calendar audience")
    }

    private func audienceButton(_ value: CalendarAudience, label: String, color: Color? = nil, kid: Kid? = nil) -> some View {
        let selected = selection == value
        return Button {
            Haptics.selection()
            selection = value
        } label: {
            HStack(spacing: Space.sm) {
                if let kid {
                    KidProfileAvatar(kid: kid, size: 24)
                } else if let color {
                    Circle()
                        .fill(color)
                        .frame(width: 9, height: 9)
                        .accessibilityHidden(true)
                }
                Text(label)
                    .font(Typography.body.weight(.semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(selected ? Palette.frYouInk : Palette.frInk2)
            .padding(.horizontal, Space.lg)
            .frame(minHeight: 44)
            .background(selected ? Palette.frYouSoft : Palette.frCard, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Palette.frYou : Palette.frRule, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Show \(label) calendar")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

enum CalendarMode: String, CaseIterable, Identifiable {
    case week, month
    var id: String { rawValue }
    var label: String { self == .week ? "Week" : "Month" }

    static func isLandscape(width: CGFloat, height: CGFloat) -> Bool {
        width > height
    }

    func resolved(isLandscape: Bool) -> CalendarMode {
        isLandscape ? .week : self
    }
}

/// Agenda list — upcoming events + homework grouped by day. Used as the
/// iPhone-portrait fallback where a seven-column time grid would be cramped.
private struct CalendarAgendaList: View {
    @Environment(AppStore.self) private var store
    let events: [CalendarEvent]
    let familyEvents: [FamilyEvent]
    let homework: [HomeworkItem]
    var showKidLabels = false
    var includeCurrentWeek = false
    var emptyTitle = "Nothing on the calendar yet"
    var emptyDetail = "School events and homework show up here. Subscribe to your school's calendar and add homework from Settings, then pull to refresh."
    var onAdd: (() -> Void)?
    var days: Int = 45
    /// iPhone portrait: the audience chips and Week | Month pill.
    var accessory: AnyView? = nil
    @State private var eventDetailRef: CalEventRef?

    private var sections: [(day: String, items: [AgendaItem])] {
        Agenda.upcomingSections(
            events: events,
            familyEvents: familyEvents,
            homework: homework,
            days: days,
            startingAt: includeCurrentWeek ? Agenda.mondayKey() : nil
        )
    }
    private var itemCount: Int { sections.reduce(0) { $0 + $1.items.count } }
    private var monthLabel: String { Date().formatted(.dateTime.month(.wide).year()) }

    var body: some View {
        // CalendarScreen draws the glow behind every layout.
        SurfaceScaffold(title: "Calendar", subtitle: monthLabel, showsBackground: false, trailing: {
            if let onAdd {
                CircleIconButton(systemImage: "plus", label: "New event", action: onAdd)
            }
        }) {
            if let accessory { accessory }
            if sections.isEmpty {
                emptyState
            } else {
                ForEach(sections, id: \.day) { s in
                    VStack(alignment: .leading, spacing: Space.sm) {
                        Text(Agenda.dayLabel(s.day))
                            .font(Theme.display(19, weight: .bold, relativeTo: .title3))
                            .foregroundStyle(Palette.text)
                            .padding(.horizontal, Space.xs)
                            .accessibilityAddTraits(.isHeader)
                        Card {
                            VStack(spacing: 0) {
                                ForEach(s.items) { item in
                                    if let fe = item.familyEvent {
                                        Button {
                                            eventDetailRef = CalEventRef(id: "\(fe.id)-\(fe.date)", eventId: fe.id, occurrenceDate: fe.date)
                                        } label: { AgendaRow(item: item, showKidLabel: showKidLabels) }
                                        .buttonStyle(.plain)
                                    } else {
                                        AgendaRow(item: item, showKidLabel: showKidLabels)
                                    }
                                    if item.id != s.items.last?.id { Divider().overlay(Palette.border) }
                                }
                            }
                        }
                    }
                }
                MicroLabel(text: "\(itemCount) item\(itemCount == 1 ? "" : "s") · next \(days) days")
                    .padding(.horizontal, Space.xs)
            }
        }
        .refreshable { await store.refreshDashboard() }
        .sheet(item: $eventDetailRef) { ref in EventDetailSheet(eventId: ref.eventId, occurrenceDate: ref.occurrenceDate) }
    }

    private var emptyState: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.md) {
                Image(systemName: "calendar")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                Text(emptyTitle)
                    .font(Typography.cardTitle).foregroundStyle(Palette.text)
                Text(emptyDetail)
                    .font(Typography.body).foregroundStyle(Palette.textSecond)
            }
        }
    }
}

/// Wrapper so a (series id, occurrence date) pair can drive `.sheet(item:)` —
/// occurrences of a recurring event share `id`, so the id alone isn't unique.
private struct CalEventRef: Identifiable {
    let id: String
    let eventId: String
    let occurrenceDate: String
}
