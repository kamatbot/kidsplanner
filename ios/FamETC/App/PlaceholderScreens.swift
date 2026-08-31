import Foundation
import SwiftUI

// TodayScreen  → Features/Today/TodayView.swift
// ChatScreen   → Features/Chat/ChatView.swift
// CalendarScreen → Features/Calendar/CalendarView.swift

struct HomeworkScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var selectedKidID: String?
    @State private var selectedHomeworkID: String?
    /// A per-assignment draft survives model refreshes and temporary filter changes.
    @State private var checklistDrafts: [String: String] = [:]

    private var activeKidID: String? {
        guard store.isParent, let selectedKidID else { return nil }
        return store.kids.contains(where: { $0.id == selectedKidID }) ? selectedKidID : nil
    }

    private var selectedKidName: String? {
        guard let activeKidID else { return nil }
        return store.kids.first(where: { $0.id == activeKidID })?.name
    }

    /// Kid sessions are already scoped by the server. Parents can narrow the
    /// family list while unassigned family homework remains visible.
    private var visibleHomework: [HomeworkItem] {
        guard let activeKidID else { return store.homework }
        return store.homework.filter { $0.kidId == nil || $0.kidId == activeKidID }
    }

    private var orderedHomework: [HomeworkItem] {
        visibleHomework.sorted { lhs, rhs in
            if lhs.isDone != rhs.isDone { return !lhs.isDone }
            if lhs.dueDate != rhs.dueDate { return lhs.dueDate < rhs.dueDate }
            if (lhs.dueTime ?? "") != (rhs.dueTime ?? "") {
                return (lhs.dueTime ?? "") < (rhs.dueTime ?? "")
            }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    private var selectedHomework: HomeworkItem? {
        guard let selectedHomeworkID else { return nil }
        return orderedHomework.first { $0.id == selectedHomeworkID }
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            if horizontalSizeClass == .regular { regularWorkspace } else { compactWorkspace }
        }
        .onAppear(perform: reconcileSelection)
        .onChange(of: orderedHomework.map(\.id)) { _, _ in reconcileSelection() }
        .onChange(of: store.kids.map(\.id)) { _, kidIDs in
            guard let selectedKidID, !kidIDs.contains(selectedKidID) else { return }
            self.selectedKidID = nil
        }
    }

    private var regularWorkspace: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, Space.xxl)
                .padding(.vertical, Space.xl)
            Divider()
            GeometryReader { proxy in
                HStack(spacing: 0) {
                    homeworkQueue.frame(width: queueWidth(for: proxy.size.width))
                    Divider()
                    detailPane.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
    }

    private var compactWorkspace: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Space.lg) {
                header
                if store.isParent, !store.kids.isEmpty {
                    HomeworkKidFilter(kids: store.kids, selectedKidID: $selectedKidID)
                }
                listHeading
                if orderedHomework.isEmpty {
                    if store.isRefreshing {
                        HomeworkLoadingState()
                    } else {
                        HomeworkEmptyState(
                            isParent: store.isParent,
                            selectedKidName: selectedKidName,
                            hasAnyHomework: !store.homework.isEmpty
                        )
                    }
                } else {
                    LazyVStack(spacing: Space.sm) {
                        ForEach(orderedHomework) { item in
                            HomeworkCompactRow(
                                item: item,
                                kidName: kidName(for: item),
                                onToggle: { setCompletion(for: item) }
                            )
                        }
                    }
                }
            }
            .padding(Space.lg)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .contentMargins(.bottom, Layout.tabBarClearance, for: .scrollContent)
        .scrollIndicators(.hidden)
        .refreshable { await store.refreshDashboard() }
    }

    private var homeworkQueue: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Space.md) {
                listHeading
                if store.isParent, !store.kids.isEmpty {
                    HomeworkKidFilter(kids: store.kids, selectedKidID: $selectedKidID)
                }
            }
            .padding(Space.lg)
            Divider()
            ScrollView {
                if orderedHomework.isEmpty {
                    if store.isRefreshing {
                        HomeworkLoadingState().padding(Space.lg)
                    } else {
                        HomeworkEmptyState(
                            isParent: store.isParent,
                            selectedKidName: selectedKidName,
                            hasAnyHomework: !store.homework.isEmpty,
                            usesCard: false
                        )
                        .padding(Space.lg)
                    }
                } else {
                    LazyVStack(spacing: 1) {
                        ForEach(orderedHomework) { item in
                            HomeworkQueueRow(
                                item: item,
                                kidName: kidName(for: item),
                                isSelected: selectedHomeworkID == item.id,
                                onSelect: {
                                    Haptics.selection()
                                    selectedHomeworkID = item.id
                                },
                                onToggle: { setCompletion(for: item) }
                            )
                        }
                    }
                    .padding(.vertical, Space.sm)
                }
            }
            .scrollIndicators(.hidden)
            .refreshable { await store.refreshDashboard() }
        }
        .background(Palette.panel.opacity(0.55))
    }

    @ViewBuilder
    private var detailPane: some View {
        if let item = selectedHomework {
            HomeworkAssignmentDetail(
                item: item,
                kidName: kidName(for: item),
                draftStep: draftBinding(for: item.id)
            )
            .id(item.id)
        } else if store.isRefreshing {
            HomeworkLoadingState().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            HomeworkDetailEmptyState().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: Space.md) {
            VStack(alignment: .leading, spacing: Space.xs) {
                MicroLabel(text: store.isParent ? "Family homework" : "Your homework")
                Text("Homework").font(Typography.largeTitle).foregroundStyle(Palette.text)
                Text(store.isParent
                     ? "See what is due, choose an assignment, and plan the next step."
                     : "Start with the smallest useful step, then keep moving.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .layoutPriority(1)
            Spacer(minLength: Space.sm)
            Image(systemName: "book.closed.fill")
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(Palette.accent)
                .frame(width: 48, height: 48)
                .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                .accessibilityHidden(true)
        }
    }

    private var listHeading: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: Space.xs) {
                MicroLabel(text: store.isParent ? "Assignments" : "Your list")
                Text("\(orderedHomework.filter { !$0.isDone }.count) open")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            Spacer(minLength: Space.sm)
            Text(orderedHomework.count == 1 ? "1 assignment" : "\(orderedHomework.count) assignments")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
        }
    }

    private func queueWidth(for width: CGFloat) -> CGFloat {
        min(390, max(330, width * 0.34))
    }

    private func reconcileSelection() {
        if let selectedHomeworkID, orderedHomework.contains(where: { $0.id == selectedHomeworkID }) { return }
        selectedHomeworkID = orderedHomework.first(where: { !$0.isDone })?.id ?? orderedHomework.first?.id
    }

    private func draftBinding(for homeworkID: String) -> Binding<String> {
        Binding(
            get: { checklistDrafts[homeworkID] ?? "" },
            set: { checklistDrafts[homeworkID] = String($0.prefix(200)) }
        )
    }

    private func kidName(for item: HomeworkItem) -> String? {
        guard store.isParent else { return nil }
        guard let kidID = item.kidId else { return "Family" }
        return store.kids.first(where: { $0.id == kidID })?.name ?? "Family"
    }

    private func setCompletion(for item: HomeworkItem) {
        Haptics.selection()
        Task { await store.setHomeworkStatus(item, status: item.isDone ? "todo" : "done") }
    }
}

private struct HomeworkKidFilter: View {
    let kids: [Kid]
    @Binding var selectedKidID: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            MicroLabel(text: "Filter by child")
            ScrollView(.horizontal) {
                HStack(spacing: Space.sm) {
                    HomeworkFilterChip(title: "All kids", isSelected: selectedKidID == nil) { selectedKidID = nil }
                    ForEach(kids) { kid in
                        HomeworkFilterChip(title: kid.name, isSelected: selectedKidID == kid.id) {
                            selectedKidID = kid.id
                        }
                    }
                }
                .padding(.vertical, 1)
            }
            .scrollIndicators(.hidden)
        }
        .accessibilityElement(children: .contain)
    }
}

private struct HomeworkFilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.xs) {
                if isSelected { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)) }
                Text(title).lineLimit(1)
            }
            .font(Typography.label.weight(.semibold))
            .foregroundStyle(isSelected ? Palette.onAccent : Palette.textSecond)
            .padding(.horizontal, Space.md)
            .frame(minHeight: 44)
            .background(isSelected ? Palette.accent : Palette.panel2, in: Capsule())
            .overlay { if !isSelected { Capsule().strokeBorder(Palette.border, lineWidth: 1) } }
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .accessibilityLabel("Show homework for \(title)")
        .accessibilityValue(isSelected ? "Selected" : "Not selected")
    }
}

private struct HomeworkQueueRow: View {
    let item: HomeworkItem
    let kidName: String?
    let isSelected: Bool
    let onSelect: () -> Void
    let onToggle: () -> Void

    private var dueState: HomeworkDueState { HomeworkDueState(item: item, todayKey: Agenda.todayKey()) }
    private var checklistSummary: String {
        guard !item.checklistItems.isEmpty else { return "No steps planned" }
        return "\(item.checklistItems.filter(\.done).count) of \(item.checklistItems.count) steps complete"
    }

    var body: some View {
        HStack(alignment: .top, spacing: Space.sm) {
            HomeworkCompletionButton(item: item, action: onToggle)
            Button(action: onSelect) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                        Text(item.title)
                            .font(Typography.cardTitle)
                            .foregroundStyle(item.isDone ? Palette.textSecond : Palette.text)
                            .strikethrough(item.isDone, color: Palette.textSecond)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(isSelected ? Palette.accent : Palette.textSecond)
                            .accessibilityHidden(true)
                    }
                    if let subject = HomeworkCopy.nonEmpty(item.subject) {
                        Text(subject).font(Typography.caption).foregroundStyle(Palette.textSecond)
                    }
                    Label(dueState.detail, systemImage: dueState.systemImage)
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(item.isDone ? Palette.textSecond : dueState.color)
                    HStack(spacing: Space.sm) {
                        HomeworkStatusLabel(status: item.status)
                        if let kidName {
                            Label(kidName, systemImage: "person.fill")
                                .font(Typography.caption).foregroundStyle(Palette.textSecond)
                        }
                    }
                    Text(checklistSummary).font(Typography.caption).foregroundStyle(Palette.textSecond)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.title)
            .accessibilityValue([HomeworkCopy.status(item.status), dueState.detail, checklistSummary, kidName]
                .compactMap { $0 }.joined(separator: ", "))
            .accessibilityHint("Shows this assignment while keeping the queue available")
            .accessibilityAddTraits(isSelected ? .isSelected : [])
        }
        .padding(.horizontal, Space.lg)
        .padding(.vertical, Space.md)
        .background(isSelected ? Palette.accentSoft : Color.clear)
        .overlay(alignment: .leading) {
            Rectangle().fill(isSelected ? Palette.accent : Color.clear).frame(width: 3)
        }
        .opacity(item.isDone ? 0.8 : 1)
    }
}

private struct HomeworkCompactRow: View {
    let item: HomeworkItem
    let kidName: String?
    let onToggle: () -> Void

    private var dueState: HomeworkDueState { HomeworkDueState(item: item, todayKey: Agenda.todayKey()) }

    var body: some View {
        Card(padding: Space.lg) {
            HStack(alignment: .top, spacing: Space.md) {
                HomeworkCompletionButton(item: item, action: onToggle)
                VStack(alignment: .leading, spacing: Space.sm) {
                    Text(item.title)
                        .font(Typography.cardTitle)
                        .foregroundStyle(item.isDone ? Palette.textSecond : Palette.text)
                        .strikethrough(item.isDone, color: Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                    if let subject = HomeworkCopy.nonEmpty(item.subject) {
                        Text(subject).font(Typography.caption).foregroundStyle(Palette.textSecond)
                    }
                    Label(dueState.detail, systemImage: dueState.systemImage)
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(item.isDone ? Palette.textSecond : dueState.color)
                    HStack(spacing: Space.sm) {
                        HomeworkStatusLabel(status: item.status)
                        if let kidName {
                            Label(kidName, systemImage: "person.fill")
                                .font(Typography.caption).foregroundStyle(Palette.textSecond)
                        }
                    }
                    if item.checklistItems.isEmpty {
                        Text("Plan this assignment by adding one small step on iPad.")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                    } else {
                        Text("\(item.checklistItems.filter(\.done).count) of \(item.checklistItems.count) steps complete")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                        if let nextStep = item.firstIncompleteChecklistItem {
                            Text("Next step: \(nextStep.text)")
                                .font(Typography.body.weight(.semibold))
                                .foregroundStyle(Palette.text)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .layoutPriority(1)
                Spacer(minLength: 0)
            }
        }
        .opacity(item.isDone ? 0.78 : 1)
    }
}

private struct HomeworkCompletionButton: View {
    let item: HomeworkItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: item.isDone ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 27, weight: .semibold))
                .foregroundStyle(item.isDone ? Palette.accent : Palette.textSecond)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.isDone ? "Mark \(item.title) incomplete" : "Mark \(item.title) complete")
        .accessibilityValue(item.isDone ? "Completed" : "Not completed")
        .accessibilityHint("Updates the assignment status without opening it")
    }
}

private struct HomeworkAssignmentDetail: View {
    @Environment(AppStore.self) private var store
    let item: HomeworkItem
    let kidName: String?
    @Binding var draftStep: String

    private var dueState: HomeworkDueState { HomeworkDueState(item: item, todayKey: Agenda.todayKey()) }
    private var completedStepCount: Int { item.checklistItems.filter(\.done).count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.xxl) {
                context
                nextStep
                checklist
                assignmentActions
            }
            .padding(Space.xxl)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.hidden)
        .background(Palette.bg)
    }

    private var context: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            MicroLabel(text: "Selected assignment")
            Text(item.title).font(Typography.title).foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            if let subject = HomeworkCopy.nonEmpty(item.subject) {
                Text(subject).font(Typography.body).foregroundStyle(Palette.textSecond)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.md) { contextLabels }
                VStack(alignment: .leading, spacing: Space.sm) { contextLabels }
            }
        }
    }

    @ViewBuilder private var contextLabels: some View {
        Label(dueState.detail, systemImage: dueState.systemImage)
            .font(Typography.label.weight(.semibold))
            .foregroundStyle(item.isDone ? Palette.textSecond : dueState.color)
        HomeworkStatusLabel(status: item.status)
        if let effortMin = item.effortMin, effortMin > 0 {
            Label(HomeworkCopy.effort(effortMin), systemImage: "hourglass")
                .font(Typography.label).foregroundStyle(Palette.textSecond)
        }
        if let kidName {
            Label(kidName, systemImage: "person.fill")
                .font(Typography.label).foregroundStyle(Palette.textSecond)
        }
    }

    private var nextStep: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            MicroLabel(text: "Next step")
            if item.isDone {
                Text("This assignment is finished.").font(Typography.cardTitle).foregroundStyle(Palette.text)
            } else if let step = item.firstIncompleteChecklistItem {
                Text(step.text).font(Typography.title).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
            } else if item.checklistItems.isEmpty {
                Text("Break it down").font(Typography.title).foregroundStyle(Palette.text)
                Text("Enter the smallest action you can do in roughly 10–20 minutes.")
                    .font(Typography.body).foregroundStyle(Palette.textSecond)
            } else {
                Text("Review your work, then finish the assignment.")
                    .font(Typography.cardTitle).foregroundStyle(Palette.text)
            }
        }
        .padding(Space.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var checklist: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                VStack(alignment: .leading, spacing: Space.xs) {
                    MicroLabel(text: "Plan this assignment")
                    Text(checklistProgress).font(Typography.caption).foregroundStyle(Palette.textSecond)
                }
                Spacer(minLength: Space.sm)
                if !item.checklistItems.isEmpty {
                    ProgressView(value: Double(completedStepCount), total: Double(item.checklistItems.count))
                        .frame(maxWidth: 160)
                        .tint(Palette.accent)
                        .accessibilityLabel("Checklist progress")
                        .accessibilityValue(checklistProgress)
                }
            }
            if item.checklistItems.isEmpty {
                Text("Add one clear action. You can add more after that.")
                    .font(Typography.body).foregroundStyle(Palette.textSecond)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(item.checklistItems.enumerated()), id: \.offset) { index, step in
                        HomeworkChecklistRow(
                            step: step,
                            isNextStep: index == item.firstIncompleteChecklistIndex,
                            onToggle: { toggleStep(at: index, done: !step.done) },
                            onDelete: { deleteStep(at: index) }
                        )
                        if index < item.checklistItems.count - 1 { Divider() }
                    }
                }
                .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                        .strokeBorder(Palette.border, lineWidth: 1)
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.sm) { stepTextField; addStepButton }
                VStack(alignment: .leading, spacing: Space.sm) { stepTextField; addStepButton }
            }
        }
    }

    private var stepTextField: some View {
        TextField("Smallest next action", text: $draftStep)
            .font(Typography.body)
            .textInputAutocapitalization(.sentences)
            .submitLabel(.done)
            .onSubmit(addStep)
            .padding(.horizontal, Space.md)
            .frame(minHeight: 48)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                    .strokeBorder(Palette.border, lineWidth: 1)
            }
            .accessibilityLabel("New checklist step")
            .accessibilityHint("Enter a concise action of up to 200 characters")
    }

    private var addStepButton: some View {
        Button(action: addStep) {
            Label("Add step", systemImage: "plus")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.onAccent)
                .padding(.horizontal, Space.lg)
                .frame(minHeight: 48)
                .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .disabled(normalizedDraft.isEmpty)
        .opacity(normalizedDraft.isEmpty ? 0.55 : 1)
        .accessibilityHint("Adds this step to the assignment plan")
    }

    private var assignmentActions: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            MicroLabel(text: "Assignment status")
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.md) { statusActions }
                VStack(alignment: .leading, spacing: Space.md) { statusActions }
            }
        }
    }

    @ViewBuilder private var statusActions: some View {
        if item.status == "todo" {
            HomeworkActionButton(title: "Start work", systemImage: "play.fill", isPrimary: true,
                                 hint: "Marks this assignment in progress without completing it") {
                Task { await store.setHomeworkStatus(item, status: "in_progress") }
            }
        }
        if !item.isDone {
            HomeworkActionButton(title: "Finish assignment", systemImage: "checkmark",
                                 isPrimary: item.status != "todo", hint: "Marks the whole assignment complete") {
                Task { await store.setHomeworkStatus(item, status: "done") }
            }
        } else {
            Label("Assignment finished", systemImage: "checkmark.circle.fill")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.green)
                .frame(minHeight: 44)
        }
    }

    private var checklistProgress: String {
        guard !item.checklistItems.isEmpty else { return "No steps yet" }
        return "\(completedStepCount) of \(item.checklistItems.count) steps complete"
    }
    private var normalizedDraft: String {
        String(draftStep.prefix(200)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func addStep() {
        let text = normalizedDraft
        guard !text.isEmpty else { return }
        let updated = item.checklistItems + [HomeworkChecklistItem(text: text, done: false)]
        Task { await store.replaceHomeworkChecklist(item, checklist: updated) }
        draftStep = ""
    }

    private func toggleStep(at index: Int, done: Bool) {
        guard item.checklistItems.indices.contains(index) else { return }
        Haptics.selection()
        Task { await store.setHomeworkChecklistStep(item, index: index, done: done) }
    }

    private func deleteStep(at index: Int) {
        guard item.checklistItems.indices.contains(index) else { return }
        var updated = item.checklistItems
        updated.remove(at: index)
        Task { await store.replaceHomeworkChecklist(item, checklist: updated) }
    }
}

private struct HomeworkChecklistRow: View {
    let step: HomeworkChecklistItem
    let isNextStep: Bool
    let onToggle: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Space.sm) {
            Button(action: onToggle) {
                Image(systemName: step.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 23, weight: .semibold))
                    .foregroundStyle(step.done ? Palette.accent : Palette.textSecond)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(step.done ? "Mark step incomplete" : "Mark step done")
            .accessibilityValue(step.text)
            .accessibilityHint("Updates only this checklist step")
            VStack(alignment: .leading, spacing: Space.xs) {
                if isNextStep { MicroLabel(text: "Start here") }
                Text(step.text)
                    .font(Typography.body.weight(isNextStep ? .semibold : .regular))
                    .foregroundStyle(step.done ? Palette.textSecond : Palette.text)
                    .strikethrough(step.done, color: Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.vertical, Space.xs)
            Button(role: .destructive, action: onDelete) {
                Image(systemName: "trash")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Palette.red)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Delete step: \(step.text)")
            .accessibilityHint("Removes this step from the assignment plan")
        }
        .padding(.horizontal, Space.sm)
        .padding(.vertical, Space.xs)
    }
}

private struct HomeworkActionButton: View {
    let title: String
    let systemImage: String
    let isPrimary: Bool
    let hint: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(isPrimary ? Palette.onAccent : Palette.text)
                .padding(.horizontal, Space.lg)
                .frame(minHeight: 48)
                .background(isPrimary ? Palette.accent : Palette.panel,
                            in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                .overlay {
                    if !isPrimary {
                        RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                            .strokeBorder(Palette.border, lineWidth: 1)
                    }
                }
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .accessibilityHint(hint)
    }
}

private struct HomeworkStatusLabel: View {
    let status: String
    var body: some View {
        Text(HomeworkCopy.status(status))
            .font(Typography.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, Space.sm)
            .frame(minHeight: 24)
            .background(color.opacity(0.1), in: Capsule())
            .accessibilityLabel("Status")
            .accessibilityValue(HomeworkCopy.status(status))
    }
    private var color: Color {
        switch status {
        case "done": return Palette.green
        case "in_progress": return Palette.accent
        default: return Palette.textSecond
        }
    }
}

private struct HomeworkLoadingState: View {
    var body: some View {
        VStack(spacing: Space.md) {
            ProgressView().tint(Palette.accent)
            Text("Loading homework…").font(Typography.body).foregroundStyle(Palette.textSecond)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .accessibilityElement(children: .combine)
    }
}

private struct HomeworkDetailEmptyState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Image(systemName: "book.closed").font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Palette.accent).accessibilityHidden(true)
            Text("Choose an assignment").font(Typography.title).foregroundStyle(Palette.text)
            Text("Its next step and plan will stay visible here while you browse the queue.")
                .font(Typography.body).foregroundStyle(Palette.textSecond)
        }
        .padding(Space.xxl)
    }
}

private struct HomeworkEmptyState: View {
    let isParent: Bool
    let selectedKidName: String?
    let hasAnyHomework: Bool
    var usesCard = true

    private var title: String {
        if let selectedKidName, hasAnyHomework { return "Nothing for \(selectedKidName)" }
        return isParent ? "No homework yet" : "Nothing on your list yet"
    }
    private var message: String {
        if selectedKidName != nil, hasAnyHomework {
            return "There are no assignments for this child right now. Try All kids to see the whole family list."
        }
        return isParent
            ? "When an assignment arrives, it will show up here with its subject and due date."
            : "When a new assignment arrives, it will show up here."
    }
    var body: some View {
        Group {
            if usesCard { Card(padding: Space.xl) { content } } else { content }
        }
    }
    private var content: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Image(systemName: hasAnyHomework ? "line.3.horizontal.decrease.circle" : "book.closed.fill")
                .font(.system(size: 28, weight: .semibold)).foregroundStyle(Palette.accent)
                .accessibilityHidden(true)
            Text(title).font(Typography.cardTitle).foregroundStyle(Palette.text)
            Text(message).font(Typography.body).foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct HomeworkDueState {
    enum Kind { case overdue, today, upcoming }
    let kind: Kind
    let dateText: String
    let timeText: String?

    init(item: HomeworkItem, todayKey: String) {
        if item.dueDate < todayKey { kind = .overdue }
        else if item.dueDate == todayKey { kind = .today }
        else { kind = .upcoming }
        dateText = HomeworkDate.displayDate(item.dueDate)
        timeText = HomeworkDate.displayTime(item.dueTime)
    }
    var detail: String {
        switch kind {
        case .overdue: return "Overdue · \(dateText)\(timeSuffix)"
        case .today: return "Today\(timeSuffix)"
        case .upcoming: return "Upcoming · \(dateText)\(timeSuffix)"
        }
    }
    var systemImage: String {
        switch kind { case .overdue: return "exclamationmark.circle.fill"; case .today: return "clock.fill"; case .upcoming: return "calendar" }
    }
    var color: Color {
        switch kind { case .overdue: return Palette.red; case .today: return Palette.warn; case .upcoming: return Palette.textSecond }
    }
    private var timeSuffix: String { timeText.map { " at \($0)" } ?? "" }
}

private enum HomeworkCopy {
    static func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
    static func status(_ value: String) -> String {
        switch value { case "in_progress": return "In progress"; case "done": return "Completed"; default: return "Not started" }
    }
    static func effort(_ minutes: Int) -> String {
        guard minutes >= 60 else { return "About \(minutes) min" }
        let hours = minutes / 60, remainder = minutes % 60
        if remainder == 0 { return hours == 1 ? "About 1 hr" : "About \(hours) hr" }
        return "About \(hours) hr \(remainder) min"
    }
}

private enum HomeworkDate {
    private static let inputTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale.autoupdatingCurrent
        formatter.dateFormat = "HH:mm"
        return formatter
    }()
    private static let outputTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale.autoupdatingCurrent
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
    static func displayDate(_ value: String) -> String {
        guard let date = DateFmt.ymd.date(from: value) else { return value }
        return DateFmt.monthDay.string(from: date)
    }
    static func displayTime(_ value: String?) -> String? {
        guard let value, !value.isEmpty, let date = inputTime.date(from: value) else { return value }
        return outputTime.string(from: date)
    }
}
