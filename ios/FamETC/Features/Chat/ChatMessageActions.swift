import SwiftUI
import UIKit

// WhatsApp-style long-press menu for a chat message: a full-width bar of big
// reaction emoji above the message, the message itself, and the actions list
// below, over a blurred chat. Replaces the system context menu, whose palette
// row can only show small emoji.

/// One row in the long-press message menu.
struct ChatMessageMenuAction: Identifiable {
    let id: String
    let title: String
    let systemImage: String
    var isDestructive = false
    var isDisabled = false
    let perform: () -> Void
}

/// The full-width bar of big reaction emoji. Reactions I already gave are
/// highlighted; tapping one again removes it (the server toggles).
struct ChatReactionBar: View {
    let selected: Set<String>
    let onReact: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(ChatReaction.all, id: \.key) { option in
                let mine = selected.contains(option.key)
                Button { onReact(option.key) } label: {
                    Text(option.emoji)
                        .font(.system(size: 34))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(mine ? Palette.accentSoft : Color.clear, in: Circle())
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(mine ? "Remove \(option.emoji) reaction" : "React \(option.emoji)")
                .accessibilityAddTraits(mine ? .isSelected : [])
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
    }
}

/// Full-screen overlay presented on long press (see `ChatMessageRow`).
struct ChatMessageActionsOverlay<Preview: View>: View {
    let canReact: Bool
    let selectedReactions: Set<String>
    let alignTrailing: Bool
    let actions: [ChatMessageMenuAction]
    let onReact: (String) -> Void
    let onSelect: (ChatMessageMenuAction) -> Void
    let onDismiss: () -> Void
    let preview: Preview

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Color.black.opacity(0.12))
                .ignoresSafeArea()
                .onTapGesture { onDismiss() }
                .accessibilityLabel("Close message options")
                .accessibilityAddTraits(.isButton)

            VStack(spacing: 12) {
                Spacer(minLength: 0)
                if canReact {
                    ChatReactionBar(selected: selectedReactions, onReact: onReact)
                }
                preview
                    .frame(maxHeight: 320, alignment: .top)
                    .clipped()
                    .frame(maxWidth: .infinity, alignment: alignTrailing ? .trailing : .leading)
                    .allowsHitTesting(false)
                if !actions.isEmpty {
                    actionList
                        .frame(maxWidth: 290)
                        .frame(maxWidth: .infinity, alignment: alignTrailing ? .trailing : .leading)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 16)
            .scaleEffect(appeared || reduceMotion ? 1 : 0.94)
            .opacity(appeared ? 1 : 0)
        }
        .onAppear {
            withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.28, dampingFraction: 0.82)) {
                appeared = true
            }
        }
        .accessibilityAction(.escape) { onDismiss() }
    }

    private var actionList: some View {
        VStack(spacing: 0) {
            ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                if index > 0 { Divider().padding(.leading, 56) }
                Button { onSelect(action) } label: {
                    HStack(spacing: 14) {
                        Image(systemName: action.systemImage)
                            .font(.system(size: 19, weight: .regular))
                            .frame(width: 24)
                        Text(action.title)
                            .font(.body)
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(action.isDestructive ? Color.red : Palette.text)
                    .padding(.horizontal, 18)
                    .frame(minHeight: 50)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(action.isDisabled)
                .opacity(action.isDisabled ? 0.5 : 1)
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
    }
}

/// Text handed to the system share sheet from the message menu.
struct ChatShareText: Identifiable {
    let id = UUID()
    let text: String
}

/// UIKit share sheet; SwiftUI's ShareLink can't be triggered from a closure.
struct ChatShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
