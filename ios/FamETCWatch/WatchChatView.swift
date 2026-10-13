import SwiftUI
import WatchKit

private let chatAccent = Color(red: 185 / 255, green: 140 / 255, blue: 1)
private let chatCoral = Color(red: 240 / 255, green: 112 / 255, blue: 79 / 255)

/// Root screen: family chat first, newest at the bottom, reply right below it.
/// Everything else (My next, day, lists, settings) is one tap away.
struct WatchChatView: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var showHub = false
    @State private var showQuickReplies = false
    @State private var showCompanion = false
    @ObservedObject private var companionRoute = WatchCompanionRoute.shared
    var onDisconnect: () -> Void = {}

    static let quickReplies = ["❤️", "OK", "On my way", "Be there soon", "Can you call me?", "Love you", "Thanks!"]

    private var messages: [WatchChatMessage] { store.snapshot.chat ?? [] }
    private var companionIdentity: WatchCompanionIdentity? { WatchCompanionIdentity(store.snapshot.context?.profile) }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    if store.chatUnavailable {
                        Text("Chat isn't available on this watch yet.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else if messages.isEmpty {
                        Text(store.snapshot.chat == nil ? "Loading chat…" : "No messages yet. Say hi 👋")
                            .font(.footnote).foregroundStyle(.secondary)
                            .padding(.vertical, 8)
                    }
                    let profile = store.snapshot.context?.profile
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        let previous = index > 0 ? messages[index - 1] : nil
                        ChatBubble(message: message,
                                   mine: message.isMine(profile),
                                   showSender: previous?.senderId != message.senderId || previous?.senderType != message.senderType)
                    }
                    if !store.chatUnavailable && store.snapshot.context != nil { replyControls }
                }
                .padding(.horizontal, 2)
            }
            .defaultScrollAnchor(.bottom)
            .navigationTitle("Family")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if companionIdentity != nil {
                    ToolbarItem(placement: .bottomBar) {
                        Button { showCompanion = true } label: { Image(systemName: "sparkles").foregroundStyle(chatAccent) }
                            .accessibilityLabel("Your AI companion").accessibilityIdentifier("watch.companion.open")
                    }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button { showHub = true } label: {
                        Image(systemName: store.focusSession == nil ? "list.bullet" : "timer")
                            .foregroundStyle(store.focusSession == nil ? Color.primary : chatCoral)
                    }
                    .accessibilityLabel("My next, calendar and lists")
                }
            }
            .navigationDestination(isPresented: $showHub) { MyNextView(onDisconnect: onDisconnect) }
            .navigationDestination(isPresented: $showCompanion) {
                if let identity = companionIdentity { WatchCompanionChatView(identity: identity).id(identity) }
            }
            .onChange(of: companionIdentity) { _, _ in showCompanion = false; consumeCompanionRoute() }
            .onChange(of: companionRoute.requested) { _, _ in consumeCompanionRoute() }
            .onAppear { consumeCompanionRoute() }
            // Live only while this screen is on a raised wrist; dropping the
            // wrist or opening the hub cancels the parked request.
            .task(id: scenePhase == .active && !showHub && !showCompanion) {
                guard scenePhase == .active, !showHub, !showCompanion else { return }
                await store.listenForChat()
            }
        }
        .fontDesign(.rounded)
        .tint(chatAccent)
    }

    private func consumeCompanionRoute() {
        guard companionRoute.requested, companionIdentity != nil else { return }
        companionRoute.requested = false; showHub = false; showCompanion = true
    }

    private var replyControls: some View {
        VStack(spacing: 6) {
            if let error = store.chatSendError {
                Text(error).font(.caption2).foregroundStyle(.orange)
            } else if store.snapshot.chat?.contains(where: { $0.pending == true }) == true && store.connection == .offline {
                Text("Offline — will send when connected").font(.caption2).foregroundStyle(.secondary)
            }
            // One row so the messages keep the screen: instant 👍, then the
            // system input (dictation, Scribble, emoji), then canned replies.
            HStack(spacing: 4) {
                Button("👍") { send("👍") }
                    .frame(width: 40)
                    .accessibilityLabel("Send thumbs up")
                TextField("Reply…", text: $draft)
                    .submitLabel(.send)
                    .onSubmit { send(draft) }
                Button { showQuickReplies = true } label: { Image(systemName: "text.bubble") }
                    .frame(width: 40)
                    .accessibilityLabel("Quick replies")
            }
            .buttonStyle(.bordered)
        }
        .sheet(isPresented: $showQuickReplies) {
            List(Self.quickReplies, id: \.self) { reply in
                Button(reply) {
                    showQuickReplies = false
                    send(reply)
                }
            }
        }
        .padding(.top, 6)
    }

    private func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = ""
        WKInterfaceDevice.current().play(.click)
        Task { await store.sendChat(trimmed) }
    }
}

private struct ChatBubble: View {
    let message: WatchChatMessage
    let mine: Bool
    let showSender: Bool

    var body: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 1) {
            if showSender {
                Text(header)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(mine ? Color.secondary : chatAccent)
                    .padding(.top, 4)
            }
            Text(message.displayText)
                .font(.body)
                .italic(message.deleted == true)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(
                    mine ? chatAccent.opacity(0.35) : (message.buzz == true ? chatCoral.opacity(0.35) : Color.gray.opacity(0.25)),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
                .opacity(message.pending == true ? 0.6 : 1)
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .accessibilityElement(children: .combine)
        .accessibilityHint(message.pending == true ? "Sending" : "")
    }

    private var header: String {
        let name = mine ? "You" : (message.senderName ?? "Family")
        guard let date = WatchPlanDate.iso(message.createdAt) else { return name }
        return Calendar.current.isDateInToday(date)
            ? "\(name) · \(date.formatted(date: .omitted, time: .shortened))"
            : "\(name) · \(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
    }
}
