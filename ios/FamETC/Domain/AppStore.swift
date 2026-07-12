import Foundation
import SwiftUI
import Observation

/// The single source of truth for the native surfaces: the signed-in user's
/// family (with its kids) and the chat thread. Cache-first load gives an
/// instant, spinner-free cold start; chat is kept fresh with a long-poll loop
/// (`GET /api/chat/messages?afterId=&wait=1`, degrading gracefully against an
/// older plain-list server — see `runChatLoop`).
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
    private var chatLoopTask: Task<Void, Never>?
    private var chatAppBackgrounded = false

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
        // Restart the chat loop unconditionally — including on a thrown 401 or
        // transport error — so a failed initial network call (cold-start cookie
        // race, slow DNS/TLS warmup, expired session) can never permanently
        // stall chat with zero pending requests. Previously this only ran in
        // the success path below, so a single flaky first fetch left chat dead
        // until something else (e.g. the Chat tab's `chatActive` toggle)
        // happened to kick a poll — surfacing as "messages don't load until I
        // tap the screen".
        defer { isRefreshing = false; restartChatLoop() }
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
        } catch APIError.unauthenticated {
            needsAuth = true
        } catch {
            syncError = error.localizedDescription
        }
    }

    func signedOut() {
        stopChatLoop()
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

    /// Whether the Chat surface (native tab, iPad docked column, or slide-over)
    /// is currently on-screen. Toggling this restarts the loop below so the
    /// switch between the near-live long-poll cadence and the slower
    /// off-screen badge poll takes effect immediately.
    var chatActive = false {
        didSet { if chatActive != oldValue { restartChatLoop() } }
    }

    /// Cancels any in-flight iteration and starts a fresh loop, whose very
    /// first iteration is always an immediate plain fetch — this is what makes
    /// chat render right away on cold start, on entering the Chat surface, and
    /// on returning from the background, with no tap required. A no-op while
    /// the app is OS-backgrounded (`chatDidEnterBackground` clears that gate).
    func restartChatLoop() {
        stopChatLoop()
        guard !chatAppBackgrounded else { return }
        chatLoopTask = Task { [weak self] in
            await self?.runChatLoop()
        }
    }

    func stopChatLoop() {
        chatLoopTask?.cancel()
        chatLoopTask = nil
    }

    /// Suspend polling — cancels the in-flight request/sleep via structured
    /// Task cancellation (URLSession's async APIs abort the underlying request
    /// when their enclosing Task is cancelled, so this doesn't leak a request).
    func chatDidEnterBackground() {
        chatAppBackgrounded = true
        stopChatLoop()
    }

    /// Resume with an immediate fetch, mirroring cold start / surface-appear.
    func chatWillEnterForeground() {
        guard chatAppBackgrounded else { return }
        chatAppBackgrounded = false
        restartChatLoop()
    }

    /// The chat refresh loop. Two cadences, chosen per iteration off the live
    /// `chatActive` flag (so switching surfaces mid-loop takes effect on the
    /// very next iteration, not just at restart):
    ///
    /// - **On-screen** (`chatActive`): near-live long-poll against the new
    ///   contract — `GET /api/chat/messages?afterId=<lastId>&wait=1`, which a
    ///   NEW server holds open up to ~25s and returns the moment newer
    ///   messages exist, and an OLD server just answers immediately (ignoring
    ///   the params). Either way we enforce a minimum 2s spacing between
    ///   iterations so an old server's instant empty replies don't spin in a
    ///   tight loop — this is what keeps the app correct against both.
    /// - **Off-screen**: the previous plain 8s poll, so the unread badge and
    ///   kid-approval banner stay live while browsing other tabs.
    ///
    /// The very first iteration after every (re)start is always a plain full
    /// GET — works unchanged against the CURRENT production server and is
    /// what makes chat render immediately with no tap needed.
    private func runChatLoop() async {
        #if DEBUG
        // UI-test hook (FAM_MOCK_CHAT_DELAY_MS): hermetically reproduce the
        // messages-arrive-after-layout timing with no server, then stop.
        if let ms = DebugLaunch.mockChatDelayMs {
            try? await Task.sleep(for: .milliseconds(ms))
            if Task.isCancelled { return }
            injectMockChat()
            return
        }
        #endif
        var first = true
        while !Task.isCancelled {
            guard family != nil else {
                try? await Task.sleep(for: .seconds(chatActive ? 2 : 8))
                continue
            }
            guard chatActive else {
                await refreshChatNow()
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: .seconds(8))
                continue
            }
            let iterationStart = ContinuousClock.now
            if first || messages.last?.id == nil {
                await refreshChatNow()
                first = false
            } else if let afterId = messages.last?.id {
                if let fresh = try? await api.chatMessages(afterId: afterId, wait: true), !fresh.isEmpty {
                    mergeIncoming(fresh)
                    persist()
                }
                updateChatSeen()
                await refreshKidRequests() // surface new kid sign-in requests app-wide
            }
            guard !Task.isCancelled else { return }
            let elapsed = iterationStart.duration(to: .now)
            if elapsed < .seconds(2) {
                try? await Task.sleep(for: .seconds(2) - elapsed)
            }
        }
    }

    /// Merges a long-poll response into the in-memory thread by message id.
    /// Handles both server shapes without needing to know which one answered:
    /// a NEW server's `afterId` response is just the delta (ids we don't have
    /// yet), an OLD server ignoring `afterId` re-sends the latest full page
    /// (ids we already have) — either way, union-by-id + sort keeps the result
    /// correct, and an id already present gets its latest copy (edits/flags).
    func mergeIncoming(_ fresh: [ChatMessage]) {  // internal for FamETCTests
        guard !fresh.isEmpty else { return }
        // uniquingKeysWith, NOT uniqueKeysWithValues: `messages` can briefly
        // hold a duplicate id (optimistic send-append racing a long-poll
        // delta), and uniqueKeysWithValues TRAPS on duplicates — this was the
        // TestFlight build-24 crash (assertionFailure in Dictionary.init via
        // mergeIncoming). Collapsing to the newest copy self-heals instead.
        var byId = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, newer in newer })
        for m in fresh { byId[m.id] = m }
        messages = byId.values.sorted { $0.createdAt < $1.createdAt }
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
    /// Reloads `familyEvents` from the server afterward rather than appending the
    /// raw response, since a recurring `repeat` expands into multiple occurrences
    /// server-side (lib/events.js) that only `GET /api/calendar/events` returns.
    func addEvent(title: String, date: String, time: String?, notes: String?, category: String?, kidId: String?, endDate: String? = nil, repeatRule: String? = nil, repeatUntil: String? = nil) async {
        do {
            _ = try await api.addFamilyEvent(title: title, date: date, time: time, notes: notes, category: category, kidId: kidId, endDate: endDate, repeatRule: repeatRule, repeatUntil: repeatUntil)
            if let fe = try? await api.familyEvents() { familyEvents = fe }
            Task { await NotificationScheduler.reschedule(events: familyEvents, homework: homework, kids: family?.kids ?? []) }
        } catch { handle(error) }
    }

    /// Delete a family event's whole series (parent-only server-side). Removes
    /// every occurrence sharing this series id from local state on success.
    func deleteEvent(_ id: String) async {
        do {
            try await api.deleteFamilyEvent(id)
            familyEvents.removeAll { $0.id == id }
            Task { await NotificationScheduler.reschedule(events: familyEvents, homework: homework, kids: family?.kids ?? []) }
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

    /// Immediate one-shot plain fetch — full authoritative list, so it also
    /// picks up edits/deletes/flags the delta long-poll wouldn't. Used as the
    /// first iteration of every chat-loop (re)start (cold start, Chat surface
    /// appearing, foreground return) so new cross-device messages show without
    /// waiting on the poll cadence.
    func refreshChatNow() async {
        guard family != nil else { return }
        if let fresh = try? await api.chatMessages(limit: 50) {
            messages = fresh
            persist()
        }
        updateChatSeen()
        await refreshKidRequests()
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

    #if DEBUG
    /// Backs the FAM_MOCK_CHAT_DELAY_MS UI-test hook: enough messages to
    /// overflow one screen (so a mispositioned viewport is detectable), a
    /// system card (covers the onAppear-gated card regression), and a final
    /// marker message the UI test asserts is visible WITHOUT any gesture.
    private func injectMockChat() {
        let famId = "f_uitest"
        family = Family(id: famId, name: "QA Family", inviteCode: "QATEST",
                        parentIds: ["u_qa_parent"], parents: nil,
                        kids: [], createdAt: "2026-01-01T00:00:00.000Z")
        var msgs: [ChatMessage] = []
        func add(_ i: Int, _ text: String, mine: Bool = false, card: ChatCard? = nil) {
            msgs.append(ChatMessage(id: "m_qa_\(i)", familyId: famId,
                                    senderType: "parent",
                                    senderId: mine ? "u_qa_parent" : "u_qa_other",
                                    postedByUserId: nil, text: text, card: card,
                                    media: nil,
                                    createdAt: "2026-01-01T10:\(String(format: "%02d", i)):00.000Z",
                                    deleted: false, deletedBy: nil,
                                    flagged: false, flagReason: nil, flaggedBy: nil))
        }
        for i in 0..<12 { add(i, "Filler message number \(i) — long enough to take a couple of lines on a phone screen so twelve of these overflow the viewport.", mine: i % 3 == 0) }
        add(12, "📚 New homework for QA: Card visibility check", card: ChatCard(type: "homework", id: "hw_qa", title: "Card visibility check"))
        add(13, "FINAL MARKER — visible without scroll")
        messages = msgs
    }
    #endif

}
