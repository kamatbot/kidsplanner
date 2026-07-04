import SwiftUI

// MARK: - Chat (native)
//
// Family group chat, native on iOS but backed by the SAME server thread as the
// web. Playful, colorful bubbles (not a WhatsApp/Messenger clone): big rounded
// bubbles, per-sender colored avatars, a purple→pink gradient for your own
// messages, GIFs (Giphy), and distinct animated cards for homework/calendar
// system messages that deep-link to the item.
//
// Keyboard note: SwiftUI's automatic keyboard avoidance lifts the column so the
// composer rides flush on top of the keyboard; we only drop the tab-bar
// clearance to zero while the keyboard is up.
struct ChatScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var draft = ""
    @State private var keyboardVisible = false
    @State private var showGifPicker = false
    @State private var hwRef: HWRef?
    @FocusState private var composerFocused: Bool

    private let bottomAnchorID = "chat-bottom-anchor"
    private var baseInset: CGFloat { hSize == .compact ? Layout.tabBarClearance : Space.lg }
    private var bottomInset: CGFloat { keyboardVisible ? 0 : baseInset }

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 0) {
                header
                Divider().overlay(Palette.border)
                messages
                composer
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, bottomInset)
            .animation(.easeOut(duration: 0.25), value: keyboardVisible)
        }
        .onAppear { store.chatActive = true; Task { await store.refreshChatNow() } }
        .onDisappear { store.chatActive = false }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            Task { await store.refreshChatNow() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
        .sheet(isPresented: $showGifPicker) {
            GifPickerSheet { gif in Task { await store.sendGif(gif) } }
        }
        .sheet(item: $hwRef) { ref in HomeworkDetailSheet(homeworkId: ref.id) }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Chat").font(Typography.title).foregroundStyle(Palette.text)
                if let name = store.family?.name {
                    Text(name).font(Typography.caption).foregroundStyle(Palette.textSecond)
                }
            }
            Spacer()
            if composerFocused {
                Button("Done") { composerFocused = false }
                    .font(Typography.body.weight(.semibold)).foregroundStyle(Palette.accent)
            }
        }
        .padding(.horizontal, Space.lg).padding(.top, Space.md).padding(.bottom, Space.sm)
    }

    // MARK: Messages

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Space.md) {
                    ForEach(store.messages) { m in
                        ChatMessageRow(message: m,
                                       isMine: store.isMine(m),
                                       senderName: store.senderName(for: m),
                                       onTapCard: handleCardTap)
                            .id(m.id)
                    }
                    Color.clear.frame(height: 1).id(bottomAnchorID)
                }
                .padding(.horizontal, Space.md)
                .padding(.vertical, Space.md)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .overlay { emptyOrLoading }
            .onChange(of: store.messages.last?.id) { _, _ in scrollToBottom(proxy) }
            .onChange(of: keyboardVisible) { _, v in if v { scrollToBottom(proxy) } }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder private var emptyOrLoading: some View {
        if store.family == nil {
            emptyState(icon: "person.2.slash", title: "No family yet", detail: "Join or create a family to start chatting.")
        } else if store.messages.isEmpty {
            if store.isRefreshing { ProgressView().tint(Palette.accent) }
            else { emptyState(icon: "bubble.left.and.bubble.right", title: "No messages yet", detail: "Say hi to the family! 👋") }
        }
    }

    private func handleCardTap(_ card: ChatCard) {
        if card.type == "homework" { hwRef = HWRef(id: card.id) }
    }
    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        DispatchQueue.main.async {
            if animated { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(bottomAnchorID, anchor: .bottom) } }
            else { proxy.scrollTo(bottomAnchorID, anchor: .bottom) }
        }
    }

    // MARK: Composer (GIF + wide input + circular send)

    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: Space.sm) {
            Button { composerFocused = false; showGifPicker = true } label: {
                Text("GIF")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(Palette.accent)
                    .frame(width: 42, height: 42)
                    .background(Palette.accentSoft, in: Circle())
            }
            .accessibilityLabel("Add a GIF")

            TextField("Message the family…", text: $draft, axis: .vertical)
                .font(.system(size: 17))
                .foregroundStyle(Palette.text)
                .lineLimit(1...5)
                .focused($composerFocused)
                .padding(.horizontal, Space.md).padding(.vertical, Space.sm + 3)
                .background(Palette.bg, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))

            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(width: 42, height: 42)
                    .background(canSend ? AnyShapeStyle(Signal.gradient()) : AnyShapeStyle(Palette.textSecond.opacity(0.4)), in: Circle())
            }
            .disabled(!canSend)
            .accessibilityLabel("Send message")
        }
        .padding(.horizontal, Space.md).padding(.top, Space.sm).padding(.bottom, Space.sm)
        .background(Palette.panel)
        .overlay(Divider().overlay(Palette.border), alignment: .top)
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        Haptics.selection()
        Task { await store.send(text: text) }
    }

    private func emptyState(icon: String, title: String, detail: String) -> some View {
        VStack(spacing: Space.md) {
            Image(systemName: icon).font(.system(size: 34, weight: .semibold)).foregroundStyle(Palette.accent)
            Text(title).font(Typography.cardTitle).foregroundStyle(Palette.text)
            Text(detail).font(Typography.body).foregroundStyle(Palette.textSecond).multilineTextAlignment(.center)
        }
        .padding(Space.xl)
    }
}

/// Wrapper so a homework id can drive a `.sheet(item:)`.
struct HWRef: Identifiable { let id: String }

// MARK: - One message row (fun bubbles + avatar, or a system card)

struct ChatMessageRow: View {
    let message: ChatMessage
    let isMine: Bool
    let senderName: String
    var onTapCard: (ChatCard) -> Void

    private var senderColor: Color { isMine ? Palette.accent : famSenderColor(message.senderId) }

    var body: some View {
        if message.card != nil {
            SystemCardRow(message: message, onTapCard: onTapCard)
        } else {
            bubbleRow
        }
    }

    private var bubbleRow: some View {
        HStack(alignment: .bottom, spacing: Space.sm) {
            if isMine { Spacer(minLength: 52) }
            if !isMine { avatar }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 3) {
                if !isMine {
                    Text(senderName).font(Typography.caption.weight(.bold)).foregroundStyle(senderColor).padding(.horizontal, 6)
                }
                bubble
                Text(ChatTime.short(message.createdAt)).font(.system(size: 11)).foregroundStyle(Palette.textSecond).padding(.horizontal, 6)
            }
            if !isMine { Spacer(minLength: 52) }
        }
    }

    private var avatar: some View {
        Text(famInitials(senderName))
            .font(.system(size: 13, weight: .heavy))
            .foregroundStyle(.white)
            .frame(width: 36, height: 36)
            .background(senderColor, in: Circle())
    }

    private var bubbleShape: RoundedRectangle { RoundedRectangle(cornerRadius: 22, style: .continuous) }

    @ViewBuilder private var bubble: some View {
        if message.deleted {
            Text("Message deleted")
                .font(Typography.body.italic()).foregroundStyle(Palette.textSecond)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(bubbleShape.fill(AnyShapeStyle(Palette.panel)))
                .overlay(bubbleShape.strokeBorder(Palette.border, lineWidth: 1))
        } else if let media = message.media, media.type == "gif", let preview = media.previewUrl, let url = URL(string: preview) {
            AsyncImage(url: url) { phase in
                if let img = phase.image { img.resizable().scaledToFit() }
                else { RoundedRectangle(cornerRadius: 18).fill(Palette.panel).frame(width: 160, height: 120).overlay(ProgressView()) }
            }
            .frame(maxWidth: 240, maxHeight: 240)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        } else {
            Text(message.text)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(isMine ? Palette.onAccent : Palette.text)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(bubbleShape.fill(isMine ? AnyShapeStyle(Signal.gradient(.topLeading, .bottomTrailing)) : AnyShapeStyle(senderColor.opacity(0.16))))
                .overlay(isMine ? nil : bubbleShape.strokeBorder(senderColor.opacity(0.25), lineWidth: 1))
        }
    }
}

// MARK: - Time formatting

/// Parses the server's ISO-8601 `createdAt` and renders a short local time.
enum ChatTime {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoNoFrac = ISO8601DateFormatter()
    private static let time: DateFormatter = { let f = DateFormatter(); f.dateFormat = "h:mm a"; return f }()

    static func short(_ createdAt: String) -> String {
        guard let date = iso.date(from: createdAt) ?? isoNoFrac.date(from: createdAt) else { return "" }
        return time.string(from: date)
    }
}
