import SwiftUI
import Combine

struct WatchCompanionIdentity: Hashable {
    let userID: String
    let familyID: String
    let kidID: String
    init?(_ profile: WatchProfile?) {
        guard let profile, profile.role == "kid", let kidID = profile.kidId,
              !profile.userId.isEmpty, !profile.familyId.isEmpty, !kidID.isEmpty else { return nil }
        userID = profile.userId; familyID = profile.familyId; self.kidID = kidID
    }
}

struct WatchCompanionProfile: Codable, Equatable {
    var name: String
    var avatar: String
    var color: String
    var personality: String
    var reminders: Bool
    var enabled: Bool
    var ageBand: String
    static let avatars = ["comet", "robot", "fox", "owl", "axolotl"]
    static let colors = ["violet", "mint", "orange", "blue"]
    static let personalities = ["playful", "calm", "curious"]
    private var normalizedName: String { name.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines) }
    var validCustomization: Bool {
        let scalars = normalizedName.unicodeScalars
        return !scalars.isEmpty && scalars.count <= 24 && scalars.contains(where: { CharacterSet.letters.contains($0) })
            && scalars.allSatisfy { CharacterSet.letters.contains($0) || CharacterSet.nonBaseCharacters.contains($0) || " '’-".unicodeScalars.contains($0) }
            && Self.avatars.contains(avatar) && Self.colors.contains(color) && Self.personalities.contains(personality)
    }
    var cosmeticBody: [String: Any] {
        ["name": normalizedName, "avatar": avatar,
         "color": color, "personality": personality, "reminders": reminders]
    }
    var tint: Color {
        switch color {
        case "mint": return Color(red: 0.18, green: 0.83, blue: 0.71)
        case "orange": return Color(red: 1, green: 0.60, blue: 0.24)
        case "blue": return Color(red: 0.49, green: 0.64, blue: 1)
        default: return Color(red: 0.65, green: 0.55, blue: 1)
        }
    }
    var mascot: String {
        switch avatar { case "robot": return "🤖"; case "fox": return "🦊"; case "owl": return "🦉"; default: return "☄️" }
    }
}

private struct WatchCompanionBadge: View {
    let profile: WatchCompanionProfile
    var body: some View {
        ZStack {
            Circle().fill(profile.tint.opacity(0.16))
            if profile.avatar == "axolotl" {
                Canvas { context, size in
                    func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * size.width, y: y * size.height) }
                    var gills = Path()
                    for y in [CGFloat(0.3), 0.46, 0.62] {
                        gills.move(to: point(0.3, 0.5)); gills.addLine(to: point(0.12, y))
                        gills.move(to: point(0.7, 0.5)); gills.addLine(to: point(0.88, y))
                    }
                    context.stroke(gills, with: .color(.pink), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    context.fill(Path(ellipseIn: CGRect(x: size.width * 0.25, y: size.height * 0.28, width: size.width * 0.5, height: size.height * 0.5)), with: .color(Color(red: 1, green: 0.78, blue: 0.83)))
                    for x in [CGFloat(0.37), 0.6] {
                        context.fill(Path(ellipseIn: CGRect(x: size.width * x, y: size.height * 0.48, width: 2.5, height: 3)), with: .color(.black))
                    }
                    var smile = Path(); smile.move(to: point(0.44, 0.62)); smile.addQuadCurve(to: point(0.58, 0.62), control: point(0.51, 0.72))
                    context.stroke(smile, with: .color(.black), lineWidth: 1)
                }
            } else { Text(profile.mascot).font(.title2) }
        }.frame(width: 44, height: 44).accessibilityHidden(true)
    }
}

struct WatchCompanionMessage: Decodable, Equatable, Identifiable {
    struct Action: Decodable, Equatable, Identifiable {
        var id: String
        var label: String
        var open: String?
    }
    struct Card: Decodable, Equatable {
        struct State: Decodable, Equatable { var status: String; var label: String? }
        var type: String
        var title: String?
        var lines: [String]?
        var actions: [Action]?
        var state: State?
    }
    var id: String
    var senderType: String
    var senderId: String
    var text: String
    var createdAt: String
    var card: Card?
    var deleted: Bool?
}

struct WatchCompanionProfileResponse: Decodable { let profile: WatchCompanionProfile }
struct WatchCompanionMessagesResponse: Decodable { let messages: [WatchCompanionMessage] }
struct WatchCompanionSendResponse: Decodable { let message: WatchCompanionMessage; let messages: [WatchCompanionMessage]? }

protocol WatchCompanionChatClient {
    func fetchCompanion(identity: WatchCompanionIdentity) async throws -> WatchCompanionProfile
    func updateCompanion(_ profile: WatchCompanionProfile, identity: WatchCompanionIdentity) async throws -> WatchCompanionProfile
    func fetchCompanionMessages(afterID: String?, wait: Bool, identity: WatchCompanionIdentity) async throws -> [WatchCompanionMessage]
    func sendCompanionMessage(text: String, clientMessageID: String, identity: WatchCompanionIdentity) async throws -> WatchCompanionSendResponse
    func companionAction(messageID: String, action: String, identity: WatchCompanionIdentity) async throws -> WatchCompanionSendResponse
}

/// Ephemeral private chat: never enters the durable family-chat outbox.
@MainActor final class WatchCompanionChatStore: ObservableObject {
    @Published private(set) var identity: WatchCompanionIdentity?
    @Published private(set) var profile: WatchCompanionProfile?
    @Published private(set) var messages: [WatchCompanionMessage] = []
    @Published var draft = ""
    @Published private(set) var error: String?
    @Published private(set) var settingsError: String?
    @Published private(set) var loading = false
    @Published private(set) var sending = false
    @Published private(set) var saving = false
    @Published private(set) var acting = false
    @Published private(set) var pendingID: String?
    private var pendingText: String?
    private var generation = 0
    private let client: any WatchCompanionChatClient
    var isMutating: Bool { sending || saving || acting }

    init(client: any WatchCompanionChatClient = URLSessionWatchAPIClient()) { self.client = client }
    func clear() {
        generation &+= 1; identity = nil; profile = nil; messages = []; draft = ""
        error = nil; settingsError = nil; loading = false; sending = false; saving = false; acting = false
        pendingID = nil; pendingText = nil
    }
    private func current(_ scope: WatchCompanionIdentity, _ version: Int, _ isCurrent: () -> Bool) -> Bool {
        identity == scope && generation == version && isCurrent() && !Task.isCancelled
    }
    func listen(for scope: WatchCompanionIdentity, isCurrent: () -> Bool) async {
        guard isCurrent(), !Task.isCancelled else { return }
        if identity != scope { clear(); identity = scope }
        let version = generation
        loading = true; error = nil
        defer { if generation == version { loading = false } }
        do {
            let result = try await client.fetchCompanion(identity: scope)
            guard current(scope, version, isCurrent) else { return }
            profile = result
            guard result.enabled else { return }
            let initial = try await client.fetchCompanionMessages(afterID: nil, wait: false, identity: scope)
            guard current(scope, version, isCurrent) else { return }
            merge(initial); loading = false
            // The server's cursor follows insertion order, independently of
            // presentation sorting and concurrent send/action responses.
            var afterID = initial.last?.id
            while current(scope, version, isCurrent) {
                let started = Date()
                let incoming = try await client.fetchCompanionMessages(afterID: afterID, wait: true, identity: scope)
                guard current(scope, version, isCurrent) else { return }
                merge(incoming)
                let nextID = incoming.last?.id ?? afterID
                let delay = WatchChatPollDelay.seconds(elapsed: Date().timeIntervalSince(started),
                                                      madeProgress: nextID != afterID, emptyThread: nextID == nil)
                afterID = nextID
                if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
            }
        } catch {
            if current(scope, version, isCurrent) { self.error = "Couldn’t refresh. Connect to Wi-Fi or cellular and try again." }
        }
    }
    func send(for scope: WatchCompanionIdentity, isCurrent: () -> Bool) async {
        guard identity == scope, isCurrent(), !Task.isCancelled, profile?.enabled == true, !isMutating else { return }
        let text = pendingText ?? draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let id = pendingID ?? UUID().uuidString.lowercased()
        pendingID = id; pendingText = text
        let version = generation
        sending = true; error = nil
        defer { if generation == version { sending = false } }
        do {
            let response = try await client.sendCompanionMessage(text: text, clientMessageID: id, identity: scope)
            guard current(scope, version, isCurrent) else { return }
            merge([response.message] + (response.messages ?? []))
            if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }
            pendingID = nil; pendingText = nil
        } catch {
            if current(scope, version, isCurrent) {
                if let rejection = Self.rejectionMessage(error) {
                    // The server rejected this turn. Keep the editable draft,
                    // but a corrected turn must get its own idempotency key.
                    pendingID = nil; pendingText = nil
                    self.error = rejection + " Your draft is still here."
                } else {
                    self.error = "Delivery is unconfirmed. Retry checks the same message; it won’t create a second copy."
                }
            }
        }
    }
    private static func rejectionMessage(_ error: Error) -> String? {
        guard let error = error as? WatchAPIError else { return nil }
        switch error {
        case .http(let status, let message) where [400, 403, 404, 409, 413, 422, 429].contains(status): return message
        case .forbidden: return "Access changed or your helper is paused. Refresh chat or ask a parent to check access."
        case .unauthenticated: return "Reconnect your Watch to send this message."
        default: return nil
        }
    }
    func save(_ draft: WatchCompanionProfile, for scope: WatchCompanionIdentity, isCurrent: () -> Bool) async -> Bool {
        guard identity == scope, isCurrent(), !Task.isCancelled, draft.validCustomization, !isMutating else { return false }
        let version = generation
        saving = true; settingsError = nil
        defer { if generation == version { saving = false } }
        do {
            let result = try await client.updateCompanion(draft, identity: scope)
            guard current(scope, version, isCurrent) else { return false }
            profile = result; return true
        } catch {
            if current(scope, version, isCurrent) { settingsError = "Couldn’t save. Your choices are still here. Try again when connected." }
            return false
        }
    }
    func act(messageID: String, action: String, for scope: WatchCompanionIdentity, isCurrent: () -> Bool) async {
        guard identity == scope, isCurrent(), !Task.isCancelled, profile?.enabled == true, !isMutating else { return }
        let version = generation
        acting = true; error = nil
        defer { if generation == version { acting = false } }
        do {
            let result = try await client.companionAction(messageID: messageID, action: action, identity: scope)
            guard current(scope, version, isCurrent) else { return }
            merge([result.message] + (result.messages ?? []))
        } catch {
            if current(scope, version, isCurrent) { self.error = "Couldn’t update that reminder. Try again when connected." }
        }
    }
    private func merge(_ incoming: [WatchCompanionMessage]) {
        var byID = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        for message in incoming { byID[message.id] = message }
        messages = Array(byID.values.sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }.suffix(100))
    }
}

/// Notification routing is separate from the family reply action and outbox.
@MainActor final class WatchCompanionRoute: ObservableObject {
    static let shared = WatchCompanionRoute()
    @Published var requested = false
    nonisolated static func isCompanion(_ userInfo: [AnyHashable: Any]) -> Bool {
        userInfo["type"] as? String == "hermes_thread" || userInfo["roomId"] as? String == "hermes"
    }
}

struct WatchCompanionChatView: View {
    let identity: WatchCompanionIdentity
    @EnvironmentObject private var store: WatchStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = WatchCompanionChatStore()
    @State private var retry = 0
    @State private var showCustomizer = false
    @State private var showNext = false
    @State private var mutation: Task<Void, Never>?
    private var isCurrent: Bool { WatchCompanionIdentity(store.snapshot.context?.profile) == identity && !store.needsConnection }
    private var listening: Bool { scenePhase == .active && !showCustomizer && !showNext && isCurrent }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let profile = model.profile {
                    HStack {
                        WatchCompanionBadge(profile: profile)
                        VStack(alignment: .leading) {
                            Text(profile.name).font(.headline)
                            Text("Private · AI helper").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    if !profile.enabled { Text("Chat is paused. Ask a parent to enable your AI helper.").font(.footnote) }
                }
                if model.loading && model.messages.isEmpty { ProgressView("Loading…") }
                if model.messages.isEmpty && model.profile?.enabled == true && !model.loading {
                    Text("Ask a question or explore an idea. Homework help comes with hints. AI can make mistakes.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(model.messages) { message in messageRow(message) }
                if let error = model.error {
                    Text(error).font(.caption).foregroundStyle(.orange)
                }
                if model.error != nil || model.profile == nil && !model.loading {
                    Button("Refresh chat") { retry += 1 }.disabled(mutation != nil || model.isMutating)
                }
                if model.profile?.enabled == true { composer }
                // ponytail: v1 keeps private drafts only in this screen; add a separate encrypted,
                // account-scoped outbox if offline companion delivery becomes a product requirement.
                Text("Online only. Unsent drafts stay on this screen; they aren’t queued for later.")
                    .font(.caption2).foregroundStyle(.secondary)
            }.padding(.horizontal, 2)
        }
        .defaultScrollAnchor(.bottom)
        .navigationTitle("Companion")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                Button { showCustomizer = true } label: { Image(systemName: "paintpalette") }
                    .accessibilityLabel("Customize companion").disabled(model.profile == nil || mutation != nil || model.isMutating)
            }
        }
        .navigationDestination(isPresented: $showCustomizer) {
            if let profile = model.profile { WatchCompanionCustomizer(model: model, identity: identity, initial: profile, isCurrent: { isCurrent }) }
        }
        .navigationDestination(isPresented: $showNext) { MyNextView() }
        .task(id: "\(listening)-\(retry)") {
            guard listening else { return }
            await model.listen(for: identity, isCurrent: { isCurrent })
        }
        .onChange(of: isCurrent) { _, current in if !current { mutation?.cancel(); model.clear(); dismiss() } }
        .onChange(of: scenePhase) { _, phase in if phase != .active { mutation?.cancel() } }
        .onDisappear { mutation?.cancel() }
        .opacity(isCurrent ? 1 : 0).allowsHitTesting(isCurrent).accessibilityHidden(!isCurrent)
        .tint(model.profile?.tint ?? .purple)
    }

    private var composer: some View {
        VStack(spacing: 6) {
            TextField("Message…", text: $model.draft).submitLabel(.send).onSubmit(send)
                .disabled(mutation != nil || model.isMutating || model.pendingID != nil).accessibilityIdentifier("watch.companion.draft")
            Button(action: send) {
                if model.sending { ProgressView("Sending…") }
                else { Text(model.pendingID == nil ? "Send" : "Retry same message") }
            }.disabled(mutation != nil || model.isMutating || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("watch.companion.send")
            if model.pendingID != nil && !model.sending { Text("Delivery not yet confirmed.").font(.caption2).foregroundStyle(.orange) }
        }
    }
    private func send() {
        performMutation { await model.send(for: identity, isCurrent: { isCurrent }) }
    }
    private func performMutation(_ operation: @escaping () async -> Void) {
        // Claim the handle synchronously, before the task starts updating the
        // model, so a second tap cannot replace the task we need to cancel.
        guard mutation == nil, !model.isMutating else { return }
        mutation = Task {
            defer { mutation = nil }
            await operation()
        }
    }
    private func messageRow(_ message: WatchCompanionMessage) -> some View {
        let mine = message.senderType == "kid" && message.senderId == identity.kidID
        return VStack(alignment: .leading, spacing: 6) {
            Text(mine ? "You" : "\(model.profile?.name ?? "Companion") · AI helper")
                .font(.caption2.bold()).foregroundStyle(.secondary)
            Text(message.deleted == true ? "Message removed" : message.text)
            if message.deleted != true, let card = message.card, card.type == "hermes-nudge" {
                ForEach(Array((card.lines ?? []).enumerated()), id: \.offset) { _, line in Text(line).font(.footnote) }
                if let state = card.state, state.status != "open" {
                    Text(state.label ?? "Updated").font(.caption2).foregroundStyle(.secondary)
                } else {
                    ForEach(card.actions ?? []) { action in
                        if action.open == "homework" || action.open == "today" {
                            Button(action.label) { showNext = true }
                        } else if action.open == "goals" {
                            // ponytail: Watch has no native goal detail yet; enable navigation when
                            // that surface supports this goal, rather than opening an unrelated page.
                            Text("Open goals on iPhone or iPad").font(.caption2).foregroundStyle(.secondary)
                        } else if action.open == nil {
                            Button(action.label) {
                                performMutation { await model.act(messageID: message.id, action: action.id, for: identity, isCurrent: { isCurrent }) }
                            }.disabled(mutation != nil || model.isMutating || model.profile?.enabled != true)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(10)
        .background((mine ? model.profile?.tint ?? .purple : .gray).opacity(0.23), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct WatchCompanionCustomizer: View {
    @ObservedObject var model: WatchCompanionChatStore
    let identity: WatchCompanionIdentity
    let isCurrent: () -> Bool
    @State private var draft: WatchCompanionProfile
    @State private var saved = false
    @State private var mutation: Task<Void, Never>?
    @Environment(\.scenePhase) private var scenePhase
    init(model: WatchCompanionChatStore, identity: WatchCompanionIdentity, initial: WatchCompanionProfile, isCurrent: @escaping () -> Bool) {
        self.model = model; self.identity = identity; self.isCurrent = isCurrent
        _draft = State(initialValue: initial)
    }
    var body: some View {
        Form {
            HStack { WatchCompanionBadge(profile: draft); Text(draft.name).font(.headline) }
            TextField("Name", text: $draft.name).accessibilityIdentifier("watch.companion.name")
            Text("1–24 letters, spaces, hyphens or apostrophes.").font(.caption2).foregroundStyle(.secondary)
            Picker("Mascot", selection: $draft.avatar) { ForEach(WatchCompanionProfile.avatars, id: \.self) { Text($0.capitalized).tag($0) } }
            Picker("Color", selection: $draft.color) { ForEach(WatchCompanionProfile.colors, id: \.self) { Text($0.capitalized).tag($0) } }
            Picker("Personality", selection: $draft.personality) { ForEach(WatchCompanionProfile.personalities, id: \.self) { Text($0.capitalized).tag($0) } }
            Toggle("Gentle reminders", isOn: $draft.reminders)
            if let error = model.settingsError { Text(error).font(.caption).foregroundStyle(.orange) }
            if saved && draft == model.profile { Label("Saved", systemImage: "checkmark.circle") }
            Button(model.saving ? "Saving…" : "Save companion") {
                guard mutation == nil, !model.isMutating else { return }
                mutation = Task {
                    defer { mutation = nil }
                    if await model.save(draft, for: identity, isCurrent: isCurrent), let profile = model.profile { draft = profile; saved = true }
                }
            }.disabled(mutation != nil || model.isMutating || !draft.validCustomization || draft == model.profile || !isCurrent())
            Text("An AI helper can make mistakes. Tell a trusted adult if a reply worries you.").font(.caption2).foregroundStyle(.secondary)
        }
        .disabled(mutation != nil || model.isMutating)
        .navigationTitle("Make it yours")
        .onChange(of: scenePhase) { _, phase in if phase != .active { mutation?.cancel() } }
        .onDisappear { mutation?.cancel() }
    }
}
