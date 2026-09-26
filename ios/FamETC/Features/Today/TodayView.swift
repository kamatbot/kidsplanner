import SwiftUI

struct TodayScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showAddEvent = false
    @State private var showNotes = false
    let onOpenHomework: () -> Void
    let onOpenMeals: () -> Void

    init(onOpenHomework: @escaping () -> Void = {}, onOpenMeals: @escaping () -> Void = {}) {
        self.onOpenHomework = onOpenHomework
        self.onOpenMeals = onOpenMeals
    }
    private var scope: String { "\(store.me?.id ?? "")|\(store.family?.id ?? "")" }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                TimelineView(.periodic(from: .now, by: 300)) { _ in
                    VStack(alignment: .leading, spacing: sizeClass == .regular ? 20 : 14) {
                        if store.isParent {
                            TodayParentHeader(greeting: greeting, dateLabel: dateLabel,
                                              onAddEvent: { showAddEvent = true }, onMore: { showNotes = true })
                            ParentTodayStack(onOpenHomework: onOpenHomework, onOpenMeals: onOpenMeals,
                                             onDaily3: { scrollToDaily3(proxy) })
                        } else {
                            TodayChildHeader(dateLabel: dateLabel, onMore: { showNotes = true })
                            KidTodayStack(onOpenHomework: onOpenHomework, onDaily3: { scrollToDaily3(proxy) })
                        }
                    }
                    .padding(sizeClass == .regular ? 32 : 16)
                    .padding(.bottom, max(Layout.bottomNavigationClearance, Space.xl))
                }
            }
            .id(scope)
        }
        .background(ScreenBackground())
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await store.refreshDashboard() }
        .sheet(isPresented: $showAddEvent) { AddEventSheet() }
        .sheet(isPresented: $showNotes) { NotesScreen() }
    }
    private func scrollToDaily3(_ proxy: ScrollViewProxy) {
        withAnimation(Motion.maybe(Motion.snappy, reduceMotion: reduceMotion)) { proxy.scrollTo("daily3", anchor: .top) }
    }
    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
        let name = store.me?.name?.split(separator: " ").first.map(String.init) ?? ""
        return name.isEmpty ? part : "\(part), \(name)"
    }
    private var dateLabel: String { Date().formatted(.dateTime.weekday(.wide).day().month(.wide)) }
}

private struct ParentTodayStack: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showSecondary = false
    @State private var showAddEvent = false
    @State private var showSchoolNotice = false
    @State private var showActions = false
    @State private var showStudy = false
    let onOpenHomework: () -> Void
    let onOpenMeals: () -> Void
    let onDaily3: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: sizeClass == .regular ? 20 : 14) {
            FamilyRingsHero(onSeeAll: { showActions = true })
            FamilyRingsKidGrid(onOpenHomework: onOpenHomework, onDaily3: onDaily3)
            FamilyRingsDayStrip(onOpenMeals: onOpenMeals)
            DailyFiveCard().id("daily3")
            if let user = store.me, !store.needsAuth {
                StudyPalCard(userID: user.id, onOpenStudy: { showStudy = true })
                    .popover(isPresented: $showStudy, arrowEdge: .bottom) {
                        StudyPalPanel(ownerID: user.id, usesPopover: sizeClass == .regular).id(user.id)
                            .presentationCompactAdaptation(.sheet)
                    }
            }
            TodayUtilitiesRow(onScanNotice: { showSchoolNotice = true },
                              onOpenActions: { showActions = true }, onAddEvent: { showAddEvent = true })
            TodaySecondaryDisclosure(isExpanded: $showSecondary, role: .parent,
                                     extra: AnyView(HomeworkDueCard(onOpenHomework: onOpenHomework)))
        }
        .sheet(isPresented: $showAddEvent) { AddEventSheet() }
        .sheet(isPresented: $showSchoolNotice) { SchoolNoticeSheet() }
        .sheet(isPresented: $showActions) { FamilyRingsActionsSheet() }
        .onChange(of: store.me?.id) { _, _ in showStudy = false; showActions = false }
        .onChange(of: store.family?.id) { _, _ in showStudy = false; showActions = false }
        .onChange(of: store.needsAuth) { _, needsAuth in if needsAuth { showStudy = false; showActions = false } }
    }
}

// MARK: - Study start / homework

/// Selects one real, open assignment. A parent can review it but never marks a
/// child's homework complete from Today; a child gets the student-owned
/// controls in `StudyStartCard` and `KidHomeworkRow` below.
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

    private var item: HomeworkItem? {
        let scoped = store.homework.filter {
            (store.isParent || $0.kidId == store.me?.kidId)
        }
        return StudyStartPriority.select(from: scoped)
    }

    private var childName: String? {
        guard let kidID = item?.kidId else { return nil }
        return store.kids.first { $0.id == kidID }?.name
    }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(alignment: .top, spacing: Space.sm) {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text(store.isParent ? "Needs a plan" : "Start here")
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.text)
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
                    Spacer(minLength: Space.sm)
                    TodayAssetImage(name: "TodayStudyArt", fallback: "book.closed.fill")
                        .frame(width: 76, height: 62)
                        .accessibilityHidden(true)
                }

                if store.homeworkError != nil {
                    HomeworkSyncNotice(hasCachedHomework: !store.homework.isEmpty) {
                        Task { await store.loadCalendarAndHomework(force: true) }
                    }
                }

                if let item {
                    assignmentContent(item)
                } else {
                    Text(store.isLoadingHomework
                         ? "Loading homework…"
                         : (store.homeworkError != nil
                            ? "Homework may be out of date. Check Homework for the latest."
                            : (store.isParent
                               ? "No open homework needs a start right now."
                               : "No open homework needs your attention right now.")))
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

private struct HomeworkDueCard: View {
    @Environment(AppStore.self) private var store
    let onOpenHomework: () -> Void

    private var items: [HomeworkItem] {
        let limit = Agenda.dayKey(offset: 7)
        return store.homework
            .filter {
                !$0.isDone && $0.dueDate <= limit
            }
            .sorted {
                ($0.dueDate, $0.dueTime ?? "23:59", $0.id) < ($1.dueDate, $1.dueTime ?? "23:59", $1.id)
            }
    }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .firstTextBaseline) {
                    MicroLabel(text: "Homework due")
                    Spacer()
                    if !items.isEmpty {
                        Text("\(items.count)")
                            .font(Typography.mono(11))
                            .foregroundStyle(Palette.textSecond)
                    }
                }
                if store.homeworkError != nil {
                    HomeworkSyncNotice(hasCachedHomework: !store.homework.isEmpty) {
                        Task { await store.loadCalendarAndHomework(force: true) }
                    }
                }
                HomeworkOpenButton(action: onOpenHomework)
                if items.isEmpty {
                    Text(store.isLoadingHomework
                         ? "Loading homework…"
                         : (store.homeworkError == nil
                            ? "No homework is due this week."
                            : "Homework isn't available right now."))
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .padding(.top, Space.xs)
                } else {
                    VStack(spacing: Space.sm) {
                        ForEach(items.prefix(4)) { HomeworkDueRow(item: $0) }
                        if items.count > 4 {
                            Text("+\(items.count - 4) more")
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

/// Parent homework remains read-only: reviewing is a navigation action, not a
/// completion mutation owned by the parent.
private struct HomeworkDueRow: View {
    let item: HomeworkItem

    private static let shortWeekday: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE"
        return formatter
    }()

    private var due: (text: String, color: Color) {
        let today = Agenda.todayKey()
        if item.dueDate < today { return ("overdue", Palette.red) }
        if item.dueDate == today { return ("today", Palette.warn) }
        let date = DateFmt.ymd.date(from: item.dueDate) ?? Date()
        return (Self.shortWeekday.string(from: date), Palette.textSecond)
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

// MARK: - Kid Today

private struct KidTodayStack: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var showActions = false
    @State private var showStudy = false
    let onOpenHomework: () -> Void
    let onDaily3: () -> Void
    /// iPad, mostly used by children: two columns keep Daily 4 on the first screen.
    private var tight: Bool { sizeClass == .regular && verticalSizeClass == .regular && !textSize.isAccessibilitySize }
    var body: some View {
        Group {
            if tight {
                tightLayout
            } else {
                VStack(alignment: .leading, spacing: sizeClass == .regular ? 20 : 14) {
                    FamilyRingsHero(onSeeAll: { showActions = true })
                    if let kidID = store.me?.kidId {
                        FamilyRingsKidCard(kidID: kidID, onOpenHomework: onOpenHomework, onDaily3: onDaily3)
                            .id("\(store.me?.id ?? "")|\(store.family?.id ?? "")|\(kidID)|\(Agenda.todayKey())")
                    }
                    DailyFiveCard(isKid: true).id("daily3")
                    FamilyRingsDayStrip(kidID: store.me?.kidId)
                    StudyStartCard()
                    studyPal
                    KidHomeworkCard(onOpenHomework: onOpenHomework)
                }
            }
        }
        .sheet(isPresented: $showActions) { FamilyRingsActionsSheet() }
        .onChange(of: store.me?.id) { _, _ in showStudy = false; showActions = false }
        .onChange(of: store.needsAuth) { _, needsAuth in
            if needsAuth { showStudy = false; showActions = false }
        }
    }
    @ViewBuilder private var studyPal: some View {
        if let user = store.me, user.role == "kid", !store.needsAuth {
            StudyPalCard(userID: user.id, onOpenStudy: { showStudy = true })
                .popover(isPresented: $showStudy, arrowEdge: .bottom) {
                    StudyPalPanel(ownerID: user.id, usesPopover: sizeClass == .regular).id(user.id)
                        .presentationCompactAdaptation(.sheet)
                }
        }
    }
    private var tightLayout: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 20) {
                FamilyRingsHero(onSeeAll: { showActions = true }, dense: true)
                if let kidID = store.me?.kidId {
                    FamilyRingsKidCard(kidID: kidID, onOpenHomework: onOpenHomework, onDaily3: onDaily3, dense: true)
                        .id("\(store.me?.id ?? "")|\(store.family?.id ?? "")|\(kidID)|\(Agenda.todayKey())")
                }
            }
            .fixedSize(horizontal: false, vertical: true)   // equal-height cards in the first row
            DailyFiveCard(isKid: true, dense: true).id("daily3")
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 20) {
                    FamilyRingsDayStrip(kidID: store.me?.kidId)
                    StudyStartCard()
                }
                VStack(alignment: .leading, spacing: 20) {
                    KidHomeworkCard(onOpenHomework: onOpenHomework)
                    studyPal
                }
            }
        }
    }
}

private struct KidHomeworkCard: View {
    @Environment(AppStore.self) private var store
    let onOpenHomework: () -> Void

    private var items: [HomeworkItem] {
        let today = Agenda.todayKey()
        let limit = Agenda.dayKey(offset: 7)
        return store.homework
            .filter { $0.kidId == store.me?.kidId && ((!$0.isDone && $0.dueDate <= limit) || ($0.isDone && $0.dueDate == today)) }
            .sorted { a, b in
                if a.isDone != b.isDone { return !a.isDone }
                return (a.dueDate, a.id) < (b.dueDate, b.id)
            }
    }

    private var leftCount: Int { items.filter { !$0.isDone }.count }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .firstTextBaseline) {
                    MicroLabel(text: "Homework")
                    Spacer()
                    Text(store.isLoadingHomework && items.isEmpty ? "Not loaded" : "\(leftCount) left")
                        .font(Typography.mono(12))
                        .foregroundStyle(Palette.textSecond)
                }
                HomeworkOpenButton(action: onOpenHomework)
                if items.isEmpty {
                    Text(store.isLoadingHomework
                         ? "Loading homework…"
                         : (store.homeworkError == nil
                            ? "No homework is due this week."
                            : "Homework isn't available right now."))
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                } else {
                    VStack(spacing: Space.sm) {
                        ForEach(items.prefix(4)) { KidHomeworkRow(item: $0) }
                    }
                }
            }
        }
    }
}

/// Shared Today control for opening the full native Homework tab. It stays
/// outside the student rows so completion remains a separate, student-owned
/// action and never creates nested buttons.
private struct HomeworkOpenButton: View {
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Label("Open homework", systemImage: "chevron.right")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.accent)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open homework")
        .accessibilityHint("Open the full Homework screen")
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
            .padding(.horizontal, Space.md)
            .padding(.vertical, Space.sm + 2)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isOverdue ? Palette.red : Palette.border, lineWidth: isOverdue ? 1.5 : 1)
            )
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
