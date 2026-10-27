import SwiftUI
import WatchKit

/// Kids' watch palette (docs/design/kids-watch/BRIEF.md).
enum WatchChatPalette {
    static let violet = Color(red: 185 / 255, green: 140 / 255, blue: 1)
    static let coral = Color(red: 240 / 255, green: 112 / 255, blue: 79 / 255)
    static let homework = Color(red: 1, green: 159 / 255, blue: 69 / 255)
    static let control = Color(red: 44 / 255, green: 44 / 255, blue: 49 / 255)
    static let incoming = Color(red: 38 / 255, green: 38 / 255, blue: 43 / 255)
    static let secondary = Color(red: 142 / 255, green: 142 / 255, blue: 150 / 255)
    static let parentPink = Color(red: 1, green: 122 / 255, blue: 182 / 255)
    static let parentBlue = Color(red: 90 / 255, green: 169 / 255, blue: 1)
    static let emojiYellow = Color(red: 1, green: 214 / 255, blue: 10 / 255)
    private static let kidColors = [Color(red: 47 / 255, green: 211 / 255, blue: 181 / 255),
                                    Color(red: 245 / 255, green: 197 / 255, blue: 66 / 255),
                                    Color(red: 1, green: 159 / 255, blue: 69 / 255)]

    /// Person colour for someone else's avatar/play button. The watch only
    /// knows its own profile colour, so others get a stable fallback.
    static func color(for message: WatchChatMessage) -> Color {
        let hash = message.senderId.utf8.reduce(0) { ($0 &* 31 &+ Int($1)) & 0xFFFF }
        switch message.senderType {
        case "parent": return hash % 2 == 0 ? parentPink : parentBlue
        case "agent": return violet
        default: return kidColors[hash % kidColors.count]
        }
    }
}

/// Requests from notifications and complications: open straight into
/// recording (Talk) or just to the chat.
@MainActor
final class WatchChatRoute: ObservableObject {
    static let shared = WatchChatRoute()
    @Published var talkRequested = false

    /// Complication deep links. `fametc-watch://talk` starts a recording.
    static let chatURL = URL(string: "fametc-watch://chat")!
    static let talkURL = URL(string: "fametc-watch://talk")!

    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard url.scheme == "fametc-watch" else { return false }
        if url.host == "talk" { talkRequested = true }
        return url.host == "talk" || url.host == "chat"
    }
}

/// Root screen (BRIEF screen 1): family chat with the newest message at the
/// bottom, a to-do capsule that opens My list, and two always-visible 44 pt
/// capsules, Emoji and Talk.
struct WatchChatView: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var companionRoute = WatchCompanionRoute.shared
    @ObservedObject private var chatRoute = WatchChatRoute.shared
    @ObservedObject private var voiceOutbox = WatchVoiceOutbox.shared
    @ObservedObject private var played = WatchVoicePlayedStore.shared
    @State private var showHub = false
    @State private var showMyList = false
    @State private var showQuickReplies = false
    @State private var showCompanion = false
    @State private var showRecorder = false
    @State private var playing: WatchChatMessage?
    var onDisconnect: () -> Void = {}

    private var messages: [WatchChatMessage] { store.chatMessagesForDisplay }
    private var profile: WatchProfile? { store.snapshot.context?.profile }
    private var companionIdentity: WatchCompanionIdentity? { WatchCompanionIdentity(profile) }
    private var canSend: Bool { !store.chatUnavailable && store.snapshot.context != nil }
    private var isLive: Bool {
        scenePhase == .active && !showHub && !showMyList && !showCompanion && playing == nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    shortcutsRow
                    if store.chatUnavailable {
                        Text("Chat isn't available on this watch yet.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else if messages.isEmpty {
                        Text(store.snapshot.chat == nil ? "Loading chat…" : "No messages yet. Say hi 👋")
                            .font(.footnote).foregroundStyle(.secondary)
                            .padding(.vertical, 8)
                    }
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        let previous = index > 0 ? messages[index - 1] : nil
                        WatchChatRow(message: message,
                                     mine: message.isMine(profile),
                                     showSender: previous?.senderId != message.senderId || previous?.senderType != message.senderType,
                                     unplayed: message.isVoice && !message.isMine(profile) && !played.isPlayed(message.id),
                                     reactedEmoji: reactedEmoji(message)) {
                            if message.isVoice && message.pending != true { playing = message }
                        }
                    }
                    statusLine
                }
                .padding(.horizontal, 2)
            }
            .defaultScrollAnchor(.bottom)
            .safeAreaInset(edge: .bottom, spacing: 4) {
                if canSend { replyBar }
            }
            .navigationTitle("Family")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { todoCapsule }
            }
            .navigationDestination(isPresented: $showHub) { MyNextView(onDisconnect: onDisconnect) }
            .navigationDestination(isPresented: $showMyList) { MyListView(onDisconnect: onDisconnect) }
            .navigationDestination(isPresented: $showCompanion) {
                if let identity = companionIdentity { WatchCompanionChatView(identity: identity).id(identity) }
            }
            .navigationDestination(isPresented: Binding(get: { playing != nil }, set: { if !$0 { playing = nil } })) {
                if let message = playing {
                    WatchVoicePlaybackView(message: message) {
                        playing = nil
                        // Let the pop finish before presenting the recorder.
                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(350))
                            showRecorder = true
                        }
                    }
                }
            }
            .sheet(isPresented: $showQuickReplies) {
                WatchChatQuickReplySheet { text in
                    showQuickReplies = false
                    send(text)
                }
            }
            .fullScreenCover(isPresented: $showRecorder) {
                WatchVoiceRecordingView { recording in
                    showRecorder = false
                    guard let recording else { return }
                    Task { await store.sendVoice(recordingAt: recording.url, durationMs: recording.durationMs) }
                }
            }
            .onChange(of: companionIdentity) { _, _ in showCompanion = false; consumeCompanionRoute() }
            .onChange(of: companionRoute.requested) { _, _ in consumeCompanionRoute() }
            .onChange(of: chatRoute.talkRequested) { _, _ in consumeTalkRoute() }
            .onChange(of: store.connection) { _, state in
                if state == .connected { Task { await store.drainVoice() } }
            }
            .onOpenURL { url in
                if chatRoute.handle(url) { showHub = false; showMyList = false; showCompanion = false; playing = nil }
            }
            .onAppear { consumeCompanionRoute(); consumeTalkRoute() }
            // Live only while this screen is on a raised wrist; dropping the
            // wrist or opening another screen cancels the parked request.
            .task(id: isLive) {
                guard isLive else { return }
                Task { await store.drainVoice() }
                await store.listenForChat()
            }
        }
        .fontDesign(.rounded)
        .tint(WatchChatPalette.violet)
    }

    // MARK: Header and shortcuts

    /// Orange to-do capsule: homework + chores due today; opens My list.
    private var todoCapsule: some View {
        Button { showMyList = true } label: {
            HStack(spacing: 2) {
                Image(systemName: "checkmark").font(.caption2.weight(.black))
                Text("\(store.openTodoCount)").font(.caption.weight(.heavy)).monospacedDigit()
            }
            .foregroundStyle(.black)
            .padding(.horizontal, 7)
            .frame(minHeight: 24)
            .background(WatchChatPalette.homework, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("My list, \(store.openTodoCount) to do")
        .accessibilityIdentifier("watch.chat.todo")
    }

    /// Top of the history: the kid's companion and the calendar/settings hub.
    private var shortcutsRow: some View {
        HStack(spacing: 6) {
            if companionIdentity != nil {
                Button { showCompanion = true } label: {
                    Label("Helper", systemImage: "sparkles").font(.caption.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 38)
                }
                .tint(WatchChatPalette.violet)
                .accessibilityLabel("Your AI companion")
                .accessibilityIdentifier("watch.companion.open")
            }
            Button { showHub = true } label: {
                Label("More", systemImage: store.focusSession == nil ? "ellipsis" : "timer").font(.caption.weight(.bold))
                    .foregroundStyle(store.focusSession == nil ? Color.primary : WatchChatPalette.coral)
                    .frame(maxWidth: .infinity, minHeight: 38)
            }
            .accessibilityLabel("Day, lists and settings")
            .accessibilityIdentifier("watch.chat.hub")
        }
        .buttonStyle(.bordered)
        .padding(.bottom, 4)
    }

    @ViewBuilder private var statusLine: some View {
        if let error = voiceOutbox.lastError ?? store.chatSendError {
            Text(error).font(.caption2).foregroundStyle(.orange)
        } else if messages.contains(where: { $0.pending == true }) && store.connection == .offline {
            Text("Offline — will send when connected").font(.caption2).foregroundStyle(.secondary)
        }
    }

    // MARK: Emoji + Talk

    private var replyBar: some View {
        HStack(spacing: 6) {
            Button { showQuickReplies = true } label: {
                Image(systemName: "face.smiling.inverse")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(WatchChatPalette.emojiYellow)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(WatchChatPalette.control, in: Capsule())
            }
            .accessibilityLabel("Emoji and quick replies")
            .accessibilityIdentifier("watch.chat.emoji")
            Button { WKInterfaceDevice.current().play(.start); showRecorder = true } label: {
                HStack(spacing: 3) {
                    Image(systemName: "mic.fill")
                    Text("Talk")
                }
                .font(.body.weight(.heavy))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(WatchChatPalette.violet, in: Capsule())
            }
            .accessibilityLabel("Talk: record a voice message")
            .accessibilityIdentifier("watch.chat.talk")
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 4)
        .padding(.top, 2)
        .background(.black)
    }

    private func reactedEmoji(_ message: WatchChatMessage) -> Set<String> {
        Set(WatchChatEmoji.reactions.filter { store.hasReacted(message, emoji: $0) })
    }

    private func consumeCompanionRoute() {
        guard companionRoute.requested, companionIdentity != nil else { return }
        companionRoute.requested = false; showHub = false; showMyList = false; playing = nil; showCompanion = true
    }

    private func consumeTalkRoute() {
        guard chatRoute.talkRequested, canSend else { return }
        chatRoute.talkRequested = false
        showHub = false; showMyList = false; showCompanion = false; playing = nil; showQuickReplies = false
        showRecorder = true
    }

    private func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        WKInterfaceDevice.current().play(.click)
        Task { await store.sendChat(trimmed) }
    }
}

/// One message: avatar + bubble for others, violet bubble for mine, large
/// emoji without a bubble, or a voice bubble.
private struct WatchChatRow: View {
    let message: WatchChatMessage
    let mine: Bool
    let showSender: Bool
    let unplayed: Bool
    /// Reactions (as emoji) the wearer already chose.
    let reactedEmoji: Set<String>
    let onTap: () -> Void

    private var personColor: Color { WatchChatPalette.color(for: message) }
    private var bigEmoji: Bool {
        message.deleted != true && message.media == nil && message.card == nil && message.buzz != true
            && WatchChatEmoji.emojiOnlyCount(message.text) != nil
    }

    var body: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
            if showSender && !mine {
                Text(header)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(WatchChatPalette.secondary)
                    .padding(.leading, 20)
                    .padding(.top, 2)
            }
            HStack(alignment: .bottom, spacing: 4) {
                if !mine {
                    avatar.opacity(showSender ? 1 : 0)
                }
                content
                    .opacity(message.pending == true ? 0.6 : 1)
            }
            if let reactions = message.reactions, !reactions.isEmpty {
                HStack(spacing: 3) {
                    ForEach(reactions, id: \.key) { reaction in
                        if let emoji = WatchChatEmoji.emoji(forReactionKey: reaction.key) {
                            let count = reaction.userIds?.count ?? 1
                            Text(count > 1 ? "\(emoji)\(count)" : emoji)
                                .font(.caption2)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(reactedEmoji.contains(emoji) ? WatchChatPalette.violet.opacity(0.4) : WatchChatPalette.control,
                                            in: Capsule())
                        }
                    }
                }
                .padding(.leading, mine ? 0 : 20)
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(message.pending == true ? "Sending" : (message.isVoice ? "Plays the voice message" : ""))
        .accessibilityAddTraits(message.isVoice && message.pending != true ? .isButton : [])
    }

    @ViewBuilder private var content: some View {
        if message.isVoice {
            Button(action: onTap) { voiceBubble }
                .buttonStyle(.plain)
                .disabled(message.pending == true)
        } else if bigEmoji {
            Text(message.text.trimmingCharacters(in: .whitespacesAndNewlines))
                .font(.system(size: 34))
        } else {
            Text(message.displayText)
                .font(.body.weight(.medium))
                .italic(message.deleted == true)
                .foregroundStyle(mine ? Color.black : Color.white)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(bubbleColor, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private var bubbleColor: Color {
        if mine { return WatchChatPalette.violet }
        return message.buzz == true ? WatchChatPalette.coral.opacity(0.45) : WatchChatPalette.incoming
    }

    private var voiceBubble: some View {
        HStack(spacing: 5) {
            ZStack {
                Circle().fill(mine ? Color.black.opacity(0.25) : personColor)
                Image(systemName: message.pending == true ? "arrow.up" : "play.fill")
                    .font(.caption.weight(.black))
                    .foregroundStyle(.black)
            }
            .frame(width: 26, height: 26)
            WatchVoiceBars(heights: WatchVoiceFormat.waveform(for: message.media?.attachmentId ?? message.id),
                           progress: 0, filled: mine ? .black : .white, empty: mine ? Color.black.opacity(0.35) : Color.white.opacity(0.35))
                .frame(width: 44, height: 18)
            Text(WatchVoiceFormat.duration(ms: message.media?.durationMs))
                .font(.caption2.weight(.bold)).monospacedDigit()
                .foregroundStyle(mine ? Color.black : Color.white)
            if unplayed {
                Circle().fill(WatchChatPalette.violet).frame(width: 6, height: 6)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 5)
        .background(mine ? WatchChatPalette.violet : WatchChatPalette.incoming,
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var avatar: some View {
        Text(String((message.senderName ?? "F").prefix(1)).uppercased())
            .font(.system(size: 9, weight: .black))
            .foregroundStyle(.black)
            .frame(width: 16, height: 16)
            .background(personColor, in: Circle())
            .accessibilityHidden(true)
    }

    private var header: String {
        let name = message.senderName ?? "Family"
        guard let date = WatchPlanDate.iso(message.createdAt) else { return name }
        return Calendar.current.isDateInToday(date)
            ? "\(name) · \(date.formatted(date: .omitted, time: .shortened))"
            : "\(name) · \(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
    }

    private var accessibilityText: String {
        let who = mine ? "You" : (message.senderName ?? "Family")
        if message.isVoice {
            return "\(who), voice message, \(WatchVoiceFormat.duration(ms: message.media?.durationMs))\(unplayed ? ", not played" : "")"
        }
        return "\(who): \(message.displayText)"
    }
}

/// Waveform-style bar row; bars left of `progress` use the filled colour.
struct WatchVoiceBars: View {
    let heights: [Double]
    var progress: Double = 0
    var filled: Color = .white
    var empty: Color = Color.white.opacity(0.35)

    var body: some View {
        GeometryReader { geometry in
            let count = max(1, heights.count)
            let spacing: CGFloat = 2
            let width = max(1, (geometry.size.width - spacing * CGFloat(count - 1)) / CGFloat(count))
            HStack(alignment: .center, spacing: spacing) {
                ForEach(Array(heights.enumerated()), id: \.offset) { index, height in
                    Capsule()
                        .fill(Double(index) / Double(count) < progress ? filled : empty)
                        .frame(width: width, height: max(2, geometry.size.height * height))
                }
            }
            .frame(maxHeight: .infinity)
        }
        .accessibilityHidden(true)
    }
}
