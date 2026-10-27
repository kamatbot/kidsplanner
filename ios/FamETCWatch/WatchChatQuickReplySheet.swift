import SwiftUI
import WatchKit

/// BRIEF screen 2: one tap sends and dismisses. A 3 × 2 grid of big emoji,
/// two phrase capsules, then (below the fold) the system text field for
/// dictation/Scribble and the remaining phrases.
struct WatchChatQuickReplySheet: View {
    let onSend: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 3)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 6) {
                    LazyVGrid(columns: columns, spacing: 6) {
                        ForEach(WatchChatEmoji.grid, id: \.self) { emoji in
                            Button { send(emoji) } label: {
                                Text(emoji)
                                    .font(.system(size: 28))
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .background(WatchChatPalette.control, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Send \(emoji)")
                        }
                    }
                    ForEach(WatchChatEmoji.featuredPhrases, id: \.self) { phrase in
                        phraseButton(phrase)
                    }
                    TextField("Type or talk…", text: $draft)
                        .submitLabel(.send)
                        .onSubmit { send(draft) }
                        .accessibilityIdentifier("watch.chat.reply")
                        .padding(.top, 4)
                    ForEach(WatchChatEmoji.morePhrases, id: \.self) { phrase in
                        phraseButton(phrase)
                    }
                }
                .padding(.horizontal, 2)
            }
            .navigationTitle("Tap to send")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Image(systemName: "xmark") }
                        .accessibilityLabel("Close")
                }
            }
        }
        .fontDesign(.rounded)
        .tint(WatchChatPalette.violet)
    }

    private func phraseButton(_ phrase: String) -> some View {
        Button { send(phrase) } label: {
            Text(phrase)
                .font(.body.weight(.bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(WatchChatPalette.control, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = ""
        // The caller dismisses the sheet and plays the click haptic.
        onSend(trimmed)
    }
}
