import SwiftUI

// MARK: - Chat (native)
//
// The family group chat, native on iOS but backed by the SAME server thread as
// the web (`/api/chat/messages`). Because APIClient shares HTTPCookieStorage
// with the WebView + AuthService, a passkey sign-in gives these calls the same
// `fam_sess` cookie — so a message typed on the web appears here and vice versa,
// with no separate account or sync layer. State + polling live in AppStore; this
// screen is the presentation.
//
// Keyboard note: RootView's iPhone TabView sets `.ignoresSafeArea(.keyboard)` to
// keep the floating tab bar still, which also stops SwiftUI from lifting the
// composer. We therefore track the keyboard height ourselves and pad the column
// up by it (falling back to the tab-bar clearance when the keyboard is closed).
struct ChatScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var draft = ""
    @State private var keyboardHeight: CGFloat = 0
    @FocusState private var composerFocused: Bool

    private var baseInset: CGFloat {
        hSize == .compact ? Layout.tabBarClearance : Space.lg
    }
    private var bottomInset: CGFloat { keyboardHeight > 0 ? keyboardHeight : baseInset }

    var body: some View {
        ZStack {
            ScreenBackground()
            VStack(spacing: 0) {
                header
                Divider().overlay(Palette.border)
                messageList
                composer
            }
            .padding(.bottom, bottomInset)
            .animation(.easeOut(duration: 0.25), value: bottomInset)
        }
        .onAppear {
            store.chatActive = true
            Task { await store.refreshChatNow() }
        }
        .onDisappear { store.chatActive = false }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            Task { await store.refreshChatNow() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { note in
            if let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                keyboardHeight = frame.height
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardHeight = 0
        }
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
        }
        .padding(.horizontal, Space.lg)
        .padding(.top, Space.md)
        .padding(.bottom, Space.sm)
    }

    // MARK: Messages

    @ViewBuilder
    private var messageList: some View {
        if store.family == nil {
            emptyState(icon: "person.2.slash", title: "No family yet",
                       detail: "Join or create a family to start chatting.")
        } else if store.messages.isEmpty {
            if store.isRefreshing {
                Spacer(); ProgressView().tint(Palette.accent); Spacer()
            } else {
                emptyState(icon: "bubble.left.and.bubble.right",
                           title: "No messages yet", detail: "Say hi to the family! 👋")
            }
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: Space.sm) {
                        ForEach(store.messages) { m in
                            ChatMessageRow(message: m,
                                           isMine: store.isMine(m),
                                           senderName: store.senderName(for: m))
                                .id(m.id)
                        }
                        Color.clear.frame(height: 1).id(bottomAnchorID)
                    }
                    .padding(.horizontal, Space.lg)
                    .padding(.vertical, Space.md)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: store.messages.last?.id) { _, _ in scrollToBottom(proxy) }
                .onChange(of: keyboardHeight) { _, h in if h > 0 { scrollToBottom(proxy) } }
                .onAppear { scrollToBottom(proxy, animated: false) }
            }
        }
    }

    private let bottomAnchorID = "chat-bottom-anchor"

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        // Deferred a tick so a just-inserted row / image is laid out first.
        DispatchQueue.main.async {
            if animated {
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(bottomAnchorID, anchor: .bottom) }
            } else {
                proxy.scrollTo(bottomAnchorID, anchor: .bottom)
            }
        }
    }

    // MARK: Composer (Facebook-style: wide input + circular send)

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: Space.sm) {
            TextField("Message the family…", text: $draft, axis: .vertical)
                .font(Typography.body)
                .foregroundStyle(Palette.text)
                .lineLimit(1...5)
                .focused($composerFocused)
                .padding(.horizontal, Space.md)
                .padding(.vertical, Space.sm + 2)
                .background(Palette.bg, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(Palette.border, lineWidth: 1)
                )

            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(width: 40, height: 40)
                    .background(canSend ? Palette.accent : Palette.textSecond.opacity(0.4), in: Circle())
            }
            .disabled(!canSend)
            .accessibilityLabel("Send message")
        }
        .padding(.horizontal, Space.md)
        .padding(.top, Space.sm)
        .padding(.bottom, Space.sm)
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

    // MARK: Empty state

    private func emptyState(icon: String, title: String, detail: String) -> some View {
        VStack(spacing: Space.md) {
            Spacer()
            Image(systemName: icon)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Palette.accent)
            Text(title).font(Typography.cardTitle).foregroundStyle(Palette.text)
            Text(detail).font(Typography.body).foregroundStyle(Palette.textSecond)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(Space.xl)
    }
}

// MARK: - One message bubble

struct ChatMessageRow: View {
    let message: ChatMessage
    let isMine: Bool
    let senderName: String

    var body: some View {
        HStack(alignment: .bottom, spacing: Space.sm) {
            if isMine { Spacer(minLength: 44) }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 3) {
                if !isMine {
                    Text(senderName)
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.textSecond)
                        .padding(.horizontal, Space.xs)
                }
                bubble
                Text(ChatTime.short(message.createdAt))
                    .font(.system(size: 10))
                    .foregroundStyle(Palette.textSecond)
                    .padding(.horizontal, Space.xs)
            }
            if !isMine { Spacer(minLength: 44) }
        }
    }

    @ViewBuilder
    private var bubble: some View {
        if message.deleted {
            Text("Message deleted")
                .font(Typography.body.italic())
                .foregroundStyle(Palette.textSecond)
                .padding(.horizontal, Space.md)
                .padding(.vertical, Space.sm)
                .background(Palette.panel, in: bubbleShape)
                .overlay(bubbleShape.strokeBorder(Palette.border, lineWidth: 1))
        } else {
            VStack(alignment: isMine ? .trailing : .leading, spacing: Space.sm) {
                if let media = message.media, media.type == "gif",
                   let preview = media.previewUrl, let url = URL(string: preview) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFit()
                        case .failure:
                            Color.clear.frame(height: 0)
                        default:
                            ProgressView().frame(width: 120, height: 90)
                        }
                    }
                    .frame(maxWidth: 220, maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                if !message.text.isEmpty {
                    Text(message.text)
                        .font(Typography.body)
                        .foregroundStyle(isMine ? Palette.onAccent : Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, Space.md)
            .padding(.vertical, Space.sm + 1)
            .background(isMine ? Palette.accent : Palette.panel, in: bubbleShape)
            .overlay(isMine ? nil : bubbleShape.strokeBorder(Palette.border, lineWidth: 1))
        }
    }

    private var bubbleShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
    }
}

// MARK: - Time formatting

/// Parses the server's ISO-8601 `createdAt` and renders a short local time.
/// Formatters are static (creating them is expensive) and thread-safe here.
enum ChatTime {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoNoFrac = ISO8601DateFormatter()
    private static let time: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f
    }()

    static func short(_ createdAt: String) -> String {
        let date = iso.date(from: createdAt) ?? isoNoFrac.date(from: createdAt)
        guard let date else { return "" }
        return time.string(from: date)
    }
}
