import SwiftUI
import WatchKit

/// Screen 8 "My list": today's homework (orange) and chores (teal) with ring
/// checkboxes and an "n of m" progress ring. Pushed from the chat root's to-do
/// capsule; Now/Day/More and settings stay one tap further down.
struct MyListView: View {
    @EnvironmentObject private var store: WatchStore
    @State private var done: WatchDoneSummary?
    @State private var working: String?
    private let onDisconnect: () -> Void

    init(onDisconnect: @escaping () -> Void = {}) {
        self.onDisconnect = onDisconnect
    }

    var body: some View {
        TimelineView(.everyMinute) { clock in
            let items = WatchMyList.items(snapshot: store.snapshot, now: clock.date)
            let finished = items.filter(\.isDone).count
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        WatchMyListRing(done: finished, total: items.count, lineWidth: 3)
                            .frame(width: 18, height: 18)
                        Text(items.isEmpty ? "Nothing yet today" : "\(finished) of \(items.count)")
                            .font(.system(.footnote, design: .rounded).weight(.heavy))
                            .foregroundStyle(WatchMyListPalette.chore)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(items.isEmpty ? "Nothing on your list today" : "\(finished) of \(items.count) done")

                    if items.isEmpty {
                        Text(store.snapshot.updatedAt == nil ? "Your list is on its way." : "All clear. Enjoy your day!")
                            .font(.system(.footnote, design: .rounded).weight(.semibold))
                            .foregroundStyle(WatchMyListPalette.secondaryLight)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.vertical, 4)
                    }
                    ForEach(items) { item in row(item, at: clock.date) }

                    if reminderNeedsEnabling {
                        Button {
                            Task { await store.enableReminders() }
                        } label: {
                            capsuleLabel("Turn on reminders", symbol: "bell.badge.fill", tint: WatchMyListPalette.violet)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 4)
                    }

                    Text("More")
                        .font(.system(.caption2, design: .rounded).weight(.bold))
                        .foregroundStyle(WatchMyListPalette.secondary)
                        .padding(.top, 8)
                    NavigationLink { MyNextView(onDisconnect: onDisconnect) } label: {
                        capsuleLabel("Now, Day & More", symbol: "sun.max.fill", tint: WatchMyListPalette.violet)
                    }
                    .buttonStyle(.plain)
                    NavigationLink { WatchConnectionView(onDisconnect: onDisconnect) } label: {
                        capsuleLabel("Settings & sync", symbol: "gearshape.fill", tint: WatchMyListPalette.secondaryLight)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 12)
            }
        }
        .navigationTitle("My list")
        .fontDesign(.rounded)
        .tint(WatchMyListPalette.violet)
        .sheet(item: $done) { summary in
            WatchDoneView(summary: summary) { done = nil }
        }
    }

    private var reminderNeedsEnabling: Bool {
        ["Turn on gentle reminders", "Enable reminders to get a nudge", "Reminders are off in Settings"].contains(store.reminderStatus)
    }

    private func color(_ item: WatchMyListItem) -> Color {
        item.kind == .homework ? WatchMyListPalette.homework : WatchMyListPalette.chore
    }

    @ViewBuilder
    private func row(_ item: WatchMyListItem, at now: Date) -> some View {
        HStack(spacing: 4) {
            Button {
                complete(item)
            } label: {
                ZStack {
                    if item.isDone {
                        Circle().fill(WatchMyListPalette.chore)
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(.black)
                    } else {
                        Circle().strokeBorder(color(item), lineWidth: 2.5)
                        if working == item.id { ProgressView().scaleEffect(0.5) }
                    }
                }
                .frame(width: 22, height: 22)
                .frame(width: 34, height: 38)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(item.isDone || working != nil)
            .accessibilityLabel(item.isDone ? "\(item.title), done" : "Complete \(item.title)")
            .accessibilityHint(item.kind == .fams && !item.isDone ? "Sends it to a parent to OK." : "")

            if case .homework(let work) = item.source, !item.isDone {
                NavigationLink { HomeworkDetailView(item: work) } label: { rowText(item, at: now) }
                    .buttonStyle(.plain)
            } else {
                rowText(item, at: now)
            }
        }
        .padding(.trailing, 6)
        .frame(minHeight: 38)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(WatchMyListPalette.control))
    }

    private func rowText(_ item: WatchMyListItem, at now: Date) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(item.title)
                .font(.system(.footnote, design: .rounded).weight(.bold))
                .foregroundStyle(item.isDone ? WatchMyListPalette.secondary : .white)
                .strikethrough(item.isDone, color: WatchMyListPalette.secondary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            if let detail = detail(item, at: now) {
                Text(detail)
                    .font(.system(.caption2, design: .rounded).weight(.semibold))
                    .foregroundStyle(item.isDone ? WatchMyListPalette.secondary : color(item))
                    .lineLimit(1)
            }
            if let amount = item.famsAmount, !item.isDone { WatchFamsChip(amount: amount) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }

    private func detail(_ item: WatchMyListItem, at now: Date) -> String? {
        if item.awaitingApproval { return "Waiting for a parent's OK" }
        if item.isDone { return nil }
        guard let due = item.dueAt else { return item.kind == .homework ? "Homework" : nil }
        if due < now { return Calendar.current.isDate(due, inSameDayAs: now) ? "Was due \(due.formatted(date: .omitted, time: .shortened))" : "Overdue" }
        return "Due \(due.formatted(date: .omitted, time: .shortened))"
    }

    private func capsuleLabel(_ title: String, symbol: String, tint: Color) -> some View {
        Label(title, systemImage: symbol)
            .font(.system(.footnote, design: .rounded).weight(.bold))
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
            .padding(.horizontal, 10)
            .background(Capsule().fill(WatchMyListPalette.control))
    }

    private func complete(_ item: WatchMyListItem) {
        guard !item.isDone, working == nil else { return }
        working = item.id
        WKInterfaceDevice.current().play(.click)
        Task {
            let summary = await store.completeMyListItem(item)
            working = nil
            guard let summary else { return }
            WKInterfaceDevice.current().play(.success)
            done = summary
        }
    }
}
