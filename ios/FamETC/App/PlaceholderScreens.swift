import Foundation
import SwiftUI

// TodayScreen  → Features/Today/TodayView.swift
// ChatScreen   → Features/Chat/ChatView.swift
// CalendarScreen → Features/Calendar/CalendarView.swift

struct HomeworkScreen: View {
    @Environment(AppStore.self) private var store
    @State private var selectedKidID: String?

    private var activeKidID: String? {
        guard store.isParent, let selectedKidID else { return nil }
        return store.kids.contains(where: { $0.id == selectedKidID }) ? selectedKidID : nil
    }

    private var selectedKidName: String? {
        guard let activeKidID else { return nil }
        return store.kids.first(where: { $0.id == activeKidID })?.name
    }

    /// The server scopes a kid's homework list before it reaches AppStore. A
    /// parent can narrow that family list to one kid, while unassigned family
    /// homework remains visible in every kid filter.
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

    private var completedCount: Int {
        visibleHomework.filter(\.isDone).count
    }

    var body: some View {
        ZStack {
            ScreenBackground()

            ScrollView {
                LazyVStack(alignment: .leading, spacing: Space.lg) {
                    header

                    HomeworkProgressCard(
                        completedCount: completedCount,
                        totalCount: visibleHomework.count,
                        title: selectedKidName.map { "\($0)'s progress" } ?? (store.isParent ? "Family progress" : "Your progress"),
                        isParent: store.isParent
                    )

                    if store.isParent, !store.kids.isEmpty {
                        HomeworkKidFilter(kids: store.kids, selectedKidID: $selectedKidID)
                    }

                    if orderedHomework.isEmpty {
                        HomeworkEmptyState(
                            isParent: store.isParent,
                            selectedKidName: selectedKidName,
                            hasAnyHomework: !store.homework.isEmpty
                        )
                    } else {
                        homeworkList
                    }
                }
                .padding(Space.lg)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .contentMargins(.bottom, Layout.tabBarClearance, for: .scrollContent)
            .scrollIndicators(.hidden)
            .refreshable {
                await store.refreshDashboard()
            }
            .onChange(of: store.kids.map(\.id)) { _, kidIDs in
                guard let selectedKidID, !kidIDs.contains(selectedKidID) else { return }
                self.selectedKidID = nil
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: Space.md) {
            VStack(alignment: .leading, spacing: Space.xs) {
                MicroLabel(text: store.isParent ? "Family homework" : "Your homework")
                Text("Homework")
                    .font(Typography.largeTitle)
                    .foregroundStyle(Palette.text)
                Text(store.isParent
                     ? "A clear view of what everyone needs next."
                     : "One small win at a time — you’ve got this.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .layoutPriority(1)

            Spacer(minLength: Space.sm)

            Image(systemName: store.isParent ? "person.2.fill" : "sparkles")
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(Palette.accent)
                .frame(width: 48, height: 48)
                .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                .accessibilityHidden(true)
        }
    }

    private var homeworkList: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            HStack(alignment: .firstTextBaseline) {
                MicroLabel(text: store.isParent ? "Assignments" : "Your list")
                Spacer(minLength: Space.sm)
                Text(assignmentCountLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }

            LazyVStack(spacing: Space.sm) {
                ForEach(orderedHomework) { item in
                    HomeworkRow(item: item, kidName: kidName(for: item)) {
                        Haptics.selection()
                        Task { await store.toggleHomeworkDone(item) }
                    }
                }
            }
        }
    }

    private var assignmentCountLabel: String {
        let count = orderedHomework.count
        return count == 1 ? "1 assignment" : "\(count) assignments"
    }

    private func kidName(for item: HomeworkItem) -> String? {
        guard store.isParent else { return nil }
        guard let kidID = item.kidId else { return "Family" }
        return store.kids.first(where: { $0.id == kidID })?.name ?? "Family"
    }
}

private struct HomeworkProgressCard: View {
    let completedCount: Int
    let totalCount: Int
    let title: String
    let isParent: Bool

    private var fraction: Double {
        guard totalCount > 0 else { return 0 }
        return Double(completedCount) / Double(totalCount)
    }

    private var progressCopy: String {
        guard totalCount > 0 else {
            return isParent ? "No assignments to track yet." : "Your list is ready when homework arrives."
        }
        if completedCount == totalCount {
            return isParent ? "The list is clear — nice family teamwork." : "All clear — nice work."
        }
        if completedCount == 0 {
            return isParent ? "Choose one next step to get the family moving." : "Choose one small task to get started."
        }
        return isParent ? "Good momentum — keep the next step simple." : "Great start — keep going."
    }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(alignment: .top, spacing: Space.md) {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        MicroLabel(text: title)
                        Text("\(completedCount) of \(totalCount) complete")
                            .font(Typography.statNumber)
                            .foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: Space.sm)

                    Image(systemName: totalCount > 0 && completedCount == totalCount
                          ? "checkmark.seal.fill"
                          : "book.closed.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(totalCount > 0 && completedCount == totalCount ? Palette.green : Palette.accent)
                        .frame(width: 44, height: 44)
                        .background(Palette.accentSoft, in: Circle())
                        .accessibilityHidden(true)
                }

                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Palette.accentSoft)
                        Capsule()
                            .fill(Signal.gradient())
                            .frame(width: proxy.size.width * fraction)
                    }
                }
                .frame(height: 10)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Homework progress")
                .accessibilityValue("\(completedCount) of \(totalCount) complete")

                Text(progressCopy)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
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
                    HomeworkFilterChip(
                        title: "All kids",
                        isSelected: selectedKidID == nil
                    ) {
                        selectedKidID = nil
                    }

                    ForEach(kids) { kid in
                        HomeworkFilterChip(
                            title: kid.name,
                            isSelected: selectedKidID == kid.id
                        ) {
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
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                }
                Text(title)
                    .lineLimit(1)
            }
            .font(Typography.label.weight(.semibold))
            .foregroundStyle(isSelected ? Palette.onAccent : Palette.textSecond)
            .padding(.horizontal, Space.md)
            .frame(minHeight: 44)
            .background(
                isSelected ? Palette.accent : Palette.panel2,
                in: Capsule()
            )
            .overlay {
                if !isSelected {
                    Capsule().strokeBorder(Palette.border, lineWidth: 1)
                }
            }
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .accessibilityLabel("Show homework for \(title)")
        .accessibilityValue(isSelected ? "Selected" : "Not selected")
    }
}

private struct HomeworkRow: View {
    let item: HomeworkItem
    let kidName: String?
    let onToggle: () -> Void

    private var dueState: HomeworkDueState {
        HomeworkDueState(item: item, todayKey: Agenda.todayKey())
    }

    var body: some View {
        Card(padding: Space.lg) {
            HStack(alignment: .top, spacing: Space.md) {
                Button(action: onToggle) {
                    Image(systemName: item.isDone ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(item.isDone ? Palette.accent : Palette.textSecond)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.isDone
                                    ? "Mark \(item.title) incomplete"
                                    : "Mark \(item.title) complete")
                .accessibilityValue(item.isDone ? "Completed" : "Not completed")
                .accessibilityHint("Updates the homework status")

                VStack(alignment: .leading, spacing: Space.sm) {
                    Text(item.title)
                        .font(Typography.cardTitle)
                        .foregroundStyle(item.isDone ? Palette.textSecond : Palette.text)
                        .strikethrough(item.isDone, color: Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)

                    VStack(alignment: .leading, spacing: Space.xs) {
                        if let subject = item.subject?.trimmingCharacters(in: .whitespacesAndNewlines), !subject.isEmpty {
                            Text(subject)
                                .font(Typography.caption)
                                .foregroundStyle(Palette.textSecond)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        HStack(alignment: .firstTextBaseline, spacing: Space.xs) {
                            Image(systemName: dueState.systemImage)
                                .font(.system(size: 12, weight: .semibold))
                            Text(dueState.detail)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(item.isDone ? Palette.textSecond : dueState.color)

                        if let kidName {
                            HStack(alignment: .firstTextBaseline, spacing: Space.xs) {
                                Image(systemName: "person.fill")
                                    .font(.system(size: 11, weight: .semibold))
                                Text(kidName)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
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

private struct HomeworkEmptyState: View {
    let isParent: Bool
    let selectedKidName: String?
    let hasAnyHomework: Bool

    private var title: String {
        if let selectedKidName, hasAnyHomework {
            return "Nothing for \(selectedKidName)"
        }
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
        Card(padding: Space.xl) {
            VStack(alignment: .leading, spacing: Space.md) {
                Image(systemName: hasAnyHomework ? "checkmark.seal.fill" : "book.closed.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Palette.accent)

                Text(title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.text)

                Text(message)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct HomeworkDueState {
    enum Kind {
        case overdue
        case today
        case upcoming
    }

    let kind: Kind
    let dateText: String
    let timeText: String?

    init(item: HomeworkItem, todayKey: String) {
        if item.dueDate < todayKey {
            kind = .overdue
        } else if item.dueDate == todayKey {
            kind = .today
        } else {
            kind = .upcoming
        }
        dateText = HomeworkDate.displayDate(item.dueDate)
        timeText = HomeworkDate.displayTime(item.dueTime)
    }

    var detail: String {
        switch kind {
        case .overdue:
            return "Overdue · \(dateText)\(timeSuffix)"
        case .today:
            return "Today\(timeSuffix)"
        case .upcoming:
            return "Upcoming · \(dateText)\(timeSuffix)"
        }
    }

    var systemImage: String {
        switch kind {
        case .overdue: return "exclamationmark.circle.fill"
        case .today: return "clock.fill"
        case .upcoming: return "calendar"
        }
    }

    var color: Color {
        switch kind {
        case .overdue: return Palette.red
        case .today: return Palette.warn
        case .upcoming: return Palette.textSecond
        }
    }

    private var timeSuffix: String {
        guard let timeText else { return "" }
        return " at \(timeText)"
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
        guard let value, !value.isEmpty, let date = inputTime.date(from: value) else {
            return value
        }
        return outputTime.string(from: date)
    }
}
