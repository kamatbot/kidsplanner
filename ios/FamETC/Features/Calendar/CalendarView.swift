import SwiftUI

/// Calendar tab. Portrait iPad offers the full Month grid or timed Week view;
/// landscape uses the timed Week view directly so events stay legible at their
/// actual times. iPhone portrait keeps the compact agenda list.
struct CalendarScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var showAddEvent = false
    @State private var addEventDate = Date()
    @State private var addEventTime: String?
    @State private var mode: CalendarMode = .month
    @State private var audience: CalendarAudience = .parents

    /// Only offer the Week|Month toggle where there's room to show it above
    /// either surface without crowding the iPhone-portrait agenda list.
    private var canToggleMode: Bool { hSize == .regular }
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
                if store.isParent {
                    if isLandscape {
                        CalendarAudienceBar(selection: $audience, kids: store.kids, compact: true)
                            .padding(.horizontal, Space.md)
                            .padding(.vertical, Space.xs)
                    } else {
                        CalendarAudienceBar(selection: $audience, kids: store.kids)
                    }
                }
                if canToggleMode && !isLandscape {
                    modeBar
                }
                if store.homeworkError != nil {
                    HomeworkSyncErrorNotice(isRetrying: store.isLoadingHomework) {
                        Task { await store.loadCalendarAndHomework(force: true) }
                    }
                    .padding(.horizontal, hSize == .regular ? Space.lg : Space.md)
                    .padding(.top, Space.sm)
                }
                if hSize == .regular {
                    HomeworkWorkloadPanel(homework: displayData.homework)
                        .padding(.horizontal, Space.lg)
                        .padding(.top, Space.sm)
                        .padding(.bottom, Space.md)
                }
                Group {
                    if useGrid && displayedMode == .month {
                        MonthCalendarView(
                            events: displayData.events,
                            familyEvents: displayData.familyEvents,
                            homework: displayData.homework,
                            showKidLabels: isTimetable,
                            compactLandscape: isLandscape,
                            onAdd: isTimetable ? nil : { presentAddEvent(date: Date()) }
                        )
                    } else if useGrid && displayedMode == .week {
                        WeekCalendarView(
                            events: displayData.events,
                            familyEvents: displayData.familyEvents,
                            homework: displayData.homework,
                            showKidLabels: isTimetable,
                            compactLandscape: isLandscape,
                            onAdd: isTimetable ? nil : presentAddEvent(date:time:)
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
                            days: displayedMode == .week ? 7 : 45
                        )
                    }
                }
            }
        }
        .background(ScreenBackground())
        .sheet(isPresented: $showAddEvent) {
            AddEventSheet(initialDate: addEventDate, initialTime: addEventTime)
        }
        .onChange(of: store.kids.map(\.id)) { _, kidIDs in
            guard case let .kid(id) = audience, !kidIDs.contains(id) else { return }
            audience = .parents
        }
    }

    private func presentAddEvent(date: Date, time: String? = nil) {
        addEventDate = date
        addEventTime = time
        showAddEvent = true
    }

    private var modeBar: some View {
        HStack {
            Spacer()
            modePicker
                .frame(width: 180)
                .frame(minHeight: 44)
        }
        .padding(.horizontal, Space.lg)
        .padding(.top, Space.md)
    }

    private var modePicker: some View {
        Picker("Calendar view", selection: $mode) {
            ForEach(CalendarMode.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .tint(Palette.accent)
        .accessibilityLabel("Calendar view")
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

private struct HomeworkWorkloadPanel: View {
    let homework: [HomeworkItem]
    @State private var selectedBucket: HomeworkWorkloadBucket?

    private var buckets: [HomeworkWorkloadBucket] { HomeworkWorkload.buckets(from: homework) }
    private var assignmentCount: Int { buckets.reduce(0) { $0 + $1.assignments.count } }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                Text("Next 7 days")
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.text)
                Text(summary)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)

                if !buckets.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 0) {
                            ForEach(Array(buckets.enumerated()), id: \.element.id) { index, bucket in
                                if index > 0 {
                                    Divider()
                                        .frame(height: 72)
                                        .overlay(Palette.border)
                                }
                                workloadButton(bucket)
                            }
                        }
                    }
                    .scrollClipDisabled()
                }
            }
        }
        .popover(item: $selectedBucket) { bucket in
            HomeworkWorkloadPopover(bucket: bucket)
        }
    }

    private var summary: String {
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

    private func workloadButton(_ bucket: HomeworkWorkloadBucket) -> some View {
        Button {
            Haptics.selection()
            selectedBucket = bucket
        } label: {
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(bucket.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                Text("\(bucket.assignments.count) due")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                Text(bucket.knownEffortCount == 0
                     ? "No effort estimate"
                     : "\(bucket.knownEffortMinutes) min known")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                if bucket.isHeavy {
                    Label("Heavy day", systemImage: "exclamationmark.circle.fill")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.warn)
                }
            }
            .frame(minWidth: 132, minHeight: 76, alignment: .leading)
            .padding(.horizontal, Space.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(bucket.date.formatted(.dateTime.weekday(.wide).month(.wide).day()))
        .accessibilityValue(accessibilityValue(for: bucket))
        .accessibilityHint("Shows homework due that day")
    }

    private func accessibilityValue(for bucket: HomeworkWorkloadBucket) -> String {
        let count = "\(bucket.assignments.count) assignment\(bucket.assignments.count == 1 ? "" : "s") due"
        let effort = bucket.knownEffortCount == 0
            ? "no effort estimates"
            : "\(bucket.knownEffortMinutes) known minutes"
        return bucket.isHeavy ? "\(count), \(effort), heavy day" : "\(count), \(effort)"
    }
}

private struct HomeworkWorkloadPopover: View {
    let bucket: HomeworkWorkloadBucket

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.md) {
                Text(bucket.date.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                    .font(Typography.title)
                    .foregroundStyle(Palette.text)
                Text("\(bucket.assignments.count) assignment\(bucket.assignments.count == 1 ? "" : "s") due")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)

                Divider().overlay(Palette.border)

                ForEach(Array(bucket.assignments.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { Divider().overlay(Palette.border) }
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text(item.title)
                            .font(Typography.body.weight(.semibold))
                            .foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
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
                        if let step = item.firstIncompleteChecklistItem {
                            Label(step.text, systemImage: "arrow.right")
                                .font(Typography.body)
                                .foregroundStyle(Palette.text)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityLabel("Next step: \(step.text)")
                        }
                    }
                    .accessibilityElement(children: .contain)
                }
            }
            .padding(Space.xl)
        }
        .frame(minWidth: 340, idealWidth: 400, maxWidth: 460, minHeight: 220, maxHeight: 520)
        .background(Palette.panel)
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
                ForEach(Array(kids.enumerated()), id: \.element.id) { index, kid in
                    audienceButton(.kid(kid.id), label: kid.name, color: Palette.kidColor(index: index))
                }
                audienceButton(.timetable, label: "Timetable", color: Palette.accent)
            }
            .padding(.horizontal, compact ? 0 : Space.lg)
            .padding(.vertical, compact ? 0 : Space.sm)
        }
        .accessibilityLabel("Calendar audience")
    }

    private func audienceButton(_ value: CalendarAudience, label: String, color: Color? = nil) -> some View {
        let selected = selection == value
        return Button {
            Haptics.selection()
            selection = value
        } label: {
            HStack(spacing: Space.sm) {
                if let color {
                    Circle()
                        .fill(color)
                        .frame(width: 9, height: 9)
                        .overlay(Circle().stroke(selected ? Palette.onAccent.opacity(0.7) : Color.clear, lineWidth: 1))
                        .accessibilityHidden(true)
                }
                Text(label)
                    .font(Typography.body.weight(.semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(selected ? Palette.onAccent : Palette.textSecond)
            .padding(.horizontal, Space.lg)
            .frame(minHeight: 44)
            .background(selected ? Palette.accent : Palette.panel, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Color.clear : Palette.border, lineWidth: 1))
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
        SurfaceScaffold(title: "Calendar", subtitle: monthLabel, trailing: {
            if let onAdd {
                Button(action: onAdd) {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(Palette.onAccent)
                        .frame(width: 44, height: 44).background(Palette.accent, in: Circle())
                }
                .accessibilityLabel("New event")
            }
        }) {
            if sections.isEmpty {
                emptyState
            } else {
                ForEach(sections, id: \.day) { s in
                    VStack(alignment: .leading, spacing: Space.sm) {
                        Text(Agenda.dayLabel(s.day))
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.text)
                            .padding(.horizontal, Space.xs)
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
