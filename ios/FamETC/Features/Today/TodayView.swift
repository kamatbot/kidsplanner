import SwiftUI

/// The home dashboard — restyled to the Horizon "Daily 5" card stack
/// (docs/design/redesign/canvas-1f parent, canvas-1g kid). Parents get
/// Today's schedule / Homework due / Daily 5; kids get a bigger, simpler
/// version of the same three plus their own homework in full.
struct TodayScreen: View {
    @Environment(AppStore.self) private var store
    @State private var showAddEvent = false
    @State private var showNotes = false

    private var bottomClearance: CGFloat {
        UIDevice.current.userInterfaceIdiom == .phone ? Layout.tabBarClearance : Space.xl
    }

    private var firstName: String {
        guard let name = store.me?.name, !name.isEmpty else { return "" }
        return String(name.split(separator: " ").first ?? Substring(name))
    }
    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 12 ? "Good morning" : (h < 18 ? "Good afternoon" : "Good evening")
        return firstName.isEmpty ? part : "\(part), \(firstName)"
    }
    private var dateLabel: String { Date().formatted(.dateTime.weekday(.wide).month(.wide).day()) }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.lg) {
                    if store.isParent {
                        ParentHeader(greeting: greeting, dateLabel: dateLabel, onMore: { showNotes = true })
                        ParentTodayStack()
                    } else {
                        KidHeader(dateLabel: dateLabel, onMore: { showNotes = true })
                        KidTodayStack()
                    }
                }
                .padding(Space.lg)
                .padding(.bottom, bottomClearance)
                // Chat-style: tapping anywhere that isn't a field/button/card control
                // puts the keyboard away. (Controls consume their own taps first.)
                .contentShape(Rectangle())
                .onTapGesture { famDismissKeyboard() }
            }

            if store.isParent {
                AddEventFAB { showAddEvent = true }
                    .padding(.trailing, Space.lg)
                    .padding(.bottom, bottomClearance)
            }
        }
        .background(ScreenBackground())
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await store.refreshDashboard() }
        .sheet(isPresented: $showAddEvent) { AddEventSheet() }
        .sheet(isPresented: $showNotes) { NotesScreen() }
    }
}

// MARK: - Parent header (canvas-1f)

private struct ParentHeader: View {
    let greeting: String
    let dateLabel: String
    let onMore: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: Space.md) {
            VStack(alignment: .leading, spacing: 3) {
                MicroLabel(text: dateLabel)
                Text(greeting).font(Typography.title).foregroundStyle(Palette.text)
            }
            Spacer(minLength: Space.sm)
            MoreMenu(onNotes: onNotes)
        }
    }

    private var onNotes: () -> Void { onMore }
}

private struct AddEventFAB: View {
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.impact(.medium)
            action()
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Palette.onAccent)
                .frame(width: 58, height: 58)
                .background(Signal.gradient(), in: Circle())
                .shadow(color: Signal.end.opacity(0.28), radius: 8, x: 0, y: 5)
        }
        .buttonStyle(PressableStyle(scale: 0.94))
        .accessibilityLabel("Add event")
        .accessibilityHint("Create a family event")
    }
}

// MARK: - Parent card stack (canvas-1f: schedule / homework due + Daily 5)

private struct ParentTodayStack: View {
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            if hSize == .compact || dynamicTypeSize.isAccessibilitySize {
                ActionCard()
                ScheduleCard()
                HomeworkDueCard()
            } else {
                VStack(alignment: .leading, spacing: Space.lg) {
                    ActionCard()
                    ScheduleCard()
                    HomeworkDueCard()
                }
            }
            PathOddsFamilySummaryCard()
            DailyFiveCard()
        }
    }
}

// MARK: - Study start

/// Selects one real, open assignment. Urgency is date/time first; an assignment
/// already in progress wins only when that urgency is otherwise identical.
enum StudyStartPriority {
    private static let displayDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d"
        return formatter
    }()
    private static let time24Formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()
    private static let humanTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

    static func select(from homework: [HomeworkItem], today: String = Agenda.todayKey()) -> HomeworkItem? {
        homework
            .filter { !$0.isDone }
            .sorted { lhs, rhs in
                let lhsOverdue = lhs.dueDate < today
                let rhsOverdue = rhs.dueDate < today
                if lhsOverdue != rhsOverdue { return lhsOverdue }
                if lhs.dueDate != rhs.dueDate { return lhs.dueDate < rhs.dueDate }

                let lhsTime = lhs.dueTime ?? "23:59"
                let rhsTime = rhs.dueTime ?? "23:59"
                if lhsTime != rhsTime { return lhsTime < rhsTime }

                let lhsStarted = lhs.status == "in_progress"
                let rhsStarted = rhs.status == "in_progress"
                if lhsStarted != rhsStarted { return lhsStarted }

                let titleOrder = lhs.title.localizedCaseInsensitiveCompare(rhs.title)
                if titleOrder != .orderedSame { return titleOrder == .orderedAscending }
                return lhs.id < rhs.id
            }
            .first
    }

    static func dueText(for item: HomeworkItem, today: String = Agenda.todayKey()) -> String {
        let timeSuffix = item.dueTime.flatMap(humanTime(from:)).map { " at \($0)" } ?? ""
        if item.dueDate < today {
            let date = DateFmt.ymd.date(from: item.dueDate).map(displayDate.string(from:)) ?? item.dueDate
            return "Overdue · was due \(date)\(timeSuffix)"
        }
        if item.dueDate == today { return "Due today\(timeSuffix)" }
        if let todayDate = DateFmt.ymd.date(from: today),
           let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: todayDate),
           item.dueDate == DateFmt.ymd.string(from: tomorrow) {
            return "Due tomorrow\(timeSuffix)"
        }
        let date = DateFmt.ymd.date(from: item.dueDate).map(displayDate.string(from:)) ?? item.dueDate
        return "Due \(date)\(timeSuffix)"
    }

    private static func humanTime(from value: String) -> String? {
        time24Formatter.date(from: value).map { humanTimeFormatter.string(from: $0) }
    }
}

private struct StudyStartCard: View {
    @Environment(AppStore.self) private var store

    private var item: HomeworkItem? { StudyStartPriority.select(from: store.homework) }
    private var childName: String? {
        guard let kidID = item?.kidId else { return nil }
        return store.kids.first { $0.id == kidID }?.name
    }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                    Text(store.isParent ? "Needs a plan" : "Start here")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: Space.sm)
                    if let item, store.homeworkMutationIDs.contains(item.id) {
                        ProgressView()
                            .controlSize(.small)
                            .tint(Palette.accent)
                            .accessibilityLabel("Updating homework")
                    }
                    if store.isParent, let childName {
                        Text(childName)
                            .font(Typography.caption.weight(.semibold))
                            .foregroundStyle(Palette.textSecond)
                            .lineLimit(1)
                    }
                }

                if store.homeworkError != nil {
                    HomeworkSyncNotice(hasCachedHomework: !store.homework.isEmpty) {
                        Task { await store.loadCalendarAndHomework(force: true) }
                    }
                }

                if let item {
                    assignmentContent(item)
                } else {
                    Text(store.isParent
                         ? "No open homework needs a start right now."
                         : "No open homework needs your attention right now.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func assignmentContent(_ item: HomeworkItem) -> some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Text(item.title)
                .font(Typography.title)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)

            Text(item.subject.flatMap { $0.isEmpty ? nil : $0 } ?? "Homework")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.textSecond)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.md) { assignmentFacts(item) }
                VStack(alignment: .leading, spacing: Space.xs) { assignmentFacts(item) }
            }

            Divider().overlay(Palette.border)

            VStack(alignment: .leading, spacing: Space.xs) {
                Text("Next step")
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.textSecond)
                Text(nextStepText(for: item))
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if item.status == "todo" || item.firstIncompleteChecklistIndex != nil {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Space.sm) { actionButtons(for: item) }
                    VStack(spacing: Space.sm) { actionButtons(for: item) }
                }
                .padding(.top, Space.xs)
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func assignmentFacts(_ item: HomeworkItem) -> some View {
        Label(StudyStartPriority.dueText(for: item), systemImage: "calendar")
            .font(Typography.caption)
            .foregroundStyle(item.dueDate < Agenda.todayKey() ? Palette.red : Palette.textSecond)
        if let effort = item.effortMin {
            Label("\(effort) min", systemImage: "clock")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
        }
        if !item.checklistItems.isEmpty {
            Label("\(item.completedChecklistCount) of \(item.checklistItems.count) steps done", systemImage: "checklist")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
        }
    }

    private func nextStepText(for item: HomeworkItem) -> String {
        if let step = item.firstIncompleteChecklistItem { return step.text }
        if item.checklistItems.isEmpty { return "Add the smallest next step in Homework." }
        return "All checklist steps are done. Complete the assignment separately in Homework."
    }

    @ViewBuilder
    private func actionButtons(for item: HomeworkItem) -> some View {
        let isMutating = store.homeworkMutationIDs.contains(item.id)

        if item.status == "todo" {
            Button {
                Haptics.impact(.light)
                Task { await store.setHomeworkStatus(item, status: "in_progress") }
            } label: {
                Label("Start work", systemImage: "play.fill")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            }
            .buttonStyle(PressableStyle())
            .disabled(isMutating)
            .accessibilityHint("Marks this assignment as in progress")
        }

        if let index = item.firstIncompleteChecklistIndex {
            Button {
                Haptics.selection()
                Task { await store.setHomeworkChecklistStep(item, index: index, done: true) }
            } label: {
                Label("Step done", systemImage: "checkmark")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.accent)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                            .strokeBorder(Palette.border, lineWidth: 1)
                    )
            }
            .buttonStyle(PressableStyle())
            .disabled(isMutating)
            .accessibilityHint("Marks only the next checklist step complete")
        }
    }
}

private struct HomeworkSyncNotice: View {
    let hasCachedHomework: Bool
    let retry: () -> Void

    var body: some View {
        HStack(spacing: Space.sm) {
            Image(systemName: "exclamationmark.arrow.triangle.2.circlepath")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.red)
                .accessibilityHidden(true)
            Text(hasCachedHomework
                 ? "Homework couldn't refresh. Showing saved items."
                 : "Homework couldn't refresh.")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Space.xs)
            Button("Retry", action: retry)
                .font(Typography.caption.weight(.semibold))
                .foregroundStyle(Palette.accent)
                .frame(minWidth: 44, minHeight: 44)
                .buttonStyle(.plain)
        }
        .padding(.leading, Space.sm)
        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Today's schedule card

private struct ScheduleCard: View {
    @Environment(AppStore.self) private var store

    private var items: [AgendaItem] {
        Agenda.items(on: Agenda.todayKey(), events: store.visibleEvents, familyEvents: store.visibleFamilyEvents, homework: store.homework)
            .filter { $0.kind != .homework }
    }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                MicroLabel(text: "Today's schedule")
                if items.isEmpty {
                    Text("Nothing is scheduled today.")
                        .font(Typography.body).foregroundStyle(Palette.textSecond)
                        .padding(.top, Space.xs)
                } else {
                    VStack(spacing: 0) {
                        ForEach(items) { item in
                            ScheduleRow(item: item)
                            if item.id != items.last?.id { Divider().overlay(Palette.border) }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One schedule row: mono time · kid-color bar · title · kid name (right).
private struct ScheduleRow: View {
    @Environment(AppStore.self) private var store
    let item: AgendaItem

    var body: some View {
        HStack(spacing: Space.md) {
            Text(item.time ?? "—")
                .font(Typography.mono(12.5))
                .foregroundStyle(Palette.textSecond)
                .frame(width: 50, alignment: .leading)
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.accent)
                .frame(width: 3, height: 28)
            Text(item.title)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.text)
                .lineLimit(1)
            Spacer(minLength: Space.sm)
            if let name = Agenda.kidName(item.kidId, kids: store.kids) {
                Text(name)
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.textSecond)
                    .fixedSize()
            }
        }
        .padding(.vertical, Space.sm + 2)
        .contentShape(Rectangle())
    }
}

// MARK: - Homework due card

private struct HomeworkDueCard: View {
    @Environment(AppStore.self) private var store

    private var items: [HomeworkItem] { Agenda.homeworkDueSoon(store.homework, days: 7) }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .firstTextBaseline) {
                    MicroLabel(text: "Homework due")
                    Spacer()
                    if !items.isEmpty {
                        Text("\(items.count)").font(Typography.mono(11)).foregroundStyle(Palette.textSecond)
                    }
                }
                if items.isEmpty {
                    Text("No homework is due this week.")
                        .font(Typography.body).foregroundStyle(Palette.textSecond)
                        .padding(.top, Space.xs)
                } else {
                    VStack(spacing: Space.sm + 2) {
                        ForEach(items.prefix(5)) { HomeworkDueRow(item: $0) }
                        if items.count > 5 {
                            Text("+\(items.count - 5) more")
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Palette.textSecond)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A due-soon homework row for parents. Progress is student-owned, so Today
/// keeps the due item visible without offering a status mutation.
private struct HomeworkDueRow: View {
    let item: HomeworkItem

    private static let shortWeekday: DateFormatter = { let f = DateFormatter(); f.dateFormat = "EEE"; return f }()

    private var due: (text: String, color: Color) {
        let today = Agenda.todayKey()
        if item.dueDate < today { return ("overdue", Palette.red) }
        if item.dueDate == today { return ("today", Palette.warn) }
        let d = DateFmt.ymd.date(from: item.dueDate) ?? Date()
        return (Self.shortWeekday.string(from: d), Palette.textSecond)
    }

    var body: some View {
        HStack(spacing: Space.sm + 2) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(due.text == "overdue" ? Palette.red : Palette.border, lineWidth: 1.5)
                .frame(width: 18, height: 18)
            Text(item.title)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.text)
                .lineLimit(1)
            Spacer(minLength: Space.sm)
            Text(due.text)
                .font(Typography.mono(11))
                .foregroundStyle(due.color)
        }
        .frame(minHeight: 44)
        .accessibilityLabel(item.title)
        .accessibilityValue("Due \(due.text)")
    }
}

// MARK: - Kid header (canvas-1g)

private struct KidHeader: View {
    @Environment(AppStore.self) private var store
    let dateLabel: String
    let onMore: () -> Void

    private var kid: Kid? { store.kids.first { $0.id == store.me?.kidId } }
    private var kidName: String { kid?.name ?? store.me?.name ?? "there" }

    var body: some View {
        HStack(alignment: .bottom, spacing: Space.md) {
            VStack(alignment: .leading, spacing: 3) {
                MicroLabel(text: dateLabel)
                Text("Hi, \(kidName)")
                    .font(Typography.title)
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Here’s what matters today.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
            }
            Spacer(minLength: Space.sm)
            MoreMenu(onNotes: onMore)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Today for \(kidName)")
        .accessibilityValue(dateLabel)
    }
}

private struct MoreMenu: View {
    let onNotes: () -> Void
    var foreground: Color = Palette.text

    var body: some View {
        Menu {
            Button(action: onNotes) {
                Label("Notes", systemImage: "note.text")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(foreground)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("More")
        .accessibilityHint("Open Notes and other family tools")
    }
}

// MARK: - Kid card stack (canvas-1g)

private struct KidTodayStack: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var todayItems: [AgendaItem] {
        Agenda.items(on: Agenda.todayKey(), events: store.visibleEvents, familyEvents: store.visibleFamilyEvents, homework: store.homework)
            .filter { $0.kind != .homework }
    }
    private var nextUp: AgendaItem? { todayItems.first }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            if hSize == .compact || dynamicTypeSize.isAccessibilitySize {
                StudyStartCard()
                ActionCard()
                if let nextUp { KidNextUpCallout(item: nextUp) }
                KidDayCard(items: todayItems)
            } else {
                HStack(alignment: .top, spacing: Space.lg) {
                    StudyStartCard()
                        .frame(maxWidth: .infinity, alignment: .top)
                    VStack(alignment: .leading, spacing: Space.lg) {
                        ActionCard()
                        if let nextUp { KidNextUpCallout(item: nextUp) }
                        KidDayCard(items: todayItems)
                    }
                    .frame(maxWidth: .infinity, alignment: .top)
                }
            }

            KidHomeworkCard()
            PathOddsQuestCard()
            DailyFiveCard(isKid: true)
        }
    }
}

private struct KidNextUpCallout: View {
    let item: AgendaItem

    var body: some View {
        HStack(spacing: Space.sm + 2) {
            Image(systemName: "clock")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Palette.accent)
                .accessibilityHidden(true)
            (Text("Next up: ")
                + Text(item.title).bold()
                + Text(item.time.map { " at \($0)" } ?? ""))
                .font(Typography.body)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .padding(.horizontal, Space.lg)
        .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct KidDayCard: View {
    @Environment(AppStore.self) private var store
    let items: [AgendaItem]

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                MicroLabel(text: "Your day")
                if items.isEmpty {
                    Text("Nothing is scheduled today.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                } else {
                    VStack(spacing: Space.sm) {
                        ForEach(items) { item in
                            HStack(spacing: Space.md) {
                                Text(item.time ?? "—")
                                    .font(Typography.mono(14, .bold))
                                    .frame(width: 56, alignment: .leading)
                                RoundedRectangle(cornerRadius: 2, style: .continuous)
                                    .fill(Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.accent)
                                    .frame(width: 4, height: 30)
                                Text(item.title)
                                    .font(Typography.body.weight(.semibold))
                                    .foregroundStyle(Palette.text)
                                    .lineLimit(1)
                                Spacer(minLength: Space.sm)
                                if let subtitle = item.subtitle, !subtitle.isEmpty {
                                    Text(subtitle)
                                        .font(Typography.caption)
                                        .foregroundStyle(Palette.textSecond)
                                        .lineLimit(1)
                                }
                            }
                            .padding(.horizontal, Space.md)
                            .padding(.vertical, Space.sm + 2)
                            .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
        }
    }
}

/// The kid's own homework: overdue/today/upcoming plus done items due today.
private struct KidHomeworkCard: View {
    @Environment(AppStore.self) private var store

    private var items: [HomeworkItem] {
        let today = Agenda.todayKey(); let limit = Agenda.dayKey(offset: 7)
        return store.homework
            .filter { (!$0.isDone && $0.dueDate <= limit) || ($0.isDone && $0.dueDate == today) }
            .sorted { a, b in
                if a.isDone != b.isDone { return !a.isDone }
                return a.dueDate < b.dueDate
            }
    }
    private var leftCount: Int { items.filter { !$0.isDone }.count }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .firstTextBaseline) {
                    MicroLabel(text: "Homework")
                    Spacer()
                    Text("\(leftCount) left").font(Typography.mono(12)).foregroundStyle(Palette.textSecond)
                }
                if items.isEmpty {
                    Text("No homework is due this week.")
                        .font(Typography.body).foregroundStyle(Palette.textSecond)
                } else {
                    VStack(spacing: Space.sm) {
                        ForEach(items) { KidHomeworkRow(item: $0) }
                    }
                }
            }
        }
    }
}

private struct KidHomeworkRow: View {
    @Environment(AppStore.self) private var store
    let item: HomeworkItem

    private var isOverdue: Bool { !item.isDone && item.dueDate < Agenda.todayKey() }
    private var isToday: Bool { !item.isDone && item.dueDate == Agenda.todayKey() }

    var body: some View {
        Button {
            Haptics.selection()
            Task { await store.toggleHomeworkDone(item) }
        } label: {
            HStack(spacing: Space.md) {
                checkbox
                Text(item.title)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(item.isDone ? Palette.textSecond : Palette.text)
                    .strikethrough(item.isDone, color: Palette.textSecond)
                    .lineLimit(1)
                Spacer(minLength: Space.sm)
                trailing
            }
            .padding(.horizontal, Space.md).padding(.vertical, Space.sm + 2)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isOverdue ? Palette.red : Palette.border, lineWidth: isOverdue ? 1.5 : 1))
            .opacity(item.isDone ? 0.55 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.title)
        .accessibilityValue(item.isDone ? "Completed" : (isOverdue ? "Overdue" : (isToday ? "Due today" : "Open")))
        .accessibilityHint(item.isDone ? "Marks the assignment open" : "Marks the assignment complete")
    }

    @ViewBuilder private var checkbox: some View {
        if item.isDone {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Palette.green)
        } else {
            Circle()
                .strokeBorder(isOverdue ? Palette.red : Palette.border, lineWidth: 2)
                .frame(width: 26, height: 26)
        }
    }

    @ViewBuilder private var trailing: some View {
        if isOverdue {
            Text("overdue").font(Typography.mono(12, .bold)).foregroundStyle(Palette.red)
        } else if isToday {
            Text("today").font(Typography.mono(12, .bold)).foregroundStyle(Palette.warn)
        }
    }
}
