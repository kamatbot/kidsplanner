import Foundation
import SwiftUI
import Observation

extension FamilyEvent {
    /// Moodle timetable imports use the bridge's canonical school/Timetable shape.
    var isImportedTimetable: Bool {
        kidId != nil && category == "school" && notes == "Timetable"
    }
}

/// The single source of truth for the native surfaces: the signed-in user's
/// family (with its kids) and the chat thread. Cache-first load gives an
/// instant, spinner-free cold start; chat is kept fresh with a long-poll loop
/// (`GET /api/chat/messages?afterId=&wait=1`, degrading gracefully against an
/// older plain-list server — see `runChatLoop`).
@MainActor
@Observable
final class AppStore {
    // State

    /// Chat threads keyed by room id ("family" or "trip:<tripId>" — see
    /// `familyRoomId`/`ChatRoom`, docs/TRIPS-PLAN.md). `messages` below is a
    /// convenience mirror of the family room so pre-Trips call sites (and
    /// ChatMergeTests) keep working unchanged.
    var messagesByRoom: [String: [ChatMessage]] = [:]
    var me: User? {
        didSet {
            if oldValue?.id != me?.id {
                clearGoals()
                notes = []
                notesLoadGeneration &+= 1
                sessionGeneration &+= 1
            }
        }
    }
    var family: Family? {
        didSet {
            if oldValue?.id != family?.id {
                clearGoals()
                notes = []
                notesLoadGeneration &+= 1
                sessionGeneration &+= 1
            }
        }
    }
    var kidRequests: [KidAccessRequest] = []   // pending kid sign-ins (parents approve)
    var events: [CalendarEvent] = []           // school-feed events (read-only)
    var familyEvents: [FamilyEvent] = []       // manually-added appointments (server-synced)
    var homework: [HomeworkItem] = []          // homework hub (Today / Calendar)
    var actions: [FamilyAction] = []            // Today / My next action queue
    var isLoadingActions = false
    var actionError: String?
    var completingActionIDs: Set<String> = []
    /// Per-assignment write lock. Homework mutations are intentionally
    /// serialized so a late response cannot replace a newer checklist/status.
    var homeworkMutationIDs: Set<String> = []
    var isLoadingHomework = false
    var homeworkError: String?
    var isLoadingCalendar = false
    var calendarError: String?
    /// Only stamped after all brief sources have successfully refreshed.
    var attentionUpdatedAt: Date?
    /// DiskCache is display acceleration, never authority for an external link.
    var assistanceIdentityVerified = false
    private var calendarHomeworkUpdatedAt: Date?
    private var actionsUpdatedAt: Date?
    var notes: [Note] = []                     // reflections + pinned snippets (Notes tab)
    private var notesLoadGeneration = 0
    private var sessionGeneration = 0
    var goals: [Goal] = []
    var goalsLoadState: GoalLoadState = .idle
    var goalsError: String?
    var goalMutationIDs: Set<String> = []
    private var goalsLoadGeneration = 0
    var pendingHomeworkKidID: String?
    /// Parent composite Meals state, or the family shopping projection for a
    /// kid session. Kids never receive pantry/menu/prefs/household state.
    var meals: MealsState?
    var isLoadingMeals = false
    var mealsError: String?
    private var mealsLoadGeneration = 0
    /// Chat rooms this session can see (`GET /api/chat/rooms`) — just the
    /// family room until the user is on a trip. Failing soft leaves this at
    /// just the family room so the Chat tab behaves exactly as before.
    var chatRooms: [ChatRoom] = [ChatRoom(roomId: familyRoomId, tripId: nil, title: "Family")]
    /// Set by a `trip_chat_message`/`trip_update` push deep link; consumed
    /// (and cleared) by `ChatTabHost` to programmatically switch into that
    /// trip's room the next time it appears.
    var pendingChatRoomId: String?
    var isRefreshing = false
    var needsAuth = false
    var syncError: String?

    /// Family-room convenience so existing call sites (and ChatMergeTests)
    /// keep working unchanged — every other room goes through `messagesByRoom`.
    var messages: [ChatMessage] {
        get { messagesByRoom[familyRoomId] ?? [] }
        set { messagesByRoom[familyRoomId] = newValue }
    }

    var kids: [Kid] { family?.kids ?? [] }
    /// Kids never approve anyone; only parents see/act on access requests.
    var isParent: Bool { me?.role != "kid" }

    // MARK: Calendar visibility (family/kid audience model)

    /// nil for a parent session (sees the FAMILY superset — every event); the
    /// signed-in kid's id for a kid session. `GET /api/calendar/events` and
    /// `/api/calendar/sync` return every family member's events unfiltered (no
    /// server-side kid scoping, unlike homework), so the client applies the
    /// kid rule: a kid sees family-wide events plus events scoped to themself,
    /// never a sibling's kid-scoped rows. A kid whose profile has not resolved
    /// yet fails closed rather than seeing any rows.
    var kidScope: String? { me?.role == "kid" ? me?.kidId : nil }

    /// Family (manually-added) calendar events visible to the current session.
    var visibleFamilyEvents: [FamilyEvent] {
        if me?.role == "kid" {
            guard let scope = kidScope else { return [] }
            return familyEvents.filter { $0.kidId == nil || $0.kidId == scope }
        }
        return familyEvents.filter { !$0.isImportedTimetable }
    }

    /// School-feed calendar events visible to the current session.
    var visibleEvents: [CalendarEvent] {
        if me?.role == "kid" {
            guard let scope = kidScope else { return [] }
            return events.filter { $0.kidId == nil || $0.kidId == scope }
        }
        return events.filter { !$0.isImportedTimetable }
    }

    // MARK: Chat identity helpers

    /// True if the signed-in user posted this message. `postedByUserId` is set for
    /// both parent and kid sessions (server always stamps it), so it's the reliable
    /// "mine" signal; fall back to senderId for any legacy message without it.
    func isMine(_ m: ChatMessage) -> Bool {
        if let posted = m.postedByUserId { return posted == me?.id }
        return m.senderId == me?.id
    }

    /// Display name for a message's sender. Prefers the wire's `senderName`
    /// (set for trip rooms, where the sender may be a guest the client can't
    /// resolve locally) and falls back to the family-scoped resolution
    /// (messages otherwise carry only ids). Kids resolve via kid profiles;
    /// parents via `family.parents`.
    func senderName(for m: ChatMessage) -> String {
        if let name = m.senderName, !name.isEmpty { return name }
        if m.senderType == "kid" {
            return family?.kids.first { $0.id == m.senderId }?.name ?? "Kid"
        }
        return family?.parents?.first { $0.id == m.senderId }?.name ?? "Parent"
    }

    // Collaborators
    private let api = APIClient.shared
    private let actionService: FamilyActionService
    private let chatService: ChatMessageService
    private let cache = DiskCache()
    private var chatLoopTask: Task<Void, Never>?      // near-live loop for the on-screen room
    private var familyPollTask: Task<Void, Never>?    // always-on 8s background poll, family room only
    private var chatAppBackgrounded = false
    /// Invalidates homework reads that began before a local write. Without this,
    /// an older GET can arrive after a successful PATCH and erase the new state.
    private var homeworkMutationRevision = 0
    private var homeworkLoadGeneration = 0
    private var refreshGeneration = 0
    private var actionLoadGeneration = 0

    init(actionService: FamilyActionService = APIClient.shared, chatService: ChatMessageService = APIClient.shared) {
        self.actionService = actionService
        self.chatService = chatService
    }

    // MARK: Lifecycle

    /// Render from cache immediately (if present), then refresh from the network.
    func load() async {
        loadTheme()
        #if DEBUG
        // Hermetic navigation UI tests do not need a signed-in backend. Keeping
        // the shell local prevents a slow/failed network request from masking
        // whether one iPad rail tap changed the selected surface.
        if DebugLaunch.mockNavigation { return }
        #endif
        lastSeenChatIdByRoom[familyRoomId] = loadLastSeen(familyRoomId)
        if family == nil, let cached = cache.load() {
            me = cached.me
            family = cached.family
            if let byRoom = cached.messagesByRoom, !byRoom.isEmpty {
                messagesByRoom = byRoom.mapValues(Self.dedupe)  // heal caches poisoned by build 24
            } else {
                messages = Self.dedupe(cached.messages)  // pre-Trips cache: family room only
            }
        }
        await refresh()
    }

    func refresh() async {
        assistanceIdentityVerified = false
        refreshGeneration &+= 1
        let generation = refreshGeneration
        isRefreshing = true
        // Restart the chat loops unconditionally — including on a thrown 401 or
        // transport error — so a failed initial network call (cold-start cookie
        // race, slow DNS/TLS warmup, expired session) can never permanently
        // stall chat with zero pending requests. Previously this only ran in
        // the success path below, so a single flaky first fetch left chat dead
        // until something else (e.g. the Chat tab's `activeRoomId` toggle)
        // happened to kick a poll — surfacing as "messages don't load until I
        // tap the screen".
        defer {
            if generation == refreshGeneration {
                isRefreshing = false
                restartChatLoop()
                startFamilyPollLoopIfNeeded()
            }
        }
        do {
            let currentUser = try await api.me().user
            guard generation == refreshGeneration else { return }
            if currentUser?.id != me?.id {
                ParentFamilyAssistancePublisher.clear()
                events = []
                familyEvents = []
                homework = []
                actions = []
                attentionUpdatedAt = nil
            }
            me = currentUser
            let fams = try await api.families()
            guard generation == refreshGeneration else { return }
            if family?.id != fams.first?.id { ParentFamilyAssistancePublisher.clear() }
            family = fams.first
            // Identity/family requests have succeeded. Rearm the visible room
            // now: its earlier loop belongs to the pre-refresh session, and
            // unrelated dashboard loads below may take much longer than chat.
            needsAuth = false
            restartChatLoop()
            assistanceIdentityVerified = currentUser.map { user in
                user.role != "kid" && family?.parentIds.contains(user.id) == true
            } ?? false
            if family != nil {
                // These loads are independent — run them concurrently so the
                // initial sync takes as long as the slowest call, not the sum.
                let previousChatIDs = Set(messages.map(\.id))
                async let msgs = api.chatMessages(limit: 50)
                async let kids: Void = refreshKidRequests()
                async let calHw: Void = loadCalendarAndHomework()
                async let actionLoad: Void = loadFamilyActions()
                async let notesLoad: Void = loadNotes()
                async let mealsLoad: Void = loadMeals()
                async let goalsLoad: Void = loadGoals()
                async let rooms = api.chatRooms()
                let freshMessages = try await msgs
                guard generation == refreshGeneration else { return }
                applyRoomSnapshot(freshMessages, roomId: familyRoomId, previousIDs: previousChatIDs)
                updateChatSeen(familyRoomId)
                _ = await (kids, calHw, actionLoad, notesLoad, mealsLoad, goalsLoad)
                guard generation == refreshGeneration else { return }
                // Fail soft to just the family room (Trips-unaware/unreachable server).
                let freshRooms = try? await rooms
                guard generation == refreshGeneration else { return }
                chatRooms = freshRooms ?? [ChatRoom(roomId: familyRoomId, tripId: nil, title: family?.name ?? "Family")]
            } else {
                // A guest with zero families can still be on a trip.
                let freshRooms = try? await api.chatRooms()
                guard generation == refreshGeneration else { return }
                chatRooms = freshRooms ?? []
            }
            for room in chatRooms where lastSeenChatIdByRoom[room.roomId] == nil {
                lastSeenChatIdByRoom[room.roomId] = loadLastSeen(room.roomId)
            }
            syncError = nil
            needsAuth = false
            persist()
            await ParentFamilyAssistancePublisher.publish(from: self)
        } catch APIError.unauthenticated {
            guard generation == refreshGeneration else { return }
            assistanceIdentityVerified = false
            ParentFamilyAssistancePublisher.clear()
            attentionUpdatedAt = nil
            needsAuth = true
        } catch {
            guard generation == refreshGeneration else { return }
            syncError = error.localizedDescription
        }
    }

    func signedOut() {
        clearGoals()
        sessionGeneration &+= 1
        notesLoadGeneration &+= 1
        notes = []
        assistanceIdentityVerified = false
        refreshGeneration &+= 1
        actionLoadGeneration &+= 1
        isRefreshing = false
        ParentFamilyAssistancePublisher.clear()
        stopChatLoop()
        familyPollTask?.cancel()
        familyPollTask = nil
        cache.clear()
        attentionUpdatedAt = nil
        calendarHomeworkUpdatedAt = nil
        actionsUpdatedAt = nil
        events = []
        familyEvents = []
        homework = []
        me = nil
        family = nil
        meals = nil
        isLoadingMeals = false
        mealsError = nil
        mealsLoadGeneration &+= 1
        isLoadingCalendar = false
        calendarError = nil
        actions = []
        isLoadingActions = false
        actionError = nil
        completingActionIDs = []
        homeworkMutationIDs = []
        isLoadingHomework = false
        homeworkError = nil
        homeworkMutationRevision &+= 1
        homeworkLoadGeneration &+= 1
        messagesByRoom = [:]
        lastSeenChatIdByRoom = [:]
        chatRooms = [ChatRoom(roomId: familyRoomId, tripId: nil, title: "Family")]
        activeRoomId = nil
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

    /// The chat room currently on-screen (native tab, iPad docked column, or
    /// slide-over) — `nil` when no chat surface is visible. Trips
    /// (docs/TRIPS-PLAN.md) generalized the old `chatActive: Bool` (family-only)
    /// into this: setting it restarts the near-live long-poll loop below for
    /// THAT room. The family room additionally always gets the slower 8s
    /// background poll (`familyPollTask`) regardless of what's active, so its
    /// unread badge / kid-approval banner stay live while browsing other tabs
    /// or another room's chat.
    var activeRoomId: String? = nil {
        didSet { if activeRoomId != oldValue { restartChatLoop() } }
    }

    /// Cancels any in-flight iteration and starts a fresh loop for
    /// `activeRoomId`, whose very first iteration is always an immediate plain
    /// fetch — this is what makes chat render right away on cold start, on
    /// entering a chat surface, and on returning from the background, with no
    /// tap required. A no-op while the app is OS-backgrounded
    /// (`chatDidEnterBackground` clears that gate) or no room is on-screen.
    func restartChatLoop() {
        stopChatLoop()
        guard !chatAppBackgrounded, !needsAuth, let roomId = activeRoomId else { return }
        chatLoopTask = Task { [weak self] in
            await self?.runActiveRoomLoop(roomId)
        }
    }

    func stopChatLoop() {
        chatLoopTask?.cancel()
        chatLoopTask = nil
    }

    /// Starts the always-on family-room background poll once (idempotent —
    /// safe to call from every `refresh()`). Only `signedOut`/backgrounding
    /// tear it down.
    private func startFamilyPollLoopIfNeeded() {
        guard familyPollTask == nil, !chatAppBackgrounded, !needsAuth else { return }
        familyPollTask = Task { [weak self] in
            await self?.runFamilyPollLoop()
        }
    }

    /// Suspend polling — cancels the in-flight request/sleep via structured
    /// Task cancellation (URLSession's async APIs abort the underlying request
    /// when their enclosing Task is cancelled, so this doesn't leak a request).
    func chatDidEnterBackground() {
        chatAppBackgrounded = true
        stopChatLoop()
        familyPollTask?.cancel()
        familyPollTask = nil
    }

    /// Resume with an immediate fetch, mirroring cold start / surface-appear.
    func chatWillEnterForeground() {
        guard chatAppBackgrounded else { return }
        chatAppBackgrounded = false
        restartChatLoop()
        startFamilyPollLoopIfNeeded()
    }

    /// Fetch immediately on entry, then keep one long poll listening, even in
    /// an empty room. New messages rearm immediately; fast empty/duplicate
    /// responses and failures retain a 2s floor for older servers and caps.
    /// The cursor comes only from receive responses: a concurrent send must not
    /// advance it past messages that this device has not received yet.
    func runActiveRoomLoop(_ roomId: String) async {  // internal for FamETCTests
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
        let session = sessionGeneration
        var first = true
        var cursor: String?
        while !Task.isCancelled, session == sessionGeneration, !needsAuth {
            if roomId == familyRoomId, family == nil {
                try? await Task.sleep(for: .seconds(2))
                continue
            }
            let iterationStart = ContinuousClock.now
            let previousIDs = Set((messagesByRoom[roomId] ?? []).map(\.id))
            var rearmImmediately = false
            do {
                let fresh = try await chatService.chatMessages(
                    roomId: roomId, since: nil, limit: first ? 50 : nil,
                    afterId: first ? nil : cursor, wait: !first)
                guard !Task.isCancelled, session == sessionGeneration else { return }
                rearmImmediately = first || (fresh.last.map { $0.id != cursor } ?? false)
                if first {
                    applyRoomSnapshot(fresh, roomId: roomId, previousIDs: previousIDs)
                } else if !fresh.isEmpty {
                    mergeIncoming(fresh, roomId: roomId)
                    persist()
                }
                // Do not derive this from the sorted display list: equal
                // timestamps and concurrent sends cannot skip a receive page.
                cursor = fresh.last?.id ?? cursor
                first = false
                updateChatSeen(roomId)
            } catch {
                guard !Task.isCancelled, session == sessionGeneration else { return }
                if requireAuthentication(for: error) { return }
            }
            guard !Task.isCancelled else { return }
            let elapsed = iterationStart.duration(to: .now)
            if !rearmImmediately, elapsed < .seconds(2) {
                try? await Task.sleep(for: .seconds(2) - elapsed)
            }
        }
    }

    /// Always-on background poll for the family room ONLY (badge + kid-approval
    /// banner), independent of `activeRoomId` — trip rooms only refresh while
    /// their own surface is on-screen (`runActiveRoomLoop`), matching the plan's
    /// "one loop for the active room plus the existing 8s family poll".
    private func runFamilyPollLoop() async {
        while !Task.isCancelled {
            guard family != nil else {
                try? await Task.sleep(for: .seconds(8))
                continue
            }
            // The active-room loop already keeps the family room near-live —
            // don't double-poll it here.
            if activeRoomId != familyRoomId {
                guard await refreshRoomNow(familyRoomId) else { return }
            }
            // Approvals must never block rearming the active chat listener.
            await refreshKidRequests()
            if needsAuth { return }
            guard !Task.isCancelled else { return }
            try? await Task.sleep(for: .seconds(8))
        }
    }

    /// Merges a long-poll response into one room's in-memory thread by message
    /// id. Handles both server shapes without needing to know which one
    /// answered: a NEW server's `afterId` response is just the delta (ids we
    /// don't have yet), an OLD server ignoring `afterId` re-sends the latest
    /// full page (ids we already have) — either way, union-by-id + sort keeps
    /// the result correct, and an id already present gets its latest copy
    /// (edits/flags). THE single upsert path for chat messages — every source
    /// (long-poll deltas, full refreshes, sent text, sent GIFs, disk cache)
    /// must land in `messagesByRoom` through this or through `Self.dedupe`.
    /// Build 24 crashed because send paths blind-appended while the long-poll
    /// merged the same message: `messages` held a duplicate id, `persist()`
    /// poisoned the disk cache with it, and the next
    /// `Dictionary(uniqueKeysWithValues:)` call (or next LAUNCH, via the
    /// poisoned cache) trapped — AppStore.swift:306 in the TestFlight crash log.
    func mergeIncoming(_ fresh: [ChatMessage], roomId: String = familyRoomId) {  // internal for FamETCTests
        guard !fresh.isEmpty else { return }
        let current = messagesByRoom[roomId] ?? []
        messagesByRoom[roomId] = Self.dedupe(current + fresh)
    }

    /// Collapse duplicate ids (last occurrence wins — later elements are the
    /// fresher copies) and order by createdAt. Tolerates already-corrupt
    /// input, so build-24-poisoned disk caches self-heal on load. Operates on
    /// one room's list at a time — callers apply it per room.
    static func dedupe(_ msgs: [ChatMessage]) -> [ChatMessage] {
        var byId: [String: ChatMessage] = [:]
        var orderedIDs: [String] = []
        for m in msgs {
            if byId[m.id] == nil { orderedIDs.append(m.id) }
            byId[m.id] = m
        }
        // Swift's stable sort preserves receive order for equal timestamps.
        return orderedIDs.compactMap { byId[$0] }.sorted { $0.createdAt < $1.createdAt }
    }

    // MARK: Notes

    /// Load the signed-in user's notes (kids see only their own; parents see
    /// the whole family — the server scopes it from the session).
    func loadNotes() async {
        notesLoadGeneration &+= 1
        let generation = notesLoadGeneration
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        guard family != nil else { notes = []; return }
        if let ns = try? await api.notes(), generation == notesLoadGeneration,
           session == sessionGeneration, me?.id == accountID, family?.id == familyID {
            notes = ns
        }
    }

    /// Append a confirmed note, then refresh. Late responses never enter another session.
    @discardableResult
    func addNote(body: String, source: String = "manual", ref: [String: Any]? = nil, date: String? = nil) async -> Note? {
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        do {
            let note = try await api.addNote(body: body, date: date, source: source, ref: ref)
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return nil }
            notesLoadGeneration &+= 1
            notes.insert(note, at: 0)
            await loadNotes()
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return nil }
            return note
        } catch {
            if session == sessionGeneration, me?.id == accountID, family?.id == familyID { handle(error) }
            return nil
        }
    }

    /// Delete a note the signed-in member authored. Optimistic removal; reloads
    /// from the server on failure so a rejected delete reappears.
    func deleteNote(_ id: String) async {
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        notesLoadGeneration &+= 1
        let backup = notes
        notes.removeAll { $0.id == id }
        do {
            try await api.deleteNote(id)
        } catch {
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return }
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

    // MARK: Meals (parent composite; family shopping for kids)

    private func clearGoals() {
        goalsLoadGeneration &+= 1
        goals = []
        goalsLoadState = .idle
        goalsError = nil
        goalMutationIDs = []
        pendingHomeworkKidID = nil
    }

    func loadGoals() async {
        guard family != nil, me != nil else { clearGoals(); return }
        // Do not let a read race a non-idempotent server toggle.
        guard goalMutationIDs.isEmpty else { return }
        goalsLoadGeneration &+= 1
        let generation = goalsLoadGeneration
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        goalsLoadState = .loading
        goalsError = nil
        do {
            let loaded = try await api.goals()
            guard generation == goalsLoadGeneration, session == sessionGeneration,
                  accountID == me?.id, familyID == family?.id else { return }
            goals = loaded.filter { goal in
                kids.contains { $0.id == goal.kidId } && (isParent || me?.kidId == goal.kidId)
            }
            goalsLoadState = .ready
        } catch {
            guard generation == goalsLoadGeneration, session == sessionGeneration,
                  accountID == me?.id, familyID == family?.id else { return }
            goalsLoadState = .error
            goalsError = error.localizedDescription
            if case APIError.unauthenticated = error { handle(error) }
        }
    }

    func toggleGoalCheck(_ goal: Goal) async {
        guard family != nil, me != nil,
              let index = goals.firstIndex(where: { $0.id == goal.id }),
              goals[index].type == "habit", kids.contains(where: { $0.id == goals[index].kidId }),
              isParent || me?.kidId == goals[index].kidId,
              goalMutationIDs.insert(goal.id).inserted else { return }
        let original = goals[index]
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        // Invalidate in-flight reads; independent goal writes may still finish.
        goalsLoadGeneration &+= 1
        goalsLoadState = .ready
        goalsError = nil
        let today = DateFmt.ymd.string(from: Date())
        var checks = original.checks ?? []
        if checks.contains(today) { checks.removeAll { $0 == today } }
        else { checks.append(today) }
        goals[index].checks = checks
        defer {
            if session == sessionGeneration { goalMutationIDs.remove(goal.id) }
        }
        do {
            let updated = try await api.toggleGoalCheck(id: goal.id)
            guard session == sessionGeneration, accountID == me?.id, familyID == family?.id,
                  let current = goals.firstIndex(where: { $0.id == goal.id }) else { return }
            guard updated.id == original.id, updated.kidId == original.kidId else {
                goals[current] = original
                goalsError = "Unable to update habit."
                return
            }
            goals[current] = updated
        } catch {
            guard session == sessionGeneration, accountID == me?.id, familyID == family?.id else { return }
            if let current = goals.firstIndex(where: { $0.id == goal.id }) { goals[current] = original }
            goalsError = error.localizedDescription
            if case APIError.unauthenticated = error { handle(error) }
        }
    }

    /// Parents load the composite planner; kids load only the shopping
    /// projection so pantry/menu/household data never crosses the API boundary.
    func loadMeals() async {
        mealsLoadGeneration &+= 1
        let generation = mealsLoadGeneration
        guard family != nil else {
            meals = nil; isLoadingMeals = false; mealsError = nil
            return
        }
        let accountID = me?.id
        let familyID = family?.id
        let parent = isParent
        isLoadingMeals = true
        mealsError = nil
        defer { if generation == mealsLoadGeneration { isLoadingMeals = false } }
        do {
            let loaded: MealsState
            if parent {
                loaded = try await api.mealsState()
            } else {
                var projection = MealsState()
                projection.shopping = try await api.shoppingItems()
                loaded = projection
            }
            guard generation == mealsLoadGeneration, me?.id == accountID, family?.id == familyID else { return }
            meals = loaded
        } catch {
            guard generation == mealsLoadGeneration, me?.id == accountID, family?.id == familyID else { return }
            mealsError = error.localizedDescription
            if case APIError.unauthenticated = error { handle(error) }
        }
    }

    func addPantryItem(name: String, category: String, level: String, unitHint: String? = nil, expiresOn: String? = nil) async {
        do {
            let item = try await api.addPantryItem(name: name, category: category, level: level, unitHint: unitHint, expiresOn: expiresOn)
            meals?.pantry.append(item)
        } catch { handle(error) }
    }

    func updatePantryItem(_ id: String, _ patch: [String: Any]) async {
        do {
            let item = try await api.updatePantryItem(id, patch)
            if let idx = meals?.pantry.firstIndex(where: { $0.id == id }) { meals?.pantry[idx] = item }
        } catch { handle(error) }
    }

    /// Optimistic; reverts the whole pantry array on failure.
    func deletePantryItem(_ id: String) async {
        let backup = meals?.pantry
        meals?.pantry.removeAll { $0.id == id }
        do {
            try await api.deletePantryItem(id)
        } catch {
            meals?.pantry = backup ?? []
            handle(error)
        }
    }

    /// Confirms the pantry-scan review list: bulk-adds every (possibly edited)
    /// detected item. Throws so the caller (the review sheet) can keep the sheet
    /// open and show the error instead of silently losing the scan.
    func bulkAddScannedPantryItems(_ items: [ScannedPantryItem]) async throws {
        let added = try await api.bulkAddPantryItems(items)
        meals?.pantry.append(contentsOf: added)
    }

    func seedPantryStaples() async {
        do {
            try await api.seedPantryStaples()
            await loadMeals()
        } catch { handle(error) }
    }

    /// Loads the existing parent-only recipe library with pantry coverage.
    /// Search/filter state stays view-local because it is transient UI state.
    func loadRecipes() async throws -> [Recipe] {
        guard isParent else { throw APIError.http(403, "Recipes are available to parents.") }
        return try await api.mealRecipes()
    }

    /// Adds a library recipe to dinner and mirrors the returned authoritative
    /// menu entry immediately.
    func addRecipeToMenu(recipeId: String, date: String) async throws -> MenuEntry {
        guard isParent else { throw APIError.http(403, "Only parents can plan meals.") }
        let entry = try await api.addRecipeMenuEntry(date: date, recipeId: recipeId)
        if let index = meals?.menu.firstIndex(where: { $0.id == entry.id }) {
            meals?.menu[index] = entry
        } else {
            meals?.menu.append(entry)
        }
        return entry
    }

    /// Adds missing recipe ingredients that are not already on the family
    /// shopping list. Partial success is retained; an error is surfaced only
    /// when every attempted addition fails.
    func addRecipeIngredientsToShopping(_ ingredients: [RecipeIngredient]) async throws -> Int {
        guard isParent else { throw APIError.http(403, "Only parents can add recipe ingredients.") }
        let normalize: (String) -> String = {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
                .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        }
        let known = Set((meals?.shopping ?? []).map { normalize($0.text) })
        var scheduled = known
        let pending = ingredients.filter { scheduled.insert(normalize($0.name)).inserted }
        var added = 0
        var completed = 0
        var firstError: Error?
        for ingredient in pending {
            do {
                let response = try await api.addShoppingItemResult(text: ingredient.name, category: ingredient.category)
                if let index = meals?.shopping.firstIndex(where: { $0.id == response.item.id }) {
                    meals?.shopping[index] = response.item
                } else {
                    meals?.shopping.append(response.item)
                }
                completed += 1
                if response.existing != true { added += 1 }
            } catch {
                if firstError == nil { firstError = error }
            }
        }
        if completed == 0, let firstError, !pending.isEmpty { throw firstError }
        return added
    }

    func addMenuEntry(date: String, title: String, note: String? = nil) async {
        do {
            let entry = try await api.addMenuEntry(date: date, title: title, note: note)
            meals?.menu.append(entry)
        } catch { handle(error) }
    }

    /// Previewing a Hermes meal plan is deliberately throwing so the review
    /// sheet can keep the request error local instead of replacing it with the
    /// app-wide sync error.
    func previewHermesMealPlan(messageId: String, startDate: String) async throws -> MealPlanPreviewResponse {
        try await api.previewHermesMealPlan(messageId: messageId, startDate: startDate)
    }

    /// Confirm a Hermes meal-plan import and mirror the server's authoritative
    /// menu immediately so the Meals tab reflects replacements and retries.
    func importHermesMealPlan(messageId: String, startDate: String, replaceExisting: Bool) async throws -> MealPlanImportResponse {
        let response = try await api.importHermesMealPlan(messageId: messageId,
                                                          startDate: startDate,
                                                          replaceExisting: replaceExisting)
        meals?.menu = response.menu
        return response
    }

    /// Previewing a Hermes Trip itinerary is deliberately throwing so the
    /// review sheet can keep a request error local instead of replacing it
    /// with the app-wide sync error.
    func previewHermesTripItinerary(tripId: String, messageId: String) async throws -> TripItineraryPreviewResponse {
        try await api.previewHermesTripItinerary(tripId: tripId, messageId: messageId)
    }

    /// Confirm a Hermes Trip itinerary import. Trip planning remains
    /// HybridWebView-backed, so this bridge intentionally does not create or
    /// refresh native Trip state.
    func importHermesTripItinerary(tripId: String, messageId: String) async throws -> TripItineraryImportResponse {
        try await api.importHermesTripItinerary(tripId: tripId, messageId: messageId)
    }

    func deleteMenuEntry(_ id: String) async {
        let backup = meals?.menu
        meals?.menu.removeAll { $0.id == id }
        do {
            try await api.deleteMenuEntry(id)
        } catch {
            meals?.menu = backup ?? []
            handle(error)
        }
    }

    /// Marks a dinner cooked, then reloads meals — cooking moves depleted pantry
    /// items toward shopping restock server-side (see the server contract), which
    /// only a fresh `GET /api/meals` reflects.
    func markMenuCooked(_ id: String) async {
        do {
            _ = try await api.markMenuCooked(id)
            await loadMeals()
        } catch { handle(error) }
    }

    func addShoppingItem(text: String, category: String? = nil) async {
        do {
            let item = try await api.addShoppingItem(text: text, category: category)
            meals?.shopping.append(item)
        } catch { handle(error) }
    }

    /// Optimistic; reverts on failure.
    func toggleShoppingDone(_ item: ShoppingItem) async {
        guard let idx = meals?.shopping.firstIndex(where: { $0.id == item.id }) else { return }
        let previous = item
        let nextDone = !previous.done
        meals?.shopping[idx].done = nextDone
        meals?.shopping[idx].doneBy = nextDone ? me?.id : nil
        meals?.shopping[idx].doneAt = nextDone ? ISO8601DateFormatter().string(from: Date()) : nil
        do {
            let updated = try await api.updateShoppingItem(item.id, ["done": nextDone])
            if let i = meals?.shopping.firstIndex(where: { $0.id == item.id }) { meals?.shopping[i] = updated }
        } catch {
            if let i = meals?.shopping.firstIndex(where: { $0.id == item.id }) { meals?.shopping[i] = previous }
            handle(error)
        }
    }

    // Kept as a source-compatible alias for older native callers; all state
    // and wire fields now use the canonical done/doneBy/doneAt contract.
    func toggleShoppingChecked(_ item: ShoppingItem) async {
        await toggleShoppingDone(item)
    }

    func deleteShoppingItem(_ id: String) async {
        guard isParent else { return }
        let backup = meals?.shopping
        meals?.shopping.removeAll { $0.id == id }
        do {
            try await api.deleteShoppingItem(id)
        } catch {
            meals?.shopping = backup ?? []
            handle(error)
        }
    }

    /// Adds low-stock pantry items to the shopping list, then reloads meals.
    func addShoppingFromLowPantry() async {
        guard isParent else { return }
        do {
            try await api.addShoppingFromPantry()
            await loadMeals()
        } catch { handle(error) }
    }

    // MARK: Kid access requests

    func refreshKidRequests() async {
        guard isParent, family != nil else { kidRequests = []; return }
        let session = sessionGeneration
        do {
            let fresh = try await api.kidAccessRequests()
            guard !Task.isCancelled, session == sessionGeneration else { return }
            if fresh.map(\.id) != kidRequests.map(\.id) { kidRequests = fresh }
        } catch {
            guard !Task.isCancelled, session == sessionGeneration else { return }
            _ = requireAuthentication(for: error)
        }
    }

    /// Refresh the room directory when a push targets a newly joined trip that
    /// was not present at launch. Returns true when the server answered, even
    /// if the requested room is no longer available.
    @discardableResult
    func refreshChatRooms() async -> Bool {
        do {
            chatRooms = try await api.chatRooms()
            for room in chatRooms where lastSeenChatIdByRoom[room.roomId] == nil {
                lastSeenChatIdByRoom[room.roomId] = loadLastSeen(room.roomId)
            }
            return true
        } catch {
            _ = requireAuthentication(for: error)
            return false
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

    /// Load school-feed events + homework. A homework failure preserves the
    /// current rows and exposes an explicit error instead of looking like a
    /// trustworthy empty workload. Reads older than a local mutation are
    /// ignored so they cannot roll successful edits back.
    func loadCalendarAndHomework(force: Bool = false) async {
        attentionUpdatedAt = nil
        calendarHomeworkUpdatedAt = nil
        guard family != nil else {
            events = []
            familyEvents = []
            homework = []
            homeworkMutationIDs = []
            isLoadingHomework = false
            homeworkError = nil
            isLoadingCalendar = false
            calendarError = nil
            homeworkMutationRevision &+= 1
            homeworkLoadGeneration &+= 1
            return
        }

        homeworkLoadGeneration &+= 1
        let loadGeneration = homeworkLoadGeneration
        let accountID = me?.id
        let familyID = family?.id
        let mutationRevisionAtStart = homeworkMutationRevision
        isLoadingHomework = true
        homeworkError = nil
        isLoadingCalendar = true
        calendarError = nil
        defer { if loadGeneration == homeworkLoadGeneration { isLoadingCalendar = false } }

        // These endpoints are independent. Starting Homework immediately keeps
        // its tab responsive even when a school calendar sync is slow.
        async let calendarRequest = api.calendarEvents(force: force)
        async let familyEventsRequest = api.familyEvents()
        async let homeworkRequest = api.homework()

        var homeworkLoaded = false
        do {
            let freshHomework = try await homeworkRequest
            if loadGeneration == homeworkLoadGeneration,
               me?.id == accountID, family?.id == familyID,
               mutationRevisionAtStart == homeworkMutationRevision,
               homeworkMutationIDs.isEmpty {
                homework = freshHomework
                homeworkLoaded = true
            }
        } catch {
            if loadGeneration == homeworkLoadGeneration {
                homeworkError = error.localizedDescription
                if case APIError.unauthenticated = error { handle(error) }
            }
        }
        if loadGeneration == homeworkLoadGeneration { isLoadingHomework = false }
        var freshEvents: [CalendarEvent]?
        var freshFamilyEvents: [FamilyEvent]?
        var calendarLoadError: Error?
        do { freshEvents = try await calendarRequest } catch { calendarLoadError = error }
        do { freshFamilyEvents = try await familyEventsRequest } catch { calendarLoadError = error }
        guard me?.id == accountID, family?.id == familyID,
              loadGeneration == homeworkLoadGeneration else { return }
        if let calendarLoadError {
            calendarError = calendarLoadError.localizedDescription
            if case APIError.unauthenticated = calendarLoadError { handle(calendarLoadError) }
        }
        if let freshEvents { events = freshEvents }
        if let freshFamilyEvents { familyEvents = freshFamilyEvents }
        if homeworkLoaded, freshEvents != nil, freshFamilyEvents != nil, !needsAuth {
            calendarHomeworkUpdatedAt = Date()
            updateAttentionFreshness()
        }
        Task { await NotificationScheduler.reschedule(events: visibleFamilyEvents, homework: homework, kids: family?.kids ?? []) }
    }

    /// Load the server-scoped action queue. Actions are intentionally not put
    /// in DiskCache: the endpoint is `no-store`, and a stale kid action would
    /// be a privacy and correctness hazard. The server applies the canonical
    /// scope, then this client guard removes any unexpected sibling/cross-family
    /// rows before they enter native state. Existing rows remain visible while
    /// a refresh is in flight; an initial failure is kept local to the card.
    func loadFamilyActions() async {
        actionLoadGeneration &+= 1
        let generation = actionLoadGeneration
        attentionUpdatedAt = nil
        actionsUpdatedAt = nil
        guard family != nil else {
            actions = []
            isLoadingActions = false
            actionError = nil
            return
        }

        isLoadingActions = true
        actionError = nil
        let accountID = me?.id
        let familyID = family?.id
        do {
            let freshActions = try await actionService.familyActions()
            guard generation == actionLoadGeneration, me?.id == accountID, family?.id == familyID else { return }
            actions = freshActions.filter { canViewAction($0) }
            actionsUpdatedAt = Date()
            updateAttentionFreshness()
        } catch {
            guard generation == actionLoadGeneration, me?.id == accountID, family?.id == familyID else { return }
            actionError = error.localizedDescription
            if case APIError.unauthenticated = error { handle(error) }
        }
        isLoadingActions = false
    }

    private func updateAttentionFreshness() {
        guard let calendarDate = calendarHomeworkUpdatedAt, let actionDate = actionsUpdatedAt,
              !needsAuth else { return }
        attentionUpdatedAt = min(calendarDate, actionDate)
    }

    /// Add a family appointment (server posts a chat card; chat updates on poll).
    /// Reloads `familyEvents` from the server afterward rather than appending the
    /// raw response, since a recurring `repeat` expands into multiple occurrences
    /// server-side (lib/events.js) that only `GET /api/calendar/events` returns.
    func addEvent(title: String, date: String, time: String?, notes: String?, category: String?, kidId: String?, endDate: String? = nil, repeatRule: String? = nil, repeatUntil: String? = nil) async {
        do {
            _ = try await api.addFamilyEvent(title: title, date: date, time: time, notes: notes, category: category, kidId: kidId, endDate: endDate, repeatRule: repeatRule, repeatUntil: repeatUntil)
            if let fe = try? await api.familyEvents() { familyEvents = fe }
            Task { await NotificationScheduler.reschedule(events: visibleFamilyEvents, homework: homework, kids: family?.kids ?? []) }
        } catch { handle(error) }
    }

    /// Edit a family event's whole series (creator-or-parent server-side, 403
    /// otherwise — surfaced via `handle(error)`). Reloads `familyEvents` from the
    /// server afterward rather than patching in place, matching `addEvent`: a
    /// changed `repeat` rule reshapes how many occurrences the series expands to
    /// (lib/events.js `expandRecurring`), which only a fresh `GET` reflects.
    func updateEvent(_ id: String, title: String, date: String, time: String?, notes: String?, category: String?, kidId: String?, endDate: String? = nil, repeatRule: String? = nil, repeatUntil: String? = nil) async {
        do {
            _ = try await api.updateFamilyEvent(id, title: title, date: date, time: time, notes: notes, category: category, kidId: kidId, endDate: endDate, repeatRule: repeatRule, repeatUntil: repeatUntil)
            if let fe = try? await api.familyEvents() { familyEvents = fe }
            Task { await NotificationScheduler.reschedule(events: visibleFamilyEvents, homework: homework, kids: family?.kids ?? []) }
        } catch { handle(error) }
    }

    /// Delete a family event's whole series (creator-or-parent server-side, 403
    /// otherwise). Removes every occurrence sharing this series id from local
    /// state on success.
    func deleteEvent(_ id: String) async {
        do {
            try await api.deleteFamilyEvent(id)
            familyEvents.removeAll { $0.id == id }
            Task { await NotificationScheduler.reschedule(events: visibleFamilyEvents, homework: homework, kids: family?.kids ?? []) }
        } catch { handle(error) }
    }

    /// Pull-to-refresh on the Today / Calendar screens — forces a fresh feed sync.
    func refreshDashboard() async {
        assistanceIdentityVerified = false
        let generation = refreshGeneration
        do {
            let currentUser = try await api.me().user
            guard generation == refreshGeneration else { return }
            guard let currentUser, currentUser.id == me?.id else {
                ParentFamilyAssistancePublisher.clear()
                await refresh()
                return
            }
            let families = try await api.families()
            guard generation == refreshGeneration else { return }
            guard let updated = families.first(where: { $0.id == family?.id }) else {
                ParentFamilyAssistancePublisher.clear()
                await refresh()
                return
            }
            me = currentUser
            family = updated
            assistanceIdentityVerified = currentUser.role != "kid" && updated.parentIds.contains(currentUser.id)
            persist()
        } catch {
            guard generation == refreshGeneration else { return }
            attentionUpdatedAt = nil
            handle(error)
            return
        }
        async let calendar: Void = loadCalendarAndHomework(force: true)
        async let actionLoad: Void = loadFamilyActions()
        async let goalsLoad: Void = loadGoals()
        _ = await (calendar, actionLoad, goalsLoad)
        guard generation == refreshGeneration else { return }
        await ParentFamilyAssistancePublisher.publish(from: self)
    }

    /// Drag-to-reschedule a homework item to a new due date (yyyy-MM-dd).
    /// Optimistic; reverts on failure. Parent-only (the server ignores a kid's
    /// dueDate change), so callers gate the drag on isParent.
    func rescheduleHomework(_ id: String, to dayKey: String) async {
        guard let idx = homework.firstIndex(where: { $0.id == id }) else { return }
        let previous = homework[idx].dueDate
        guard previous != dayKey, beginHomeworkMutation(id) else { return }
        defer { finishHomeworkMutation(id) }
        homework[idx].dueDate = dayKey
        do {
            let updated = try await api.setHomeworkDueDate(id, dueDate: dayKey)
            if let i = homework.firstIndex(where: { $0.id == id }) { homework[i] = updated }
            homeworkError = nil
        } catch {
            if let i = homework.firstIndex(where: { $0.id == id }) { homework[i].dueDate = previous }
            homeworkError = error.localizedDescription
            handle(error)
        }
    }

    /// Sets an explicit homework lifecycle state optimistically, then reconciles
    /// with the authoritative server item. A failed request restores only the
    /// field this operation owned.
    @discardableResult
    func setHomeworkStatus(_ item: HomeworkItem, status: String) async -> Bool {
        guard canChangeHomeworkProgress(item) else { return false }
        guard let idx = homework.firstIndex(where: { $0.id == item.id }) else { return false }
        let previousStatus = homework[idx].status
        guard previousStatus != status, beginHomeworkMutation(item.id) else { return false }
        defer { finishHomeworkMutation(item.id) }
        homework[idx].status = status
        do {
            let updated = try await api.setHomeworkStatus(item.id, status: status)
            if let i = homework.firstIndex(where: { $0.id == item.id }) { homework[i] = updated }
            homeworkError = nil
            return true
        } catch {
            if let i = homework.firstIndex(where: { $0.id == item.id }) { homework[i].status = previousStatus }
            homeworkError = error.localizedDescription
            handle(error)
            return false
        }
    }

    /// Sets one exact checklist state optimistically. Index validation uses the
    /// current server-backed item so a stale row cannot address a different step.
    @discardableResult
    func setHomeworkChecklistStep(_ item: HomeworkItem, index: Int, done: Bool) async -> Bool {
        guard let itemIndex = homework.firstIndex(where: { $0.id == item.id }) else { return false }
        let previousChecklist = homework[itemIndex].checklist
        let currentChecklist = homework[itemIndex].checklistItems
        guard currentChecklist.indices.contains(index),
              currentChecklist[index].done != done,
              beginHomeworkMutation(item.id) else { return false }
        defer { finishHomeworkMutation(item.id) }

        var checklist = currentChecklist
        checklist[index].done = done
        homework[itemIndex].checklist = checklist
        do {
            let updated = try await api.setHomeworkChecklistStep(item.id, index: index, done: done)
            if let currentIndex = homework.firstIndex(where: { $0.id == item.id }) {
                homework[currentIndex] = updated
            }
            homeworkError = nil
            return true
        } catch {
            if let currentIndex = homework.firstIndex(where: { $0.id == item.id }) {
                homework[currentIndex].checklist = previousChecklist
            }
            homeworkError = error.localizedDescription
            handle(error)
            return false
        }
    }

    /// Replaces the ordered checklist optimistically for add/delete/text edits.
    @discardableResult
    func replaceHomeworkChecklist(_ item: HomeworkItem, checklist: [HomeworkChecklistItem]) async -> Bool {
        guard let itemIndex = homework.firstIndex(where: { $0.id == item.id }) else { return false }
        let previousChecklist = homework[itemIndex].checklist
        guard checklist != homework[itemIndex].checklistItems,
              beginHomeworkMutation(item.id) else { return false }
        defer { finishHomeworkMutation(item.id) }
        homework[itemIndex].checklist = checklist
        do {
            let updated = try await api.setHomeworkChecklist(item.id, checklist: checklist)
            if let currentIndex = homework.firstIndex(where: { $0.id == item.id }) {
                homework[currentIndex] = updated
            }
            homeworkError = nil
            return true
        } catch {
            if let currentIndex = homework.firstIndex(where: { $0.id == item.id }) {
                homework[currentIndex].checklist = previousChecklist
            }
            homeworkError = error.localizedDescription
            handle(error)
            return false
        }
    }

    /// Parent review never changes a student's progress, including through
    /// chat/Today detail sheets rather than the main Homework screen.
    func canChangeHomeworkProgress(_ item: HomeworkItem) -> Bool {
        guard me?.role == "kid", let ownKidId = me?.kidId else { return false }
        return item.kidId == ownKidId
    }

    /// Toggle a homework item done/undone (optimistic, reverts on failure).
    func toggleHomeworkDone(_ item: HomeworkItem) async {
        await setHomeworkStatus(item, status: item.isDone ? "todo" : "done")
    }

    private func beginHomeworkMutation(_ id: String) -> Bool {
        guard !homeworkMutationIDs.contains(id) else { return false }
        homeworkMutationIDs.insert(id)
        homeworkMutationRevision &+= 1
        return true
    }

    private func finishHomeworkMutation(_ id: String) {
        homeworkMutationIDs.remove(id)
        homeworkMutationRevision &+= 1
    }

    /// Kids see shared actions plus actions assigned to their linked kid. This
    /// mirrors the server scope and protects native state if an old/proxy
    /// response ever contains a sibling or foreign-family row.
    func canViewAction(_ action: FamilyAction) -> Bool {
        guard action.familyId == family?.id else { return false }
        if isParent { return true }
        guard let ownKidId = me?.kidId else { return false }
        return action.assigneeType == "family" || canManageOwnKidAction(action, ownKidId: ownKidId)
    }

    func canManageOwnKidAction(_ action: FamilyAction, ownKidId: String) -> Bool {
        action.assigneeType == "kid" &&
            action.assigneeId == ownKidId && action.kidId == ownKidId
    }

    /// Shared and sibling rows are intentionally read-only for kids. Parents
    /// may complete ordinary actions, but only review student homework.
    func canCompleteAction(_ action: FamilyAction) -> Bool {
        guard canViewAction(action), !action.isDone else { return false }
        if isParent && action.sourceType == "homework" { return false }
        return isParent || (me?.kidId.map { canManageOwnKidAction(action, ownKidId: $0) } ?? false)
    }

    /// Snoozing uses the same role boundary as completion. The web exposes the
    /// same three presets and the server validates the resulting timestamp.
    func canSnoozeAction(_ action: FamilyAction) -> Bool {
        guard canViewAction(action), !action.isDone else { return false }
        if isParent && action.sourceType == "homework" { return false }
        return isParent || (me?.kidId.map { canManageOwnKidAction(action, ownKidId: $0) } ?? false)
    }

    @discardableResult
    func createFamilyAction(title: String, dueDate: String? = nil) async -> Bool {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isParent, me != nil, family != nil, !title.isEmpty else { return false }
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        do {
            let created = try await api.createFamilyAction(title: title, dueDate: dueDate)
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID,
                  isParent, canViewAction(created) else { return false }
            // Retire reads issued before the write response so they cannot erase it.
            actionLoadGeneration &+= 1
            isLoadingActions = false
            actions.removeAll { $0.id == created.id }
            actions.append(created)
            actionError = nil
            return true
        } catch {
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return false }
            actionError = error.localizedDescription
            if case APIError.unauthenticated = error { handle(error) }
            return false
        }
    }

    func deleteFamilyAction(_ action: FamilyAction) async {
        guard isParent, me != nil, canViewAction(action),
              actions.contains(where: { $0.id == action.id }),
              completingActionIDs.insert(action.id).inserted else { return }
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        defer {
            if session == sessionGeneration { completingActionIDs.remove(action.id) }
        }
        do {
            try await api.deleteFamilyAction(id: action.id)
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID,
                  isParent, canViewAction(action) else { return }
            actionLoadGeneration &+= 1
            isLoadingActions = false
            actions.removeAll { $0.id == action.id }
            actionError = nil
        } catch {
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return }
            // Keep the original row visible until the server confirms deletion.
            actionError = error.localizedDescription
            if case APIError.unauthenticated = error { handle(error) }
        }
    }

    /// Optimistically completes an action, then replaces it with the server's
    /// response. Any failed PATCH restores the exact previous action so the
    /// row never disappears permanently because of a transient error.
    func completeAction(_ action: FamilyAction) async {
        guard canCompleteAction(action), !completingActionIDs.contains(action.id),
              let index = actions.firstIndex(where: { $0.id == action.id }) else { return }

        let previous = actions[index]
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        defer {
            if session == sessionGeneration, me?.id == accountID, family?.id == familyID {
                completingActionIDs.remove(action.id)
            }
        }
        completingActionIDs.insert(action.id)
        actions[index].status = "done"
        actions[index].snoozedUntil = nil
        do {
            let updated = try await actionService.updateFamilyAction(action.id, status: "done", snoozedUntil: nil)
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return }
            if let currentIndex = actions.firstIndex(where: { $0.id == action.id }) {
                actions[currentIndex] = updated
            }
            actionError = nil
        } catch {
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return }
            if let currentIndex = actions.firstIndex(where: { $0.id == action.id }) {
                actions[currentIndex] = previous
            } else {
                actions.append(previous)
            }
            actionError = error.localizedDescription
            if case APIError.unauthenticated = error { handle(error) }
        }
    }

    /// Optimistically snoozes an eligible action using the existing server
    /// PATCH contract, then reconciles with the authoritative response.
    func snoozeAction(_ action: FamilyAction, preset: ActionSnoozePreset) async {
        guard canSnoozeAction(action), !completingActionIDs.contains(action.id),
              let index = actions.firstIndex(where: { $0.id == action.id }) else { return }

        let previous = actions[index]
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        defer {
            if session == sessionGeneration, me?.id == accountID, family?.id == familyID {
                completingActionIDs.remove(action.id)
            }
        }
        let snoozedUntil = ActionQueue.snoozeUntil(preset)
        completingActionIDs.insert(action.id)
        actions[index].status = "snoozed"
        actions[index].snoozedUntil = snoozedUntil
        do {
            let updated = try await actionService.updateFamilyAction(action.id, status: "snoozed", snoozedUntil: snoozedUntil)
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return }
            if let currentIndex = actions.firstIndex(where: { $0.id == action.id }) {
                actions[currentIndex] = updated
            }
            actionError = nil
        } catch {
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return }
            if let currentIndex = actions.firstIndex(where: { $0.id == action.id }) {
                actions[currentIndex] = previous
            } else {
                actions.append(previous)
            }
            actionError = error.localizedDescription
            if case APIError.unauthenticated = error { handle(error) }
        }
    }

    @discardableResult
    func sendMessage(text: String, card: [String: Any]? = nil, senderType: String = "parent", senderId: String, roomId: String = familyRoomId) async -> Bool {
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        do {
            let msg = try await api.sendChatMessage(text: text, card: card, senderType: senderType, senderId: senderId, roomId: roomId)
            guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { return false }
            mergeIncoming([msg], roomId: roomId)   // NEVER append: the long-poll may already have delivered this id
            persist()
            return true
        } catch {
            if session == sessionGeneration, me?.id == accountID, family?.id == familyID { handle(error) }
            return false
        }
    }

    /// Sends one dedicated Buzz alert. Errors intentionally propagate so the
    /// Chat composer can keep its draft and offer a retry.
    func sendBuzz(text: String, roomId: String = familyRoomId) async throws {
        let session = sessionGeneration
        let accountID = me?.id
        let familyID = family?.id
        let msg = try await api.sendChatBuzz(text: text, roomId: roomId)
        guard session == sessionGeneration, me?.id == accountID, family?.id == familyID else { throw CancellationError() }
        mergeIncoming([msg], roomId: roomId)
        persist()
    }

    /// Convenience used by the native Chat screen — sends as the signed-in user.
    /// (The server derives the real sender from the session; these are for the
    /// API shape only.)
    @discardableResult
    func send(text: String, roomId: String = familyRoomId) async -> Bool {
        let sType = me?.role == "kid" ? "kid" : "parent"
        let sId = (me?.role == "kid" ? me?.kidId : me?.id) ?? me?.id ?? ""
        return await sendMessage(text: text, senderType: sType, senderId: sId, roomId: roomId)
    }

    /// Send a GIF (Giphy) to a chat room (defaults to family).
    func sendGif(_ gif: GifResult, roomId: String = familyRoomId) async {
        let session = sessionGeneration
        let sType = me?.role == "kid" ? "kid" : "parent"
        let sId = (me?.role == "kid" ? me?.kidId : me?.id) ?? me?.id ?? ""
        let media: [String: Any] = [
            "type": "gif", "url": gif.url, "previewUrl": gif.previewUrl,
            "width": gif.width ?? 0, "height": gif.height ?? 0,
        ]
        do {
            let msg = try await api.sendChatMessage(text: "", card: nil, media: media, senderType: sType, senderId: sId, roomId: roomId)
            guard session == sessionGeneration else { return }
            mergeIncoming([msg], roomId: roomId)   // NEVER append: the long-poll may already have delivered this id
            persist()
        } catch {
            if session == sessionGeneration { handle(error) }
        }
    }

    /// Immediate one-shot plain fetch for one room — full authoritative list,
    /// so it also picks up edits/deletes/flags the delta long-poll wouldn't.
    /// Used by the slower family poll while another room/tab is visible.
    /// The active-room loop applies the same snapshot on its first request.
    private func refreshRoomNow(_ roomId: String) async -> Bool {
        let session = sessionGeneration
        let previousIDs = Set((messagesByRoom[roomId] ?? []).map(\.id))
        do {
            let fresh = try await chatService.chatMessages(roomId: roomId, since: nil, limit: 50, afterId: nil, wait: false)
            guard !Task.isCancelled, session == sessionGeneration else { return false }
            applyRoomSnapshot(fresh, roomId: roomId, previousIDs: previousIDs)
            updateChatSeen(roomId)
            return true
        } catch {
            guard !Task.isCancelled, session == sessionGeneration else { return false }
            return !requireAuthentication(for: error)
        }
    }

    /// A send can finish while a snapshot is in flight. Retain those newly
    /// confirmed messages while accepting authoritative edits/tombstones.
    private func applyRoomSnapshot(_ fresh: [ChatMessage], roomId: String, previousIDs: Set<String>) {
        let concurrent = (messagesByRoom[roomId] ?? []).filter { !previousIDs.contains($0.id) }
        let freshIDs = Set(fresh.map(\.id))
        let normalized = Self.dedupe(fresh + concurrent.filter { !freshIDs.contains($0.id) })
        if messagesByRoom[roomId] != normalized {
            messagesByRoom[roomId] = normalized
            persist()
        }
    }

    // MARK: Unread chat badge

    private func lastSeenChatKey(_ roomId: String) -> String { "fam_last_seen_chat_\(roomId)" }
    /// Pre-Trips key (family room only) — migrated to `lastSeenChatKey(familyRoomId)`.
    private let legacyLastSeenChatKey = "fam_last_seen_chat"

    /// Per-room last-seen message id, persisted under `fam_last_seen_chat_<roomId>`.
    var lastSeenChatIdByRoom: [String: String] = [:]

    /// Reads (and migrates) a room's persisted last-seen id. The single
    /// pre-Trips key held only the family room's value — copied over to that
    /// room's namespaced key on first read so history isn't misread as unread.
    private func loadLastSeen(_ roomId: String) -> String? {
        let key = lastSeenChatKey(roomId)
        if let v = UserDefaults.standard.string(forKey: key) { return v }
        guard roomId == familyRoomId,
              let legacy = UserDefaults.standard.string(forKey: legacyLastSeenChatKey) else { return nil }
        UserDefaults.standard.set(legacy, forKey: key)
        return legacy
    }

    /// Messages after the last-seen one (across every room whose messages are
    /// loaded) that someone else sent — drives the Chat tab badge. A room stays
    /// at 0 while it's on-screen (we keep marking it read).
    var unreadChatCount: Int {
        messagesByRoom.keys.reduce(0) { $0 + unreadCount(for: $1) }
    }

    /// Unread count for one room (used by the room-list badges too).
    func unreadCount(for roomId: String) -> Int {
        guard let seen = lastSeenChatIdByRoom[roomId],
              let msgs = messagesByRoom[roomId] else { return 0 }
        guard let idx = msgs.firstIndex(where: { $0.id == seen }) else {
            // The server returns a bounded recent window. If the last-seen id
            // fell outside it, every visible message is newer than our marker.
            return msgs.filter { !isMine($0) }.count
        }
        guard idx + 1 < msgs.count else { return 0 }
        return msgs[(idx + 1)...].filter { !isMine($0) }.count
    }

    func markChatRead(_ roomId: String = familyRoomId) {
        let last = messagesByRoom[roomId]?.last?.id
        lastSeenChatIdByRoom[roomId] = last
        if let last { UserDefaults.standard.set(last, forKey: lastSeenChatKey(roomId)) }
    }

    /// Keep a room's badge at 0 while it's on-screen; establish a baseline on
    /// its very first load so existing history doesn't show as unread.
    private func updateChatSeen(_ roomId: String) {
        if activeRoomId == roomId || lastSeenChatIdByRoom[roomId] == nil { markChatRead(roomId) }
    }
    func deleteMessage(_ id: String, roomId: String = familyRoomId) async {
        do {
            let updated = try await api.deleteChatMessage(id, roomId: roomId)
            if var msgs = messagesByRoom[roomId], let idx = msgs.firstIndex(where: { $0.id == id }) {
                msgs[idx] = updated
                messagesByRoom[roomId] = msgs
            }
            persist()
        } catch { handle(error) }
    }
    func flagMessage(_ id: String, reason: String, roomId: String = familyRoomId) async {
        do {
            let updated = try await api.flagChatMessage(id, reason: reason, roomId: roomId)
            if var msgs = messagesByRoom[roomId], let idx = msgs.firstIndex(where: { $0.id == id }) {
                msgs[idx] = updated
                messagesByRoom[roomId] = msgs
            }
            persist()
        } catch { handle(error) }
    }

    // MARK: Persistence / errors

    private func persist() {
        // `messages` (family room) written alongside `messagesByRoom` for
        // downgrade safety — see CachedAppData.messagesByRoom.
        cache.save(CachedAppData(family: family, messages: messages, me: me, messagesByRoom: messagesByRoom))
    }

    private func handle(_ error: Error) {
        if case APIError.unauthenticated = error { _ = requireAuthentication(for: error) }
        else { syncError = error.localizedDescription }
    }

    /// Moves the app to the re-auth boundary and cancels both pollers. Keeping
    /// this in one place prevents an expired session from becoming a silent,
    /// endless stream of 401 requests.
    @discardableResult
    private func requireAuthentication(for error: Error) -> Bool {
        guard case APIError.unauthenticated = error else { return false }
        assistanceIdentityVerified = false
        ParentFamilyAssistancePublisher.clear()
        attentionUpdatedAt = nil
        needsAuth = true
        stopChatLoop()
        familyPollTask?.cancel()
        familyPollTask = nil
        return true
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
