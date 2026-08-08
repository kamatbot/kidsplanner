import SwiftUI

/// The native phase-1 action surface. It is intentionally read-only apart from
/// completion: parents keep creation/edit/delete/snooze on the web, while kids
/// can complete only their own server-scoped actions.
struct ActionCard: View {
    @Environment(AppStore.self) private var store

    private var topActions: [FamilyAction] {
        ActionQueue.topActive(store.actions)
    }

    private var hasCompletedActions: Bool {
        store.actions.contains(where: \.isDone)
    }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        MicroLabel(text: store.isParent ? "Family actions" : "My next")
                        Text(store.isParent ? "What matters next" : "Your next steps")
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.text)
                    }
                    Spacer(minLength: Space.sm)
                    if store.isLoadingActions {
                        ProgressView()
                            .controlSize(.small)
                            .tint(Palette.accent)
                            .accessibilityLabel("Updating actions")
                    }
                }

                if store.isLoadingActions && store.actions.isEmpty {
                    HStack(spacing: Space.sm) {
                        ProgressView().tint(Palette.accent)
                        Text("Loading your next steps…")
                            .font(Typography.body)
                            .foregroundStyle(Palette.textSecond)
                    }
                    .padding(.vertical, Space.sm)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Loading your next steps")
                } else if let error = store.actionError, store.actions.isEmpty {
                    ActionCardMessage(
                        text: error.isEmpty ? "The action queue is unavailable right now." : error,
                        color: Palette.red,
                        buttonTitle: "Try again",
                        action: { Task { await store.loadFamilyActions() } }
                    )
                } else if topActions.isEmpty {
                    Text(hasCompletedActions ? "Everyone is caught up." : "Nothing waiting right now.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .padding(.vertical, Space.sm)
                } else {
                    VStack(spacing: 0) {
                        ForEach(topActions) { action in
                            ActionRow(action: action)
                            if action.id != topActions.last?.id {
                                Divider().overlay(Palette.border)
                            }
                        }
                    }

                    if let error = store.actionError, !error.isEmpty {
                        ActionCardMessage(
                            text: "Couldn't refresh actions.",
                            color: Palette.red,
                            buttonTitle: "Retry",
                            action: { Task { await store.loadFamilyActions() } }
                        )
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("today-action-card")
    }
}

private struct ActionCardMessage: View {
    let text: String
    let color: Color
    let buttonTitle: String
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Text(text)
                .font(Typography.body)
                .foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
            Button(buttonTitle, action: action)
                .font(Typography.caption.weight(.semibold))
                .foregroundStyle(Palette.accent)
                .buttonStyle(.plain)
        }
        .padding(.vertical, Space.sm)
        .accessibilityElement(children: .contain)
    }
}

private struct ActionRow: View {
    @Environment(AppStore.self) private var store
    let action: FamilyAction

    private var canComplete: Bool { store.canCompleteAction(action) }
    private var isCompleting: Bool { store.completingActionIDs.contains(action.id) }
    private var dueColor: Color {
        guard let due = ActionQueue.effectiveDue(action) else { return Palette.textSecond }
        let today = DateFmt.ymd.string(from: Date())
        if due.dateKey < today { return Palette.red }
        if due.dateKey == today { return Palette.warn }
        return Palette.textSecond
    }

    var body: some View {
        Group {
            if canComplete {
                Button {
                    Haptics.selection()
                    Task { await store.completeAction(action) }
                } label: {
                    rowContent
                }
                .buttonStyle(.plain)
                .disabled(isCompleting)
                .accessibilityLabel("Mark \(action.title) complete")
            } else {
                rowContent
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Shared action: \(action.title)")
            }
        }
        .padding(.vertical, Space.sm + 2)
        .contentShape(Rectangle())
    }

    @ViewBuilder private var rowContent: some View {
        HStack(alignment: .top, spacing: Space.md) {
            completionIndicator
                .frame(width: 24, height: 24)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 5) {
                Text(action.title)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                HStack(spacing: Space.sm) {
                    Text(ActionQueue.dueLabel(for: action))
                        .foregroundStyle(dueColor)
                    Text(sourceLabel)
                        .foregroundStyle(Palette.textSecond)
                    Text(assigneeLabel)
                        .foregroundStyle(Palette.textSecond)
                }
                .font(Typography.mono(10.5))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }

            Spacer(minLength: Space.xs)
        }
    }

    @ViewBuilder private var completionIndicator: some View {
        if canComplete {
            if isCompleting {
                ProgressView().tint(Palette.accent)
            } else {
                Image(systemName: "circle")
                    .font(.system(size: 21))
                    .foregroundStyle(Palette.border)
            }
        } else {
            Image(systemName: "circle.dotted")
                .font(.system(size: 19))
                .foregroundStyle(Palette.textSecond)
                .accessibilityHidden(true)
        }
    }

    private var sourceLabel: String {
        switch action.sourceType {
        case "manual": return "Manual"
        case "homework": return "Homework"
        case "calendar": return "Calendar"
        case "meal": return "Dinner"
        case "trip": return "Trip"
        case "chat": return "Chat"
        case "school": return "School"
        default: return action.sourceType.capitalized
        }
    }

    private var assigneeLabel: String {
        switch action.assigneeType {
        case "family":
            return "Family / shared"
        case "parent":
            if action.assigneeId == store.me?.id { return "You" }
            if let name = store.family?.parents?.first(where: { $0.id == action.assigneeId })?.name,
               !name.isEmpty { return name }
            return "Parent"
        case "kid":
            let kidId = action.assigneeId ?? action.kidId
            if kidId == store.me?.kidId { return "You" }
            return store.kids.first(where: { $0.id == kidId })?.name ?? "Kid"
        default:
            return "Family"
        }
    }
}
