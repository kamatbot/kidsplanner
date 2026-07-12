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
    @State private var eventRef: EVRef?
    @State private var newEventReq: NewEventReq?
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
        // chatActive's didSet restarts the chat loop with an immediate plain
        // fetch as its first iteration — see AppStore.restartChatLoop — so
        // messages render right away with no tap needed, whether this is a
        // native tab page, the iPad docked column, or the slide-over sheet.
        .onAppear { store.chatActive = true }
        .onDisappear { store.chatActive = false }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
            store.chatDidEnterBackground()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            store.chatWillEnterForeground()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
        .sheet(isPresented: $showGifPicker) {
            GifPickerSheet { gif in Task { await store.sendGif(gif) } }
        }
        .sheet(item: $hwRef) { ref in HomeworkDetailSheet(homeworkId: ref.id) }
        .sheet(item: $eventRef) { ref in EventDetailSheet(eventId: ref.id) }
        .sheet(item: $newEventReq) { req in AddEventSheet(initialTitle: req.title, initialTime: req.time) }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                MicroLabel(text: "Family chat")
                Text(store.family?.name ?? "Chat").font(Typography.cardTitle).foregroundStyle(Palette.text)
            }
            Spacer()
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
                                       onTapCard: handleCardTap,
                                       onAddToCalendar: handleAddToCalendar,
                                       onPinToNotes: handlePinToNotes)
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
            // Tapping the chat body dismisses the keyboard (fires alongside any
            // card/button tap without blocking it).
            .simultaneousGesture(TapGesture().onEnded { composerFocused = false })
            .overlay { emptyOrLoading }
            // defaultScrollAnchor(.bottom) alone mispositions with LazyVStack
            // when messages land after layout (lazy rows have no measured
            // height yet, so the viewport parks in blank space until the user
            // scrolls — seen on device in build 21). Scroll explicitly on
            // appear AND on any count change; count (not last?.id) also fires
            // when the initial fetch replaces the cached array with an
            // identical trailing message.
            .onAppear { scrollToBottom(proxy, animated: false) }
            .onChange(of: store.messages.count) { _, _ in scrollToBottom(proxy) }
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
        else if card.type == "event" { eventRef = EVRef(id: card.id) }
    }
    private func handleAddToCalendar(_ text: String) {
        newEventReq = NewEventReq(title: text, time: parseTime(from: text))
    }
    private func handlePinToNotes(_ message: ChatMessage) {
        Haptics.selection()
        Task {
            await store.addNote(body: message.text,
                                 source: "chat",
                                 ref: ["kind": "chat", "id": message.id, "context": message.text])
        }
    }
    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        DispatchQueue.main.async {
            if animated { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(bottomAnchorID, anchor: .bottom) } }
            else { proxy.scrollTo(bottomAnchorID, anchor: .bottom) }
            // Second pass one tick later: lazy rows measured by the first
            // scroll can grow the content height, leaving the first target
            // short of the true bottom.
            DispatchQueue.main.async { proxy.scrollTo(bottomAnchorID, anchor: .bottom) }
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
                .background(Palette.panel2, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))

            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(width: 42, height: 42)
                    .background(canSend ? Palette.accent : Palette.textSecond.opacity(0.4), in: Circle())
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

/// Wrappers so an id can drive a `.sheet(item:)`.
struct HWRef: Identifiable { let id: String }
struct EVRef: Identifiable { let id: String }
struct NewEventReq: Identifiable { let id = UUID(); let title: String; let time: String? }

/// Best-effort time-of-day parser for message text, e.g. "pick up kids at 5pm"
/// → "17:00". Returns nil when no recognizable time is found.
func parseTime(from text: String) -> String? {
    let pattern = #"(?i)\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s*(am|pm)?\b"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let ns = text as NSString
    let matches = regex.matches(in: text, range: NSRange(location: 0, length: ns.length))
    for match in matches {
        // Require either an explicit am/pm or a "HH:mm"-style hour:minute to
        // avoid matching stray numbers with no time context.
        let hasMinute = match.range(at: 2).location != NSNotFound
        let hasMeridiem = match.range(at: 3).location != NSNotFound
        guard hasMinute || hasMeridiem else { continue }

        var hour = Int(ns.substring(with: match.range(at: 1))) ?? 0
        let minute = hasMinute ? (Int(ns.substring(with: match.range(at: 2))) ?? 0) : 0
        if hasMeridiem {
            let meridiem = ns.substring(with: match.range(at: 3)).lowercased()
            if meridiem == "am" {
                if hour == 12 { hour = 0 }
            } else {
                if hour != 12 { hour += 12 }
            }
        }
        guard hour >= 0, hour <= 23, minute >= 0, minute <= 59 else { continue }
        return String(format: "%02d:%02d", hour, minute)
    }
    // Fall back to a strict 24h "HH:mm" match, e.g. "17:00".
    let hm = #"\b([01][0-9]|2[0-3]):([0-5][0-9])\b"#
    if let regex24 = try? NSRegularExpression(pattern: hm),
       let match = regex24.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) {
        let hour = Int(ns.substring(with: match.range(at: 1))) ?? 0
        let minute = Int(ns.substring(with: match.range(at: 2))) ?? 0
        return String(format: "%02d:%02d", hour, minute)
    }
    return nil
}

// MARK: - One message row (fun bubbles + avatar, or a system card)

struct ChatMessageRow: View {
    let message: ChatMessage
    let isMine: Bool
    let senderName: String
    var onTapCard: (ChatCard) -> Void
    var onAddToCalendar: (String) -> Void = { _ in }
    var onPinToNotes: (ChatMessage) -> Void = { _ in }

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
                Text(ChatTime.short(message.createdAt)).font(Typography.mono(10.5)).foregroundStyle(Palette.textSecond).padding(.horizontal, 6)
            }
            if !isMine { Spacer(minLength: 52) }
        }
    }

    private var avatar: some View {
        Text(famAvatar(senderType: message.senderType, id: message.senderId))
            .font(.system(size: 22))
            .frame(width: 38, height: 38)
            .background(senderColor.opacity(0.22), in: Circle())
            .overlay(Circle().strokeBorder(senderColor.opacity(0.4), lineWidth: 1))
    }

    private var bubbleShape: RoundedRectangle { RoundedRectangle(cornerRadius: 22, style: .continuous) }

    @ViewBuilder private var bubble: some View {
        if message.deleted {
            Text("Message deleted")
                .font(Typography.body.italic()).foregroundStyle(Palette.textSecond)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(bubbleShape.fill(AnyShapeStyle(Palette.panel)))
                .overlay(bubbleShape.strokeBorder(Palette.border, lineWidth: 1))
        } else if let media = message.media, media.type == "gif",
                  let url = URL(string: media.url ?? media.previewUrl ?? "") {
            AnimatedGIFView(url: url)
                .frame(maxWidth: 240, maxHeight: 240)
                .background(Palette.panel)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        } else {
            // Own messages: flat violet fill (Horizon --accent), white/onAccent
            // text. Others: neutral panel bg + border — the sender name above
            // (not the bubble) carries their kid/parent color.
            Text(message.text)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(isMine ? Palette.onAccent : Palette.text)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(bubbleShape.fill(isMine ? AnyShapeStyle(Palette.accent) : AnyShapeStyle(Palette.panel2)))
                .overlay(isMine ? nil : bubbleShape.strokeBorder(Palette.border, lineWidth: 1))
                .contextMenu {
                    Button {
                        onAddToCalendar(message.text)
                    } label: {
                        Label("Add to Calendar", systemImage: "calendar.badge.plus")
                    }
                    Button {
                        onPinToNotes(message)
                    } label: {
                        Label("Pin to Notes", systemImage: "pin")
                    }
                }
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
