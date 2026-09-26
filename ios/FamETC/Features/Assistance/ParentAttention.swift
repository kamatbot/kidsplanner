import Foundation
import SwiftUI

/// A factual briefing, not a model's interpretation of a child's performance.
/// Operate: a parent scans the next two days, then opens the original record.
/// Inherits Horizon and native sheets; never offers homework completion.
struct ParentAttentionItem: Identifiable {
    enum Destination {
        case homework(String)
        case event(String, String)
        case action(FamilyAction)
    }
    let id: String
    let title: String
    let detail: String
    let symbol: String
    let destination: Destination
}

enum ParentAttention {
    static func items(user: User?, family: Family?, homework: [HomeworkItem],
                      actions: [FamilyAction], events: [FamilyEvent], now: Date = Date()) -> [ParentAttentionItem] {
        guard let user, user.role != "kid", let family,
              family.parentIds.contains(user.id) else { return [] }
        let today = DateFmt.ymd.string(from: now)
        let tomorrow = DateFmt.ymd.string(from: Calendar.current.date(byAdding: .day, value: 1, to: now) ?? now)
        let kidIDs = Set(family.kids.map(\.id))
        func child(_ id: String?) -> String {
            family.kids.first(where: { $0.id == id })?.name ?? "your child"
        }
        func due(_ date: String) -> String {
            date < today ? "Overdue" : date == today ? "Due today" : "Due tomorrow"
        }
        let assignments = homework.filter {
            !$0.isDone && !$0.dueDate.isEmpty && $0.dueDate <= tomorrow &&
                ($0.kidId.map { kidIDs.contains($0) } ?? false)
        }.sorted { ($0.dueDate, $0.dueTime ?? "23:59", $0.id) < ($1.dueDate, $1.dueTime ?? "23:59", $1.id) }
        var result = assignments.map {
            ParentAttentionItem(id: "homework:\($0.id)", title: "Homework for \(child($0.kidId)): \($0.title)",
                                detail: "\(due($0.dueDate)) · Review or offer help", symbol: "book.closed",
                                destination: .homework($0.id))
        }
        let assignmentIDs = Set(assignments.map(\.id))
        let active = ActionQueue.sortActive(actions.filter {
            $0.familyId == family.id && ($0.kidId.map { kidIDs.contains($0) } ?? true)
        }, now: now).filter {
            if $0.sourceType == "homework", let source = $0.sourceId, assignmentIDs.contains(source) { return false }
            if let date = ActionQueue.effectiveDue($0, now: now)?.dateKey { return date <= tomorrow }
            return true
        }
        result += active.map {
            ParentAttentionItem(id: "action:\($0.id)", title: $0.title,
                                detail: ActionQueue.dueLabel(for: $0, now: now), symbol: "checklist",
                                destination: .action($0))
        }
        let clock = DateFormatter()
        clock.locale = Locale(identifier: "en_US_POSIX")
        clock.dateFormat = "HH:mm"
        let timeNow = clock.string(from: now)
        result += events.filter {
            !$0.isImportedTimetable && $0.date >= today && $0.date <= tomorrow &&
                ($0.kidId.map { kidIDs.contains($0) } ?? true) &&
                ($0.date != today || $0.time == nil || ($0.endTime ?? $0.time ?? "23:59") >= timeNow)
        }.sorted { ($0.date, $0.time ?? "00:00", $0.id) < ($1.date, $1.time ?? "00:00", $1.id) }.map {
            ParentAttentionItem(id: "event:\($0.id):\($0.date)", title: $0.title,
                                detail: "\($0.kidId == nil ? "Family" : child($0.kidId)) · \($0.date == today ? "Today" : "Tomorrow")\($0.time.map { " · \($0)" } ?? "")",
                                symbol: "calendar", destination: .event($0.id, $0.date))
        }
        return result
    }
}

struct ParentAttentionCard: View {
    @Environment(AppStore.self) private var store
    @State private var showBrief = false
    private var items: [ParentAttentionItem] {
        ParentAttention.items(user: store.me, family: store.family, homework: store.homework,
                              actions: store.actions, events: store.visibleFamilyEvents)
    }
    var body: some View {
        if let user = store.me, store.family?.parentIds.contains(user.id) == true, user.role != "kid" {
            Button { showBrief = true } label: {
                HStack(alignment: .top, spacing: Space.md) {
                    Image(systemName: "text.bubble").font(.title2).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text("What needs my attention?").font(Typography.cardTitle)
                        Text(store.attentionUpdatedAt == nil ? "Check your family’s next steps" :
                             items.first?.title ?? "No items in this brief for today or tomorrow")
                            .font(Typography.body).foregroundStyle(Palette.textSecond)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").accessibilityHidden(true)
                }
                .foregroundStyle(Palette.accent)
                .padding(Space.lg)
                .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
                .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card))
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $showBrief) { ParentAttentionSheet() }
        }
    }
}

struct ParentAttentionSheet: View {
    var childID: String? = nil
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var selected: ParentAttentionItem?
    private var items: [ParentAttentionItem] {
        guard !store.needsAuth, store.assistanceIdentityVerified else { return [] }
        return ParentAttention.items(user: store.me, family: store.family,
            homework: store.homework.filter { childID == nil || $0.kidId == childID },
            actions: store.actions.filter { childID == nil || $0.kidId == childID ||
                ($0.assigneeType == "kid" && $0.assigneeId == childID) || $0.assigneeType == "family" },
            events: store.visibleFamilyEvents.filter { childID == nil || $0.kidId == nil || $0.kidId == childID })
    }
    var body: some View {
        NavigationStack {
            List {
                if store.isParent, store.assistanceIdentityVerified, !store.needsAuth,
                   let childID, store.kids.contains(where: { $0.id == childID }) {
                    FamilyRingsKidCard(kidID: childID, onOpenHomework: {}, interactive: false)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                Section {
                    Text("A brief from your saved homework, family actions and calendar. Open an item to check the details.")
                        .font(Typography.body).foregroundStyle(Palette.textSecond)
                    if let date = store.attentionUpdatedAt {
                        Text("Updated \(date.formatted(date: .abbreviated, time: .shortened))")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                    } else {
                        Text("Some information hasn’t refreshed. This brief may be incomplete.")
                            .font(Typography.body).foregroundStyle(Palette.warn)
                    }
                    Button("Refresh brief") { Task { await store.refreshDashboard() } }
                        .disabled(store.isLoadingHomework || store.isLoadingActions)
                }
                Section("Today and tomorrow") {
                    if items.isEmpty {
                        Text(store.needsAuth ? "Sign in to see your family’s brief." : "No items to show in this brief.")
                            .foregroundStyle(Palette.textSecond)
                    }
                    ForEach(items) { item in
                        Button { selected = item } label: {
                            Label {
                                VStack(alignment: .leading, spacing: Space.xs) {
                                    Text(item.title).font(Typography.body).foregroundStyle(Palette.text)
                                    Text(item.detail).font(Typography.caption).foregroundStyle(Palette.textSecond)
                                }
                                .padding(.vertical, Space.xs)
                            } icon: { Image(systemName: item.symbol).foregroundStyle(Palette.accent) }
                        }
                    }
                }
            }
            .navigationTitle(childID.flatMap { id in store.kids.first { $0.id == id }?.name }.map { "\($0)’s next steps" } ?? "Your family brief")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $selected) { item in
                switch item.destination {
                case .homework(let id): HomeworkDetailSheet(homeworkId: id)
                case .event(let id, let date): EventDetailSheet(eventId: id, occurrenceDate: date)
                case .action(let action):
                    NavigationStack {
                        List {
                            Text(action.title).font(Typography.title)
                            Text(ActionQueue.dueLabel(for: action))
                            if let notes = action.notes, !notes.isEmpty { Text(notes) }
                            Text("Manage this item in Family actions on Today.").foregroundStyle(Palette.textSecond)
                        }
                        .navigationTitle("Family action")
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { selected = nil } } }
                    }
                }
            }
        }
        .tint(Palette.accent)
    }
}
