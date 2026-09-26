import SwiftUI

/// Slim "Hermes" strip at the top of Today, above the Needs-you hero
/// (docs/HERMES-THREADS-CONTRACT.md §8): up to 2 still-relevant open
/// hermes-nudge cards from the signed-in person's private Hermes thread.
/// Hidden entirely when there are none — no empty state, no placeholder.
struct TodayHermesStrip: View {
    @Environment(AppStore.self) private var store

    private var messages: [ChatMessage] { store.messagesByRoom["hermes"] ?? [] }

    var body: some View {
        // A card can age out of the window with no new data arriving — a
        // periodic re-evaluation is the only way that fade happens on its own.
        TimelineView(.periodic(from: .now, by: 300)) { context in
            let rows = Self.items(from: messages, now: context.date)
            if !rows.isEmpty {
                Card(padding: Space.lg) {
                    VStack(alignment: .leading, spacing: Space.lg) {
                        ForEach(rows) { row($0) }
                    }
                }
            }
        }
    }

    private func row(_ message: ChatMessage) -> some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Button {
                Haptics.selection()
                store.pendingChatRoomId = "hermes"
            } label: {
                HStack(alignment: .top, spacing: Space.sm) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.frYou)
                        .padding(.top, 2)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Hermes")
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(Palette.frYou)
                        Text(message.text)
                            .font(Typography.body)
                            .foregroundStyle(Palette.text)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Hermes: \(message.text)")
            .accessibilityHint("Opens the Hermes chat")

            if let actions = message.card?.actions, !actions.isEmpty {
                HermesNudgeActionsRow(actions: actions, messageId: message.id, roomId: "hermes")
            }
        }
    }

    /// Contract §8 selector: candidates are open `hermes-nudge` cards with
    /// `senderType: "agent"`, not deleted. An **actionable** one (at least one
    /// action with no `open` that isn't `done`) shows for 18h; a status-only
    /// one (e.g. "school ended now") shows for 2h. Pure and `now`-parameterized
    /// so the age-based fade is testable without waiting on the clock.
    static func items(from messages: [ChatMessage], now: Date = Date()) -> [ChatMessage] {
        let eligible: [(message: ChatMessage, createdAt: Date)] = messages.compactMap { message in
            guard message.senderType == "agent",
                  message.card?.type == "hermes-nudge",
                  message.card?.state?.status == "open",
                  !message.deleted,
                  let createdAt = ChatTime.date(message.createdAt) else { return nil }
            return (message, createdAt)
        }
        let shown = eligible.filter { entry in
            let actionable = (entry.message.card?.actions ?? []).contains { $0.open == nil && $0.done != true }
            let ageLimit: TimeInterval = (actionable ? 18 : 2) * 3600
            return now.timeIntervalSince(entry.createdAt) <= ageLimit
        }
        return shown
            .sorted { $0.createdAt > $1.createdAt }
            .prefix(2)
            .map(\.message)
    }
}
