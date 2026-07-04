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
    var events: [CalendarEvent] = []           // school-feed events (read-only)
    var familyEvents: [FamilyEvent] = []       // manually-added appointments (server-synced)
    var homework: [HomeworkItem] = []          // homework hub (Today / Calendar)
    var notes: [Note] = []                     // reflections + pinned snippets (Notes tab)
    var lastSeenChatId: String?                // for the Chat-tab unread badge
    var isRefreshing = false
    var needsAuth = false
    var syncError: String?

    var kids: [Kid] { family?.kids ?? [] }
    /// Kids never approve anyone; only parents see/act on access requests.
    var isParent: Bool { me?.role != "kid" }

    // MARK: Enrichment gating (Notes / Today widgets)

    /// "yyyy-MM-dd" for today, local time. Reuses `Agenda.todayKey()` (the
    /// existing day-key helper in Features/Shared/Agenda.swift) so every
    /// surface agrees on what day it is.
    var todayYMD: String { Agenda.todayKey() }

    /// Homework due today that isn't finished yet — drives the enrichment lock.
    var homeworkDueTodayCount: Int {
        homework.filter { $0.dueDate == todayYMD && $0.status != "done" }.count
    }

    /// When a kid has more than 3 homework items due today, the enrichment
    /// widgets (quote/mood/news/SAT/brain teaser) lock until they catch up.
    var enrichmentLocked: Bool { homeworkDueTodayCount > 3 }

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
        lastSeenChatId = UserDefaults.standard.string(forKey: lastSeenChatKey)
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
                // These loads are independent — run them concurrently so the
                // initial sync takes as long as the slowest call, not the sum.
                async let msgs = api.chatMessages(limit: 50)
                async let kids: Void = refreshKidRequests()
                async let calHw: Void = loadCalendarAndHomework()
                async let notesLoad: Void = loadNotes()
                messages = try await msgs
                updateChatSeen()
                _ = await (kids, calHw, notesLoad)
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
        let interval: Duration = chatActive ? .seconds(2) : .seconds(8)
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
        updateChatSeen()
        await refreshKidRequests() // surface new kid sign-in requests app-wide
        scheduleChatPoll()
    }

    // MARK: Notes

    /// Load the signed-in user's notes (kids see only their own; parents see
    /// the whole family — the server scopes it from the session).
    func loadNotes() async {
        guard family != nil else { notes = []; return }
        if let ns = try? await api.notes() { notes = ns }
    }

    /// Add a note (optimistic append, then reload to pick up the server id /
    /// timestamps). Returns the optimistic note on success, `nil` on failure.
    @discardableResult
    func addNote(body: String, source: String = "manual", ref: [String: Any]? = nil, date: String? = nil) async -> Note? {
        do {
            let note = try await api.addNote(body: body, date: date, source: source, ref: ref)
            notes.insert(note, at: 0)
            await loadNotes()
            return note
        } catch {
            handle(error)
            return nil
        }
    }

    /// Delete a note the signed-in member authored. Optimistic removal; reloads
    /// from the server on failure so a rejected delete reappears.
    func deleteNote(_ id: String) async {
        let backup = notes
        notes.removeAll { $0.id == id }
        do {
            try await api.deleteNote(id)
        } catch {
            notes = backup
            handle(error)
        }
    }

    /// True when the current session authored this note (kid → matches kidId,
    /// parent → matches user id) and may therefore delete it.
    func canDeleteNote(_ note: Note) -> Bool {
        if let kidId = me?.kidId, note.authorId == kidId { return true }
        if let uid = me?.id, note.authorId == uid { return true }
        return false
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
        guard family != nil else { events = []; familyEvents = []; homework = []; return }
        if let ev = try? await api.calendarEvents(force: force) { events = ev }
        if let fe = try? await api.familyEvents() { familyEvents = fe }
        if let hw = try? await api.homework() { homework = hw }
        Task { await NotificationScheduler.reschedule(events: familyEvents, homework: homework, kids: family?.kids ?? []) }
    }

    /// Add a family appointment (server posts a chat card; chat updates on poll).
    func addEvent(title: String, date: String, time: String?, notes: String?, category: String?, kidId: String?) async {
        do {
            let ev = try await api.addFamilyEvent(title: title, date: date, time: time, notes: notes, category: category, kidId: kidId)
            familyEvents.append(ev)
        } catch { handle(error) }
    }

    /// Pull-to-refresh on the Today / Calendar screens — forces a fresh feed sync.
    func refreshDashboard() async {
        await loadCalendarAndHomework(force: true)
    }

    /// Drag-to-reschedule a homework item to a new due date (yyyy-MM-dd).
    /// Optimistic; reverts on failure. Parent-only (the server ignores a kid's
    /// dueDate change), so callers gate the drag on isParent.
    func rescheduleHomework(_ id: String, to dayKey: String) async {
        guard let idx = homework.firstIndex(where: { $0.id == id }) else { return }
        let previous = homework[idx].dueDate
        guard previous != dayKey else { return }
        homework[idx].dueDate = dayKey
        do {
            let updated = try await api.setHomeworkDueDate(id, dueDate: dayKey)
            if let i = homework.firstIndex(where: { $0.id == id }) { homework[i] = updated }
        } catch {
            if let i = homework.firstIndex(where: { $0.id == id }) { homework[i].dueDate = previous }
            handle(error)
        }
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

    /// Send a GIF (Giphy) to the family chat.
    func sendGif(_ gif: GifResult) async {
        let sType = me?.role == "kid" ? "kid" : "parent"
        let sId = (me?.role == "kid" ? me?.kidId : me?.id) ?? me?.id ?? ""
        let media: [String: Any] = [
            "type": "gif", "url": gif.url, "previewUrl": gif.previewUrl,
            "width": gif.width ?? 0, "height": gif.height ?? 0,
        ]
        do {
            let msg = try await api.sendChatMessage(text: "", card: nil, media: media, senderType: sType, senderId: sId)
            messages.append(msg)
            persist()
        } catch { handle(error) }
    }

    /// Immediate one-shot chat refresh (e.g. when the Chat tab appears or the app
    /// returns to the foreground) so new cross-device messages show without waiting.
    func refreshChatNow() async {
        guard family != nil else { return }
        if let fresh = try? await api.chatMessages(limit: 50) {
            messages = fresh
            persist()
        }
        updateChatSeen()
    }

    // MARK: Unread chat badge

    private let lastSeenChatKey = "fam_last_seen_chat"

    /// Messages after the last-seen one that someone else sent (drives the Chat
    /// tab badge). Zero while the Chat tab is open (we keep marking it read).
    var unreadChatCount: Int {
        guard let seen = lastSeenChatId,
              let idx = messages.firstIndex(where: { $0.id == seen }),
              idx + 1 < messages.count else { return 0 }
        return messages[(idx + 1)...].filter { !isMine($0) }.count
    }

    func markChatRead() {
        lastSeenChatId = messages.last?.id
        if let id = lastSeenChatId { UserDefaults.standard.set(id, forKey: lastSeenChatKey) }
    }

    /// Keep the badge at 0 while chat is on-screen; establish a baseline on the
    /// very first load so existing history doesn't show as unread.
    private func updateChatSeen() {
        if chatActive || lastSeenChatId == nil { markChatRead() }
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
