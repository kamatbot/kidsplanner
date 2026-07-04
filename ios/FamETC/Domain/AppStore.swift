import Foundation
import SwiftUI
import Observation

/// The single source of truth for the native surfaces: the signed-in user's
/// family (with its kids) and the chat thread. Cache-first load gives an
/// instant, spinner-free cold start; chat is kept fresh with a debounced poll
/// (mirrors the RetireOdds `scheduleSim` debounce pattern, applied to
/// `GET /api/chat/messages?since=`).
@MainActor
@Observable
final class AppStore {
    // State
    var me: User?
    var family: Family?
    var messages: [ChatMessage] = []
    var kidRequests: [KidAccessRequest] = []   // pending kid sign-ins (parents approve)
    var events: [CalendarEvent] = []           // school-feed events (Today / Calendar)
    var homework: [HomeworkItem] = []          // homework hub (Today / Calendar)
    var isRefreshing = false
    var needsAuth = false
    var syncError: String?

    var kids: [Kid] { family?.kids ?? [] }
    /// Kids never approve anyone; only parents see/act on access requests.
    var isParent: Bool { me?.role != "kid" }

    // MARK: Chat identity helpers

    /// True if the signed-in user posted this message. `postedByUserId` is set for
    /// both parent and kid sessions (server always stamps it), so it's the reliable
    /// "mine" signal; fall back to senderId for any legacy message without it.
    func isMine(_ m: ChatMessage) -> Bool {
        if let posted = m.postedByUserId { return posted == me?.id }
        return m.senderId == me?.id
    }

    /// Display name for a message's sender, resolved from the family (messages
    /// carry only ids). Kids resolve via kid profiles; parents via `family.parents`.
    func senderName(for m: ChatMessage) -> String {
        if m.senderType == "kid" {
            return family?.kids.first { $0.id == m.senderId }?.name ?? "Kid"
        }
        return family?.parents?.first { $0.id == m.senderId }?.name ?? "Parent"
    }

    // Collaborators
    private let api = APIClient.shared
    private let cache = DiskCache()
    private var pollTask: Task<Void, Never>?

    // MARK: Lifecycle

    /// Render from cache immediately (if present), then refresh from the network.
    func load() async {
        loadTheme()
        if family == nil, let cached = cache.load() {
            me = cached.me
            family = cached.family
            messages = cached.messages
        }
        await refresh()
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            me = try await api.me().user
            let fams = try await api.families()
            family = fams.first
            if family != nil {
                messages = try await api.chatMessages(limit: 50)
                await refreshKidRequests()
                await loadCalendarAndHomework()
            }
            syncError = nil
            needsAuth = false
            persist()
            scheduleChatPoll()
        } catch APIError.unauthenticated {
            needsAuth = true
        } catch {
            syncError = error.localizedDescription
        }
    }

    func signedOut() {
        pollTask?.cancel()
        cache.clear()
        me = nil
        family = nil
        messages = []
        needsAuth = true
    }

    // MARK: Appearance

    /// Effective appearance: an explicit user override, or `nil` to follow the
    /// device (iOS Settings → Display). The whole palette is built from
    /// `Color.adaptive(light, dark)`, so this flips every surface at once.
    var themeOverride: ColorScheme?
    private let themeKey = "fam_theme"

    var colorScheme: ColorScheme? { themeOverride }

    func loadTheme() {
        switch UserDefaults.standard.string(forKey: themeKey) {
        case "light": themeOverride = .light
        case "dark": themeOverride = .dark
        default: themeOverride = nil
        }
    }

    func setTheme(_ scheme: ColorScheme?) {
        themeOverride = scheme
        switch scheme {
        case .light: UserDefaults.standard.set("light", forKey: themeKey)
        case .dark: UserDefaults.standard.set("dark", forKey: themeKey)
        default: UserDefaults.standard.removeObject(forKey: themeKey)
        }
    }

    // MARK: Family mutations

    func createFamily(name: String) async throws {
        family = try await api.createFamily(name: name)
        persist()
    }
    func joinFamily(code: String) async throws {
        family = try await api.joinFamily(code: code)
        persist()
    }
    func addKid(name: String, grade: String, color: String) async {
        do {
            let r = try await api.addKid(name: name, grade: grade, color: color)
            family = r.family
            persist()
        } catch { handle(error) }
    }
    func updateKid(_ kidId: String, _ patch: [String: Any]) async {
        do {
            let r = try await api.updateKid(kidId, patch)
            family = r.family
            persist()
        } catch { handle(error) }
    }
    func deleteKid(_ kidId: String) async {
        do {
            family = try await api.deleteKid(kidId)
            persist()
        } catch { handle(error) }
    }
    func removeMember(_ userId: String) async {
        do {
            family = try await api.removeMember(userId)
            persist()
        } catch { handle(error) }
    }

    // MARK: Chat

    /// Debounced re-poll after sending a message or on a timer (mirrors web
    /// long-poll behavior). Cancels any in-flight poll before scheduling a new one.
    /// When the Chat surface is on-screen we poll faster (near-live, matching the
    /// web's ~2s cadence); in the background we back off to save battery.
    var chatActive = false {
        didSet { if chatActive != oldValue { scheduleChatPoll() } }
    }

    func scheduleChatPoll() {
        pollTask?.cancel()
        let interval: Duration = chatActive ? .seconds(3) : .seconds(8)
        pollTask = Task { [weak self] in
            try? await Task.sleep(for: interval)
            guard !Task.isCancelled else { return }
            await self?.pollChat()
        }
    }

    private func pollChat() async {
        guard family != nil else { scheduleChatPoll(); return }
        if let fresh = try? await api.chatMessages(limit: 50) {
            // Only reassign when the thread actually changed, so an unchanged
            // poll doesn't churn the list / interrupt scrolling.
            if fresh.map(\.id) != messages.map(\.id) || fresh.last?.text != messages.last?.text {
                messages = fresh
                persist()
            }
        }
        await refreshKidRequests() // surface new kid sign-in requests app-wide
        scheduleChatPoll()
    }

    // MARK: Kid access requests

    func refreshKidRequests() async {
        guard isParent, family != nil else { kidRequests = []; return }
        if let fresh = try? await api.kidAccessRequests() {
            if fresh.map(\.id) != kidRequests.map(\.id) { kidRequests = fresh }
        }
    }

    func approveKid(_ id: String) async {
        do {
            family = try await api.approveKidAccess(id)
            kidRequests.removeAll { $0.id == id }
            persist()
        } catch { handle(error) }
    }

    func denyKid(_ id: String) async {
        do {
            try await api.denyKidAccess(id)
            kidRequests.removeAll { $0.id == id }
        } catch { handle(error) }
    }

    // MARK: Calendar + Homework (Today / Calendar tabs)

    /// Load school-feed events + homework. Best-effort: a failure in one leaves
    /// the other (and the rest of the app) intact.
    func loadCalendarAndHomework(force: Bool = false) async {
        guard family != nil else { events = []; homework = []; return }
        if let ev = try? await api.calendarEvents(force: force) { events = ev }
        if let hw = try? await api.homework() { homework = hw }
    }

    /// Pull-to-refresh on the Today / Calendar screens — forces a fresh feed sync.
    func refreshDashboard() async {
        await loadCalendarAndHomework(force: true)
    }

    /// Toggle a homework item done/undone (optimistic, reverts on failure).
    func toggleHomeworkDone(_ item: HomeworkItem) async {
        let next = item.isDone ? "todo" : "done"
        guard let idx = homework.firstIndex(where: { $0.id == item.id }) else { return }
        let previous = homework[idx].status
        homework[idx].status = next
        do {
            let updated = try await api.setHomeworkStatus(item.id, status: next)
            if let i = homework.firstIndex(where: { $0.id == item.id }) { homework[i] = updated }
        } catch {
            if let i = homework.firstIndex(where: { $0.id == item.id }) { homework[i].status = previous }
            handle(error)
        }
    }

    func sendMessage(text: String, card: [String: Any]? = nil, senderType: String = "parent", senderId: String) async {
        do {
            let msg = try await api.sendChatMessage(text: text, card: card, senderType: senderType, senderId: senderId)
            messages.append(msg)
            persist()
        } catch { handle(error) }
    }

    /// Convenience used by the native Chat screen — sends as the signed-in user.
    /// (The server derives the real sender from the session; these are for the
    /// API shape only.)
    func send(text: String) async {
        let sType = me?.role == "kid" ? "kid" : "parent"
        let sId = (me?.role == "kid" ? me?.kidId : me?.id) ?? me?.id ?? ""
        await sendMessage(text: text, senderType: sType, senderId: sId)
    }

    /// Immediate one-shot chat refresh (e.g. when the Chat tab appears or the app
    /// returns to the foreground) so new cross-device messages show without waiting.
    func refreshChatNow() async {
        guard family != nil else { return }
        if let fresh = try? await api.chatMessages(limit: 50) {
            messages = fresh
            persist()
        }
    }
    func deleteMessage(_ id: String) async {
        do {
            let updated = try await api.deleteChatMessage(id)
            if let idx = messages.firstIndex(where: { $0.id == id }) { messages[idx] = updated }
            persist()
        } catch { handle(error) }
    }
    func flagMessage(_ id: String, reason: String) async {
        do {
            let updated = try await api.flagChatMessage(id, reason: reason)
            if let idx = messages.firstIndex(where: { $0.id == id }) { messages[idx] = updated }
            persist()
        } catch { handle(error) }
    }

    // MARK: Persistence / errors

    private func persist() {
        cache.save(CachedAppData(family: family, messages: messages, me: me))
    }

    private func handle(_ error: Error) {
        if case APIError.unauthenticated = error { needsAuth = true }
        else { syncError = error.localizedDescription }
    }
}
