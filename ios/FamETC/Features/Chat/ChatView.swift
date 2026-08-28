import Foundation
import SwiftUI

// MARK: - Chat (native)
//
// Family group chat, native on iOS but backed by the SAME server thread as the
// web. Playful, colorful bubbles (not a WhatsApp/Messenger clone): big rounded
// bubbles, per-sender colored avatars, a purple→pink gradient for your own
// messages, GIFs (Giphy), and distinct animated cards for homework/calendar
// system messages that deep-link to the item.
//
// Trips (docs/TRIPS-PLAN.md) generalized this from a single family thread to
// one screen per ROOM ("family" or "trip:<tripId>", see `familyRoomId`) —
// `roomId`/`title` default to the family room, so every pre-Trips call site
// (`ChatScreen()`) renders exactly as before.
//
// Keyboard note: SwiftUI's automatic keyboard avoidance lifts the column so the
// composer rides flush on top of the keyboard; we only drop the tab-bar
// clearance to zero while the keyboard is up.
struct ChatScreen<HeaderAccessory: View>: View {
    var roomId: String = familyRoomId
    var title: String? = nil
    /// Extra header control, trailing the title — e.g. the compact circular
    /// room switcher. Same generic-with-default-EmptyView shape as
    /// `SurfaceScaffold`'s `Trailing`.
    @ViewBuilder var headerAccessory: () -> HeaderAccessory

    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var draft = ""
    @State private var keyboardVisible = false
    @State private var showGifPicker = false
    @State private var hwRef: HWRef?
    @State private var eventRef: EVRef?
    @State private var newEventReq: NewEventReq?
    @State private var newShoppingReq: NewShoppingReq?
    @State private var mealPlanRef: MealPlanRef?
    @State private var tripItineraryRef: TripItineraryRef?
    @State private var scrollPos = ScrollPosition(edge: .bottom)
    @State private var buzzAlert: BuzzAlert?
    @State private var isSendingBuzz = false
    @FocusState private var composerFocused: Bool

    private enum BuzzAlert: Identifiable {
        case confirmation
        case error(String)

        var id: String {
            switch self {
            case .confirmation: return "confirmation"
            case .error(let message): return "error:\(message)"
            }
        }
    }

    private var baseInset: CGFloat { hSize == .compact ? Layout.tabBarClearance : Space.lg }
    private var bottomInset: CGFloat { keyboardVisible ? 0 : baseInset }
    private var isFamilyRoom: Bool { roomId == familyRoomId }
    private var currentMessages: [ChatMessage] { store.messagesByRoom[roomId] ?? [] }

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
        // activeRoomId's didSet restarts the chat loop with an immediate plain
        // fetch as its first iteration — see AppStore.restartChatLoop — so
        // messages render right away with no tap needed, whether this is a
        // native tab page, the iPad docked column, or the slide-over sheet.
        // The onChange covers the iPad docked column, where a room switch
        // changes `roomId` on an already-appeared screen (no onAppear refires).
        .onAppear { store.activeRoomId = roomId }
        // If this screen came from a push tap, NotificationHandler already
        // started the fetch before navigation. Consume that in-flight result
        // immediately instead of waiting for the chat loop's first request.
        .task(id: roomId) { await store.consumeNotificationChatPrefetch(roomId: roomId) }
        .onChange(of: roomId) { _, newValue in store.activeRoomId = newValue }
        .onDisappear { if store.activeRoomId == roomId { store.activeRoomId = nil } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
            store.chatDidEnterBackground()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            store.chatWillEnterForeground()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardVisible = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardVisible = false }
        .sheet(isPresented: $showGifPicker) {
            GifPickerSheet { gif in Task { await store.sendGif(gif, roomId: roomId) } }
        }
        .sheet(item: $hwRef) { ref in HomeworkDetailSheet(homeworkId: ref.id) }
        .sheet(item: $eventRef) { ref in EventDetailSheet(eventId: ref.id) }
        .sheet(item: $newEventReq) { req in
            ChatAddEventSheet(messageId: req.messageId, initialTitle: req.title, initialTime: req.time)
        }
        .sheet(item: $newShoppingReq) { req in
            ChatAddShoppingSheet(messageId: req.messageId, initialText: req.text)
        }
        .sheet(item: $mealPlanRef) { ref in
            MealPlanReviewSheet(messageId: ref.id, dateMode: ref.dateMode)
        }
        .sheet(item: $tripItineraryRef) { ref in
            TripItineraryReviewSheet(tripId: ref.tripId, messageId: ref.messageId)
        }
        .alert(item: $buzzAlert) { alert in
            switch alert {
            case .confirmation:
                Alert(
                    title: Text("Send a Buzz?"),
                    message: Text("This sends one Time Sensitive alert to everyone else in this chat. Apple Watch controls the vibration pattern."),
                    primaryButton: .cancel(Text("Cancel")),
                    secondaryButton: .destructive(Text("Send Buzz"), action: sendBuzz)
                )
            case .error(let message):
                Alert(
                    title: Text("Buzz not sent"),
                    message: Text("\(message) Your draft is still here."),
                    primaryButton: .cancel(Text("Cancel")),
                    secondaryButton: .default(Text("Retry"), action: sendBuzz)
                )
            }
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                MicroLabel(text: isFamilyRoom ? "Family chat" : "Trip chat")
                Text(title ?? (isFamilyRoom ? (store.family?.name ?? "Chat") : "Trip"))
                    .font(Typography.cardTitle).foregroundStyle(Palette.text)
            }
            Spacer()
            headerAccessory()
        }
        .padding(.horizontal, Space.lg).padding(.top, Space.md).padding(.bottom, Space.sm)
    }

    // MARK: Messages

    // First-layout race fix (device bug, builds 21-22): a LazyVStack whose
    // rows arrive AFTER initial layout keeps a stale visible region — rows
    // exist in store.messages but never materialize until a gesture forces
    // recalculation (and card rows gated on onAppear stayed invisible).
    // Repair: plain VStack (the server caps the window at 200 messages, so
    // laziness buys nothing), iOS 18 ScrollPosition + scrollTargetLayout for
    // a stable programmatic position, and a bottom scroll AFTER the updated
    // content has laid out — unanimated for the initial population.
    private var messages: some View {
        ScrollView {
            VStack(spacing: Space.md) {
                ForEach(currentMessages) { m in
                    ChatMessageRow(message: m,
                                   isMine: store.isMine(m),
                                   senderName: store.senderName(for: m),
                                   onTapCard: handleCardTap,
                                   canAddToCalendar: isFamilyRoom,
                                   onAddToCalendar: handleAddToCalendar,
                                   canAddToShopping: isFamilyRoom,
                                   onAddToShopping: handleAddToShopping,
                                   onPinToNotes: handlePinToNotes,
                                   canImportMealPlan: canImportMealPlan(m),
                                   onImportMealPlan: handleMealPlanImport,
                                   canImportTripItinerary: canImportTripItinerary(m),
                                   onImportTripItinerary: handleTripItineraryImport)
                        .id(m.id)
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, Space.md)
            .padding(.vertical, Space.md)
            .frame(maxWidth: .infinity)
        }
        .scrollPosition($scrollPos, anchor: .bottom)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        // Tapping the chat body dismisses the keyboard (fires alongside any
        // card/button tap without blocking it).
        .simultaneousGesture(TapGesture().onEnded { composerFocused = false })
        .overlay { emptyOrLoading }
        .onChange(of: currentMessages.count) { oldCount, _ in
            scrollToBottom(animated: oldCount > 0)
        }
        .onChange(of: keyboardVisible) { _, v in if v { scrollToBottom(animated: true) } }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder private var emptyOrLoading: some View {
        if isFamilyRoom && store.family == nil {
            emptyState(icon: "person.2.slash", title: "No family yet", detail: "Join or create a family to start chatting.")
        } else if currentMessages.isEmpty {
            if store.isRefreshing { ProgressView().tint(Palette.accent) }
            else if isFamilyRoom {
                emptyState(icon: "bubble.left.and.bubble.right", title: "No messages yet", detail: "Say hi to the family! 👋")
            } else {
                emptyState(icon: "airplane", title: "No messages yet", detail: "Say hi to the crew! ✈️")
            }
        }
    }

    private func handleCardTap(_ card: ChatCard) {
        if card.type == "homework" { hwRef = HWRef(id: card.id) }
        else if card.type == "event" { eventRef = EVRef(id: card.id) }
    }

    /// A Trip id is meaningful here only when the currently displayed room
    /// uses the server's exact `trip:<tripId>` scope. The suffix is kept
    /// untouched for the API path and must be nonempty.
    private var currentTripId: String? {
        guard roomId.hasPrefix("trip:") else { return nil }
        let tripId = String(roomId.dropFirst("trip:".count))
        return tripId.isEmpty ? nil : tripId
    }

    private func canImportMealPlan(_ message: ChatMessage) -> Bool {
        store.isParent && isFamilyRoom && !message.deleted
            && message.senderType == "agent"
            && message.senderId == "hermes"
            && message.card?.type == "meal-plan-draft"
    }
    private func handleMealPlanImport(_ message: ChatMessage) {
        guard canImportMealPlan(message) else { return }
        Haptics.selection()
        mealPlanRef = MealPlanRef(id: message.id, dateMode: MealPlanDateMode(messageText: message.text))
    }

    /// Trip chat responses have carried the room scope in `familyId` since
    /// the shared chat store was introduced. Current server responses also
    /// include `roomId`; accepting a missing roomId preserves old cached Trip
    /// messages while rejecting any conflicting scope.
    private func canImportTripItinerary(_ message: ChatMessage) -> Bool {
        guard let currentTripId,
              store.isParent,
              !message.deleted,
              message.familyId == roomId,
              message.roomId == nil || message.roomId == roomId,
              message.senderType == "agent",
              message.senderId == "hermes",
              message.postedByUserId == nil,
              let card = message.card else { return false }
        return !currentTripId.isEmpty
            && card.type == "trip-itinerary-draft"
            && card.id == "hermes-trip-itinerary"
            && card.title == "Itinerary ready"
    }

    private func handleTripItineraryImport(_ message: ChatMessage) {
        guard let currentTripId,
              canImportTripItinerary(message) else { return }
        Haptics.selection()
        tripItineraryRef = TripItineraryRef(tripId: currentTripId, messageId: message.id)
    }
    private func handleAddToCalendar(_ message: ChatMessage) {
        guard isFamilyRoom, !message.deleted,
              !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              message.card == nil else { return }
        newEventReq = NewEventReq(messageId: message.id,
                                  title: message.text,
                                  time: parseTime(from: message.text))
    }
    private func handleAddToShopping(_ message: ChatMessage) {
        guard isFamilyRoom, !message.deleted,
              !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              message.card == nil else { return }
        newShoppingReq = NewShoppingReq(messageId: message.id, text: message.text)
    }
    private func handlePinToNotes(_ message: ChatMessage) {
        Haptics.selection()
        Task {
            await store.addNote(body: message.text,
                                 source: "chat",
                                 ref: ["kind": "chat", "id": message.id, "context": message.text])
        }
    }
    private func scrollToBottom(animated: Bool) {
        // Defer one tick so the scroll targets the CONTENT SIZE that includes
        // the rows this update just added, then pin to the bottom edge —
        // ScrollPosition tracks the edge through any late layout growth.
        DispatchQueue.main.async {
            if animated {
                withAnimation(.easeOut(duration: 0.2)) { scrollPos.scrollTo(edge: .bottom) }
            } else {
                scrollPos.scrollTo(edge: .bottom)
            }
        }
    }

    // MARK: Composer (+ menu + wide input + circular send)

    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var canBuzz: Bool { canSend && !isSendingBuzz }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: Space.sm) {
            ChatComposerAddMenu(
                canBuzz: canBuzz,
                onGif: {
                    composerFocused = false
                    showGifPicker = true
                },
                onBuzz: requestBuzz,
                onSend: { picked in
                    try await store.sendCompressedAttachment(picked, roomId: roomId)
                }
            )

            TextField(isFamilyRoom ? "Message the family…" : "Message the trip…", text: $draft, axis: .vertical)
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
                    .frame(width: 44, height: 44)
                    .background(canSend ? Palette.accent : Palette.textSecond.opacity(0.4), in: Circle())
            }
            .disabled(!canSend)
            .accessibilityLabel("Send message")
        }
        .padding(.horizontal, Space.md).padding(.top, Space.sm).padding(.bottom, Space.sm)
        .background(Palette.panel)
        .overlay(Divider().overlay(Palette.border), alignment: .top)
    }

    private func requestBuzz() {
        guard canBuzz else { return }
        composerFocused = false
        Haptics.selection()
        buzzAlert = .confirmation
    }

    private func sendBuzz() {
        guard !isSendingBuzz else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isSendingBuzz = true
        Task {
            do {
                try await store.sendBuzz(text: text, roomId: roomId)
                // If the user edited the composer while the request was in
                // flight, keep that newer draft instead of clearing it.
                if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text {
                    draft = ""
                }
                Haptics.notify(.success)
            } catch {
                Haptics.notify(.error)
                buzzAlert = .error(error.localizedDescription)
            }
            isSendingBuzz = false
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        Haptics.selection()
        Task { await store.send(text: text, roomId: roomId) }
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

/// Convenience: no header accessory. Mirrors `SurfaceScaffold`'s
/// `Trailing == EmptyView` extension.
extension ChatScreen where HeaderAccessory == EmptyView {
    init(roomId: String = familyRoomId, title: String? = nil) {
        self.init(roomId: roomId, title: title, headerAccessory: { EmptyView() })
    }
}

// MARK: - Chat tab entry point + compact room switcher

/// Chat always opens directly into the family thread. When trip rooms exist,
/// a compact circular menu swaps rooms in place instead of adding a room-list
/// navigation layer (and the large navigation header/back button it created).
struct ChatTabHost: View {
    @Environment(AppStore.self) private var store
    @State private var selectedRoomId = familyRoomId

    var body: some View {
        ChatScreen(roomId: selectedRoomId, title: selectedRoomTitle) {
            if store.chatRooms.count > 1 {
                ChatRoomSwitcher(rooms: store.chatRooms, selection: $selectedRoomId)
            }
        }
        .onAppear {
            selectDefaultRoomIfNeeded()
            consumePendingRoom()
        }
        .onChange(of: store.chatRooms.map(\.roomId)) { _, _ in
            selectDefaultRoomIfNeeded()
            consumePendingRoom()
        }
        .onChange(of: store.pendingChatRoomId) { _, _ in consumePendingRoom() }
    }

    private var selectedRoomTitle: String? {
        guard selectedRoomId != familyRoomId else { return nil }
        return store.chatRooms.first { $0.roomId == selectedRoomId }?.title
    }

    private func consumePendingRoom() {
        guard let roomId = store.pendingChatRoomId,
              store.chatRooms.contains(where: { $0.roomId == roomId }) else { return }
        selectedRoomId = roomId
        store.pendingChatRoomId = nil
    }

    /// Family is the default whenever it exists. A trip-only guest falls back
    /// to their first available room, and a removed room returns safely home.
    private func selectDefaultRoomIfNeeded() {
        guard !store.chatRooms.contains(where: { $0.roomId == selectedRoomId }) else { return }
        selectedRoomId = store.chatRooms.first(where: { $0.roomId == familyRoomId })?.roomId
            ?? store.chatRooms.first?.roomId
            ?? familyRoomId
    }
}

/// A 36pt visual circle inside a 44pt touch target. The current room's icon
/// makes the state legible without consuming header space; the native Menu
/// scales cleanly from one trip to many and preserves familiar iOS behavior.
struct ChatRoomSwitcher: View {
    let rooms: [ChatRoom]
    @Binding var selection: String

    private var currentRoom: ChatRoom? { rooms.first { $0.roomId == selection } }
    private var currentIcon: String { selection == familyRoomId ? "person.2.fill" : "airplane" }

    var body: some View {
        Menu {
            ForEach(rooms) { room in
                Button {
                    Haptics.selection()
                    selection = room.roomId
                } label: {
                    Label(room.title,
                          systemImage: room.roomId == selection
                            ? "checkmark.circle.fill"
                            : (room.roomId == familyRoomId ? "person.2.fill" : "airplane"))
                }
            }
        } label: {
            Image(systemName: currentIcon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.accent)
                .frame(width: 36, height: 36)
                .background(Palette.accentSoft, in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .accessibilityLabel("Switch chat room")
        .accessibilityValue(currentRoom?.title ?? "Chat")
    }
}

/// Wrappers so an id can drive a `.sheet(item:)`.
struct HWRef: Identifiable { let id: String }
struct EVRef: Identifiable { let id: String }
struct NewEventReq: Identifiable {
    let id = UUID()
    let messageId: String
    let title: String
    let time: String?
}
struct NewShoppingReq: Identifiable {
    let id = UUID()
    let messageId: String
    let text: String
}
private struct MealPlanRef: Identifiable {
    let id: String
    let dateMode: MealPlanDateMode
}
struct TripItineraryRef: Identifiable {
    let tripId: String
    let messageId: String

    var id: String { "\(tripId):\(messageId)" }
}

// MARK: - Hermes meal-plan review

private enum MealPlanDateMode: Equatable {
    case weekly
    case today
    case tomorrow

    init(messageText: String) {
        self = .weekly

        for rawLine in messageText.split(whereSeparator: \.isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            let hashes = line.prefix(while: { $0 == "#" })
            guard (1...6).contains(hashes.count),
                  line.dropFirst(hashes.count).first?.isWhitespace == true else { continue }

            let heading = String(line.dropFirst(hashes.count)).trimmingCharacters(in: .whitespaces)
            let normalized = heading.lowercased()
            guard normalized.range(of: "\\bmeal\\s+plan\\b", options: .regularExpression) != nil else { continue }

            let isToday = normalized.range(of: "\\btoday(?:['’]s)?\\b", options: .regularExpression) != nil
            let isTomorrow = normalized.range(of: "\\btomorrow(?:['’]s)?\\b", options: .regularExpression) != nil
            switch (isToday, isTomorrow) {
            case (true, false):
                self = .today
                return
            case (false, true):
                self = .tomorrow
                return
            default:
                continue
            }
        }
    }
}

private struct MealPlanDayGroup: Identifiable {
    let date: String
    let items: [MealPlanPreviewItem]

    var id: String { date }
}

private struct MealPlanReviewSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let messageId: String
    let dateMode: MealPlanDateMode

    @State private var selectedStartDate: Date
    @State private var preview: MealPlanPreviewResponse?
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var replaceExisting = false
    @State private var errorMessage: String?
    @State private var successMessage: String?
    @State private var requestToken = UUID()

    private static let slotOrder = ["breakfast", "lunch", "dinner"]

    init(messageId: String, dateMode: MealPlanDateMode) {
        self.messageId = messageId
        self.dateMode = dateMode
        _selectedStartDate = State(initialValue: Self.initialDate(for: dateMode))
    }

    private var startDate: String { Self.ymd(for: selectedStartDate, calendar: .autoupdatingCurrent) }
    private var blockedKeys: Set<String> {
        Set(preview?.blocked.map { $0.key } ?? [])
    }
    private var conflictKeys: Set<String> {
        Set(preview?.conflicts.map { $0.key } ?? [])
    }
    private var safeImportCount: Int {
        (preview?.items ?? []).filter { !blockedKeys.contains($0.key) }.count
    }
    private var dayGroups: [MealPlanDayGroup] {
        let groups = Dictionary(grouping: preview?.items ?? [], by: { $0.date })
        return groups.keys.sorted().map { date in
            let items = (groups[date] ?? []).sorted { lhs, rhs in
                let left = Self.slotOrder.firstIndex(of: lhs.slot) ?? Self.slotOrder.count
                let right = Self.slotOrder.firstIndex(of: rhs.slot) ?? Self.slotOrder.count
                return left == right ? lhs.slot < rhs.slot : left < right
            }
            return MealPlanDayGroup(date: date, items: items)
        }
    }
    private var isAlreadyImported: Bool {
        successMessage != nil || preview?.imported == true
    }
    private var canConfirm: Bool {
        guard let preview else { return false }
        return !isAlreadyImported
            && !isLoading
            && !isSaving
            && successMessage == nil
            && safeImportCount > 0
            && (preview.conflicts.isEmpty || replaceExisting)
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { selectedStartDate },
            set: { selectedStartDate = dateMode == .weekly ? Self.monday(on: $0) : $0 }
        )
    }

    private var datePickerLabel: String {
        dateMode == .weekly ? "Week starting Monday" : "Meal date"
    }

    private var datePickerFooter: String {
        dateMode == .weekly
            ? "Choose the Monday for this meal plan. Changing it refreshes the preview."
            : "Choose a meal date. Changing it refreshes the preview."
    }

    private var dateAccessibilityLabel: String {
        dateMode == .weekly ? "Week starts \(startDate)" : "Meal date \(startDate)"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker(datePickerLabel, selection: dateBinding, displayedComponents: .date)
                        .disabled(isLoading || isSaving || isAlreadyImported)
                        .accessibilityLabel(datePickerLabel)
                    Text(startDate)
                        .font(Typography.monoSmall)
                        .foregroundStyle(Palette.textSecond)
                        .accessibilityLabel(dateAccessibilityLabel)
                } footer: {
                    Text(datePickerFooter)
                }

                if isLoading {
                    Section {
                        HStack(spacing: Space.sm) {
                            ProgressView().tint(Palette.accent)
                            Text("Loading meal-plan preview…")
                                .font(Typography.body)
                                .foregroundStyle(Palette.textSecond)
                        }
                        .frame(minHeight: 44, alignment: .leading)
                    }
                }

                if let errorMessage {
                    Section {
                        Label {
                            Text(errorMessage)
                                .font(Typography.body)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                        }
                        .foregroundStyle(Palette.coral)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Meal-plan error: \(errorMessage)")
                    }
                }

                if let successMessage {
                    Section {
                        Label {
                            Text(successMessage)
                                .font(Typography.body)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "checkmark.circle.fill")
                        }
                        .foregroundStyle(Palette.green)
                        Button("Done") { dismiss() }
                            .frame(minHeight: 44, alignment: .leading)
                            .accessibilityHint("Closes the meal-plan review")
                    }
                } else if preview?.imported == true {
                    Section {
                        Label {
                            Text("This meal plan is already in Meals.")
                                .font(Typography.body)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "checkmark.circle.fill")
                        }
                        .foregroundStyle(Palette.green)
                        Button("Done") { dismiss() }
                            .frame(minHeight: 44, alignment: .leading)
                            .accessibilityHint("Closes the meal-plan review")
                    }
                }

                if let preview, !isLoading {
                    previewSections(preview)
                }
            }
            .navigationTitle("Review meal plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isAlreadyImported ? "Done" : "Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Adding…" : "Add safe meals") { importMealPlan() }
                        .fontWeight(.bold)
                        .disabled(!canConfirm)
                }
            }
        }
        .task { requestPreview() }
        .onChange(of: selectedStartDate) { _, _ in requestPreview() }
    }

    @ViewBuilder
    private func previewSections(_ preview: MealPlanPreviewResponse) -> some View {
        if preview.imported {
            Section("Meals already in Meals") {
                Text("This draft has already been added. No new meals will be written.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            Section("Preview") {
                Text(safeImportCount == 1
                     ? "1 safe meal can be added."
                     : "\(safeImportCount) safe meals can be added.")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(safeImportCount > 0 ? Palette.text : Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)

                if preview.items.isEmpty {
                    Text("No meals were parsed for this week.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(dayGroups) { group in
                        VStack(alignment: .leading, spacing: Space.sm) {
                            Text(Self.dateHeading(group.date))
                                .font(Typography.cardTitle)
                                .foregroundStyle(Palette.text)
                                .accessibilityAddTraits(.isHeader)
                            ForEach(group.items) { item in
                                mealRow(item)
                                if item.id != group.items.last?.id {
                                    Divider().overlay(Palette.border)
                                }
                            }
                        }
                        .padding(.vertical, Space.xs)
                    }
                }
            }

            if !preview.blocked.isEmpty {
                Section("Blocked (\(preview.blocked.count))") {
                    ForEach(preview.blocked) { item in
                        VStack(alignment: .leading, spacing: Space.xs) {
                            Text("\(Self.dateHeading(item.date)) · \(Self.slotLabel(item.slot))")
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Palette.textSecond)
                            Text(item.title)
                                .font(Typography.body.weight(.semibold))
                                .foregroundStyle(Palette.text)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(item.reason)
                                .font(Typography.caption)
                                .foregroundStyle(Palette.coral)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Blocked \(item.title), \(item.reason)")
                    }
                }
            }

            if !preview.conflicts.isEmpty {
                Section("Conflicts (\(preview.conflicts.count))") {
                    ForEach(preview.conflicts) { conflict in
                        VStack(alignment: .leading, spacing: Space.xs) {
                            Text("\(Self.dateHeading(conflict.date)) · \(Self.slotLabel(conflict.slot))")
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Palette.textSecond)
                            Text(conflict.title)
                                .font(Typography.body.weight(.semibold))
                                .foregroundStyle(Palette.text)
                                .fixedSize(horizontal: false, vertical: true)
                            Text("Existing: \(conflict.existingTitle)")
                                .font(Typography.caption)
                                .foregroundStyle(Palette.warn)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Conflict for \(conflict.title). Existing meal: \(conflict.existingTitle)")
                    }
                    Toggle("Replace meals already in these slots", isOn: $replaceExisting)
                        .disabled(isLoading || isSaving)
                        .frame(minHeight: 44, alignment: .leading)
                }
            }
        }
    }

    private func mealRow(_ item: MealPlanPreviewItem) -> some View {
        let isBlocked = blockedKeys.contains(item.key)
        let isConflict = conflictKeys.contains(item.key)
        return HStack(alignment: .top, spacing: Space.sm) {
            Text(Self.slotLabel(item.slot))
                .font(Typography.caption.weight(.semibold))
                .foregroundStyle(Palette.accent)
                .frame(width: 72, alignment: .leading)
            Text(item.title)
                .font(Typography.body)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Space.xs)
            if isBlocked {
                Image(systemName: "nosign")
                    .foregroundStyle(Palette.coral)
                    .accessibilityHidden(true)
            } else if isConflict {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(Palette.warn)
                    .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(Self.slotLabel(item.slot)): \(item.title)\(isBlocked ? ", blocked" : isConflict ? ", conflicts with an existing meal" : "")")
    }

    private func requestPreview() {
        let token = UUID()
        requestToken = token
        isLoading = true
        preview = nil
        errorMessage = nil
        successMessage = nil
        replaceExisting = false
        let startDate = self.startDate
        let appStore = store

        Task { @MainActor in
            do {
                let response = try await appStore.previewHermesMealPlan(messageId: messageId, startDate: startDate)
                guard !Task.isCancelled, requestToken == token else { return }
                preview = response
                isLoading = false
            } catch {
                guard !Task.isCancelled, requestToken == token else { return }
                errorMessage = error.localizedDescription
                isLoading = false
            }
        }
    }

    private func importMealPlan() {
        guard canConfirm else { return }
        isSaving = true
        errorMessage = nil
        let startDate = self.startDate
        let appStore = store
        let replaceExisting = self.replaceExisting

        Task { @MainActor in
            do {
                let response = try await appStore.importHermesMealPlan(messageId: messageId,
                                                                        startDate: startDate,
                                                                        replaceExisting: replaceExisting)
                guard !Task.isCancelled else {
                    isSaving = false
                    return
                }
                let count = response.importedEntries.count
                if response.existing {
                    successMessage = count == 1
                        ? "This meal plan was already in Meals (1 meal)."
                        : "This meal plan was already in Meals (\(count) meals)."
                } else {
                    successMessage = count == 1
                        ? "Added 1 meal to Meals."
                        : "Added \(count) meals to Meals."
                }
                if !response.blocked.isEmpty {
                    successMessage? += " \(response.blocked.count) item\(response.blocked.count == 1 ? " was" : "s were") blocked by the server."
                }
                isSaving = false
            } catch {
                if Task.isCancelled {
                    isSaving = false
                    return
                }
                errorMessage = error.localizedDescription
                isSaving = false
            }
        }
    }

    private static func initialDate(for mode: MealPlanDateMode,
                                    calendar: Calendar = .autoupdatingCurrent,
                                    now: Date = Date()) -> Date {
        let today = calendar.startOfDay(for: now)
        switch mode {
        case .today:
            return today
        case .tomorrow:
            return calendar.date(byAdding: .day, value: 1, to: today) ?? today
        case .weekly:
            return nextMonday(calendar: calendar, now: now)
        }
    }

    private static func nextMonday(calendar: Calendar = .autoupdatingCurrent, now: Date = Date()) -> Date {
        let today = calendar.startOfDay(for: now)
        let weekday = calendar.component(.weekday, from: today)
        let daysUntilMonday = (2 - weekday + 7) % 7
        let offset = daysUntilMonday == 0 ? 7 : daysUntilMonday
        return calendar.date(byAdding: .day, value: offset, to: today) ?? today
    }

    private static func monday(on date: Date, calendar: Calendar = .autoupdatingCurrent) -> Date {
        let day = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: day)
        let daysSinceMonday = (weekday + 5) % 7
        return calendar.date(byAdding: .day, value: -daysSinceMonday, to: day) ?? day
    }

    private static func ymd(for date: Date, calendar: Calendar = .autoupdatingCurrent) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: calendar.startOfDay(for: date))
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }

    private static func dateHeading(_ value: String) -> String {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return value }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        let calendar = Calendar.current
        guard let date = calendar.date(from: components) else { return value }
        let weekday = calendar.component(.weekday, from: date)
        let name = calendar.weekdaySymbols.indices.contains(weekday - 1)
            ? calendar.weekdaySymbols[weekday - 1]
            : "Date"
        return "\(name) · \(value)"
    }

    private static func slotLabel(_ value: String) -> String {
        value.isEmpty ? "Meal" : value.capitalized
    }
}

// MARK: - Hermes Trip itinerary review

private struct TripItineraryReviewEntry: Identifiable {
    let item: TripItineraryImportItem
    let duplicate: TripItineraryDuplicate?
    let sourceOrder: Int

    var id: String { "\(item.key)-\(sourceOrder)" }
}

private struct TripItineraryDayGroup: Identifiable {
    let date: String
    let entries: [TripItineraryReviewEntry]

    var id: String { date }
}

private struct TripItineraryReviewSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let tripId: String
    let messageId: String

    @State private var preview: TripItineraryPreviewResponse?
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var successMessage: String?
    @State private var requestToken = UUID()

    private var sheetID: String { "\(tripId):\(messageId)" }
    private var duplicateKeys: Set<String> {
        Set(preview?.duplicates.map { $0.key } ?? [])
    }
    private var safeImportCount: Int {
        (preview?.items ?? []).filter { !duplicateKeys.contains($0.key) }.count
    }
    private var isComplete: Bool {
        successMessage != nil || preview?.imported == true
    }
    private var canConfirm: Bool {
        guard let preview else { return false }
        return !isLoading
            && !isSaving
            && !preview.imported
            && successMessage == nil
            && safeImportCount > 0
    }

    private var dayGroups: [TripItineraryDayGroup] {
        guard let preview else { return [] }

        var duplicateByKey: [String: TripItineraryDuplicate] = [:]
        for duplicate in preview.duplicates {
            duplicateByKey[duplicate.key] = duplicate
        }

        var entries: [TripItineraryReviewEntry] = []
        var knownKeys = Set<String>()
        for (sourceOrder, item) in preview.items.enumerated() {
            entries.append(TripItineraryReviewEntry(item: item,
                                                    duplicate: duplicateByKey[item.key],
                                                    sourceOrder: sourceOrder))
            knownKeys.insert(item.key)
        }

        // A defensive fallback keeps every duplicate explainable if a server
        // response ever lists one that is absent from `items`.
        var sourceOrder = entries.count
        for duplicate in preview.duplicates where !knownKeys.contains(duplicate.key) {
            let item = TripItineraryImportItem(key: duplicate.key,
                                               date: duplicate.date,
                                               time: duplicate.time,
                                               title: duplicate.title,
                                               category: duplicate.category,
                                               note: duplicate.note)
            entries.append(TripItineraryReviewEntry(item: item,
                                                    duplicate: duplicate,
                                                    sourceOrder: sourceOrder))
            knownKeys.insert(duplicate.key)
            sourceOrder += 1
        }

        let grouped = Dictionary(grouping: entries, by: { $0.item.date })
        return grouped.keys.sorted().map { date in
            let sorted = Self.sortEntries(grouped[date] ?? [])
            return TripItineraryDayGroup(
                date: date,
                entries: sorted
            )
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if isLoading {
                    Section {
                        HStack(spacing: Space.sm) {
                            ProgressView()
                            Text("Loading itinerary preview…")
                                .font(Typography.body)
                                .foregroundStyle(Palette.textSecond)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Loading itinerary preview")
                    }
                }

                if let errorMessage {
                    Section("Could not complete request") {
                        VStack(alignment: .leading, spacing: Space.sm) {
                            Label {
                                Text(errorMessage)
                                    .font(Typography.body)
                                    .fixedSize(horizontal: false, vertical: true)
                            } icon: {
                                Image(systemName: "exclamationmark.triangle.fill")
                            }
                            .foregroundStyle(Palette.coral)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("Itinerary error: \(errorMessage)")

                            if preview == nil && !isLoading {
                                Button("Retry preview") { requestPreview() }
                                    .frame(minHeight: 44, alignment: .leading)
                                    .accessibilityHint("Requests the itinerary preview again")
                            } else if !isSaving && !isComplete {
                                Text("You can try adding the itinerary again.")
                                    .font(Typography.caption)
                                    .foregroundStyle(Palette.textSecond)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                if let preview, !isLoading {
                    Section("Preview") {
                        if preview.imported {
                            Text("This itinerary was already added to this Trip. No new activities will be written.")
                                .font(Typography.body)
                                .foregroundStyle(Palette.textSecond)
                                .fixedSize(horizontal: false, vertical: true)
                        } else if safeImportCount == 0 {
                            Text("No new activities can be added. The proposed activities are already on the itinerary.")
                                .font(Typography.body)
                                .foregroundStyle(Palette.textSecond)
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            Text(safeImportCount == 1
                                 ? "1 new activity can be added to this Trip."
                                 : "\(safeImportCount) new activities can be added to this Trip.")
                                .font(Typography.body.weight(.semibold))
                                .foregroundStyle(Palette.text)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    if dayGroups.isEmpty {
                        Section {
                            Text("No activities were found in this itinerary draft.")
                                .font(Typography.body)
                                .foregroundStyle(Palette.textSecond)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    } else {
                        ForEach(dayGroups) { group in
                            Section {
                                ForEach(group.entries) { entry in
                                    itineraryRow(entry)
                                }
                            } header: {
                                Text(Self.dateHeading(group.date))
                                    .font(Typography.cardTitle)
                                    .foregroundStyle(Palette.text)
                                    .accessibilityAddTraits(.isHeader)
                            }
                        }
                    }
                }

                if let successMessage {
                    Section("Import complete") {
                        Label {
                            Text(successMessage)
                                .font(Typography.body)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "checkmark.circle.fill")
                        }
                        .foregroundStyle(Palette.green)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Itinerary import complete: \(successMessage)")
                        Button("Done") { dismiss() }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .accessibilityHint("Acknowledges the result and closes the itinerary review")
                    }
                } else if preview?.imported == true {
                    Section("Already imported") {
                        Label {
                            Text("This itinerary is already on the Trip itinerary.")
                                .font(Typography.body)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "checkmark.circle.fill")
                        }
                        .foregroundStyle(Palette.green)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("This itinerary is already on the Trip itinerary")
                        Button("Done") { dismiss() }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .accessibilityHint("Acknowledges the result and closes the itinerary review")
                    }
                }
            }
            .navigationTitle("Review itinerary")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isComplete ? "Done" : "Cancel") { dismiss() }
                        .frame(minHeight: 44)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Adding…" : "Add to Itinerary") { importItinerary() }
                        .fontWeight(.bold)
                        .disabled(!canConfirm)
                        .accessibilityHint("Adds only activities that are not already on the Trip itinerary")
                }
            }
        }
        .task(id: sheetID) { requestPreview() }
    }

    private func itineraryRow(_ entry: TripItineraryReviewEntry) -> some View {
        let item = entry.item
        let category = item.category.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = item.note.trimmingCharacters(in: .whitespacesAndNewlines)
        return VStack(alignment: .leading, spacing: Space.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                Text(Self.displayTime(item.time))
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.accent)
                    .frame(minWidth: 68, alignment: .leading)
                Text(item.title)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !category.isEmpty {
                Text("Category: \(category.capitalized)")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !note.isEmpty {
                Text("Note: \(note)")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let duplicate = entry.duplicate {
                Divider().overlay(Palette.border)
                Label("Already on itinerary", systemImage: "checkmark.circle")
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.textSecond)
                Text("Existing: \(duplicate.existingTitle)")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Self.accessibilityLabel(for: entry))
    }

    private func requestPreview() {
        let token = UUID()
        requestToken = token
        preview = nil
        isLoading = true
        isSaving = false
        errorMessage = nil
        successMessage = nil
        let tripId = self.tripId
        let messageId = self.messageId
        let appStore = store

        Task { @MainActor in
            do {
                let response = try await appStore.previewHermesTripItinerary(tripId: tripId,
                                                                              messageId: messageId)
                guard requestToken == token, !Task.isCancelled else { return }
                preview = response
                isLoading = false
            } catch {
                guard requestToken == token, !Task.isCancelled else { return }
                errorMessage = error.localizedDescription
                isLoading = false
            }
        }
    }

    private func importItinerary() {
        guard canConfirm else { return }
        let token = UUID()
        requestToken = token
        isSaving = true
        errorMessage = nil
        let tripId = self.tripId
        let messageId = self.messageId
        let appStore = store

        Task { @MainActor in
            do {
                let response = try await appStore.importHermesTripItinerary(tripId: tripId,
                                                                             messageId: messageId)
                guard requestToken == token else { return }
                isSaving = false
                guard !Task.isCancelled else { return }
                successMessage = Self.successText(for: response)
            } catch {
                guard requestToken == token else { return }
                isSaving = false
                guard !Task.isCancelled else { return }
                errorMessage = error.localizedDescription
            }
        }
    }

    private static func successText(for response: TripItineraryImportResponse) -> String {
        let importedCount = response.importedItems.count
        let duplicateCount = response.skippedDuplicates.count

        if response.existing {
            return "This itinerary was already added to this Trip's itinerary."
        }
        if importedCount > 0 {
            var text = importedCount == 1
                ? "Added 1 new activity to this Trip's itinerary."
                : "Added \(importedCount) new activities to this Trip's itinerary."
            if duplicateCount > 0 {
                text += duplicateCount == 1
                    ? " 1 duplicate was skipped."
                    : " \(duplicateCount) duplicates were skipped."
            }
            return text
        }
        if duplicateCount > 0 {
            return duplicateCount == 1
                ? "No new activities were added. The activity was already on the itinerary."
                : "No new activities were added. All \(duplicateCount) activities were already on the itinerary."
        }
        return "The itinerary import completed, but no new activities were added."
    }

    private static func sortEntries(_ entries: [TripItineraryReviewEntry]) -> [TripItineraryReviewEntry] {
        entries.sorted { lhs, rhs in
            let left = normalizedTime(lhs.item.time)
            let right = normalizedTime(rhs.item.time)
            if let left, let right, left != right { return left < right }
            if left != nil && right == nil { return true }
            if left == nil && right != nil { return false }
            return lhs.sourceOrder < rhs.sourceOrder
        }
    }

    /// Normalizes common server/parser time forms to a sortable HH:MM key.
    /// Empty or malformed values intentionally sort after timed activities.
    private static func normalizedTime(_ value: String) -> String? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty,
              let regex = try? NSRegularExpression(pattern: #"(?i)^\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\s*$"#),
              let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) else {
            return nil
        }

        let nsText = text as NSString
        let hour = Int(nsText.substring(with: match.range(at: 1))) ?? -1
        let minuteRange = match.range(at: 2)
        let meridiemRange = match.range(at: 3)
        let hasMinute = minuteRange.location != NSNotFound
        let hasMeridiem = meridiemRange.location != NSNotFound
        var normalizedHour = hour
        let minute = hasMinute ? (Int(nsText.substring(with: minuteRange)) ?? -1) : 0

        if hasMeridiem {
            guard hour >= 1, hour <= 12, minute >= 0, minute <= 59 else { return nil }
            let meridiem = nsText.substring(with: meridiemRange).lowercased()
            if meridiem == "am" {
                if normalizedHour == 12 { normalizedHour = 0 }
            } else if normalizedHour != 12 {
                normalizedHour += 12
            }
        } else {
            guard hasMinute, hour >= 0, hour <= 23, minute >= 0, minute <= 59 else { return nil }
        }
        return String(format: "%02d:%02d", normalizedHour, minute)
    }

    private static func displayTime(_ value: String) -> String {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalizedTime(text) ?? (text.isEmpty ? "Any time" : text)
    }

    private static func dateHeading(_ value: String) -> String {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return value }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        let calendar = Calendar.current
        guard let date = calendar.date(from: components) else { return value }
        let weekday = calendar.component(.weekday, from: date)
        let name = calendar.weekdaySymbols.indices.contains(weekday - 1)
            ? calendar.weekdaySymbols[weekday - 1]
            : "Date"
        return "\(name) · \(value)"
    }

    private static func accessibilityLabel(for entry: TripItineraryReviewEntry) -> String {
        let item = entry.item
        var label = "\(displayTime(item.time)), \(item.title)"
        let category = item.category.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = item.note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !category.isEmpty { label += ". Category: \(category)" }
        if !note.isEmpty { label += ". Note: \(note)" }
        if let duplicate = entry.duplicate {
            label += ". Already on itinerary. Existing activity: \(duplicate.existingTitle)"
        }
        return label
    }
}

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

/// Chat-specific source-aware shopping confirmation. Text/category/assignee
/// stay editable here; the server derives the family and sender from the
/// authenticated request and validates the immutable message source.
private struct ChatAddShoppingSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let messageId: String
    let initialText: String

    @State private var text = ""
    @State private var category = "other"
    @State private var assigneeId: String?
    @State private var saving = false
    @State private var alertMessage = ""
    @State private var alertTitle = "Shopping"
    @State private var showAlert = false
    @State private var dismissAfterAlert = false

    private let categories = ["produce", "protein", "dairy", "grain", "pantry", "frozen", "spice", "other"]

    private var assigneeMembers: [ShoppingAssigneeOption] {
        guard store.isParent else { return [] }
        let parents = (store.family?.parents ?? store.family?.parentIds.map { Parent(id: $0, name: nil) } ?? [])
            .map { ShoppingAssigneeOption(id: $0.id, name: $0.name ?? "Parent") }
        let kids = (store.family?.kids ?? []).map { ShoppingAssigneeOption(id: $0.id, name: $0.name) }
        var seen = Set<String>()
        return (parents + kids).filter { seen.insert($0.id).inserted }
    }

    private var canSave: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !saving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Item", text: $text, axis: .vertical)
                        .lineLimit(1...3)
                    Picker("Category", selection: $category) {
                        ForEach(categories, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                if store.isParent {
                    Section("Assign") {
                        Picker("For", selection: $assigneeId) {
                            Text("No one").tag(String?.none)
                            ForEach(assigneeMembers) { member in
                                Text(member.name).tag(Optional(member.id))
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }
            }
            .navigationTitle("Add to Shopping")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { save() }.fontWeight(.bold).disabled(!canSave)
                }
            }
        }
        .onAppear { text = initialText }
        .alert(alertTitle, isPresented: $showAlert) {
            Button("Done") {
                if dismissAfterAlert { dismiss() }
            }
        } message: {
            Text(alertMessage)
        }
    }

    private func save() {
        saving = true
        Haptics.selection()
        let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                let result = try await APIClient.shared.addShoppingItemResult(
                    text: cleanText,
                    category: category,
                    assigneeUserId: store.isParent ? assigneeId : nil,
                    sourceMessageId: messageId
                )
                await store.loadMeals()
                alertTitle = "Shopping"
                alertMessage = result.existing == true
                    ? "This message was already added to the shopping list."
                    : "Item added to the family shopping list."
                dismissAfterAlert = true
                showAlert = true
            } catch {
                alertTitle = "Could not add item"
                alertMessage = error.localizedDescription
                dismissAfterAlert = false
                showAlert = true
            }
            saving = false
        }
    }
}

private struct ShoppingAssigneeOption: Identifiable {
    let id: String
    let name: String
}

/// Chat-specific source-aware event confirmation. The regular AddEventSheet
/// remains the canonical full calendar editor; this smaller sheet keeps the
/// chat conversion explicit, editable, family-scoped, and able to submit the
/// source reference directly through APIClient without broadening AppStore's
/// manual-event surface.
private struct ChatAddEventSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let messageId: String
    let initialTitle: String
    let initialTime: String?

    @State private var title = ""
    @State private var date = Date()
    @State private var hasTime = false
    @State private var time = Date()
    @State private var notes = ""
    @State private var category = "other"
    @State private var kidId: String? = nil
    @State private var saving = false
    @State private var alertMessage = ""
    @State private var alertTitle = "Calendar"
    @State private var showAlert = false
    @State private var dismissAfterAlert = false

    private let categories = ["school", "sports", "arts", "social", "other"]

    private var audienceKids: [Kid] {
        store.isParent ? store.kids : store.kids.filter { $0.id == store.me?.kidId }
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !saving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Toggle("Set a time", isOn: $hasTime.animation())
                    if hasTime {
                        DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute)
                    }
                }
                Section("For") {
                    Picker("For", selection: $kidId) {
                        Text("Whole family").tag(String?.none)
                        ForEach(audienceKids) { kid in
                            Text(kid.name).tag(Optional(kid.id))
                        }
                    }
                    .pickerStyle(.menu)
                }
                Section("Category") {
                    Picker("Category", selection: $category) {
                        ForEach(categories, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                Section("Notes") {
                    TextField("Optional notes", text: $notes, axis: .vertical).lineLimit(2...5)
                }
            }
            .navigationTitle("Add to Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { save() }.fontWeight(.bold).disabled(!canSave)
                }
            }
        }
        .onAppear {
            title = initialTitle
            if let initialTime, let parsed = EventFmt.hm.date(from: initialTime) {
                let components = Calendar.current.dateComponents([.hour, .minute], from: parsed)
                if let combined = Calendar.current.date(bySettingHour: components.hour ?? 0,
                                                        minute: components.minute ?? 0,
                                                        second: 0,
                                                        of: Date()) {
                    hasTime = true
                    time = combined
                }
            }
        }
        .alert(alertTitle, isPresented: $showAlert) {
            Button("Done") {
                if dismissAfterAlert { dismiss() }
            }
        } message: {
            Text(alertMessage)
        }
    }

    private func save() {
        saving = true
        Haptics.selection()
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let eventDate = EventFmt.ymd.string(from: date)
        let eventTime = hasTime ? EventFmt.hm.string(from: time) : nil

        Task {
            do {
                let result = try await APIClient.shared.addFamilyEventResult(
                    title: cleanTitle,
                    date: eventDate,
                    time: eventTime,
                    notes: cleanNotes.isEmpty ? nil : cleanNotes,
                    category: category,
                    kidId: kidId,
                    sourceType: "chat",
                    sourceId: messageId
                )
                if let refreshed = try? await APIClient.shared.familyEvents() {
                    store.familyEvents = refreshed
                    await NotificationScheduler.reschedule(events: refreshed,
                                                           homework: store.homework,
                                                           kids: store.family?.kids ?? [])
                }
                alertTitle = "Calendar"
                alertMessage = result.existing == true
                    ? "This message was already added to the family calendar."
                    : "Event added to the family calendar."
                dismissAfterAlert = true
                showAlert = true
            } catch {
                alertTitle = "Could not add event"
                alertMessage = error.localizedDescription
                dismissAfterAlert = false
                showAlert = true
            }
            saving = false
        }
    }
}

// MARK: - One message row (fun bubbles + avatar, or a system card)

struct ChatMessageRow: View {
    let message: ChatMessage
    let isMine: Bool
    let senderName: String
    var onTapCard: (ChatCard) -> Void
    var canAddToCalendar: Bool = true
    var onAddToCalendar: (ChatMessage) -> Void = { _ in }
    var canAddToShopping: Bool = false
    var onAddToShopping: (ChatMessage) -> Void = { _ in }
    var onPinToNotes: (ChatMessage) -> Void = { _ in }
    var canImportMealPlan: Bool = false
    var onImportMealPlan: (ChatMessage) -> Void = { _ in }
    var canImportTripItinerary: Bool = false
    var onImportTripItinerary: (ChatMessage) -> Void = { _ in }

    private var senderColor: Color {
        famChatSenderColor(id: message.senderId, name: senderName, isMine: isMine)
    }

    var body: some View {
        if message.isBuzz {
            // Buzz remains a normal text bubble even if a malformed or legacy
            // payload happens to carry another presentation field.
            bubbleRow
        } else if message.card?.type == "meal-plan-draft" || message.card?.type == "trip-itinerary-draft" {
            bubbleRow
        } else if message.card != nil {
            SystemCardRow(message: message, senderName: senderName, onTapCard: onTapCard)
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
                if canImportMealPlan {
                    mealPlanAction
                } else if canImportTripItinerary {
                    tripItineraryAction
                }
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

    private var mealPlanAction: some View {
        Button {
            onImportMealPlan(message)
        } label: {
            HStack(alignment: .center, spacing: Space.sm) {
                Image(systemName: "fork.knife")
                Text("Review & add to Meals")
                    .font(Typography.body.weight(.semibold))
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .foregroundStyle(Palette.accent)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, Space.md)
            .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                    .strokeBorder(Palette.accent.opacity(0.35), lineWidth: 1)
            )
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Review and add meal plan to Meals")
        .accessibilityHint("Opens a preview before adding meals")
    }

    private var tripItineraryAction: some View {
        Button {
            onImportTripItinerary(message)
        } label: {
            HStack(alignment: .center, spacing: Space.sm) {
                Image(systemName: "airplane")
                Text("Review & add to Itinerary")
                    .font(Typography.body.weight(.semibold))
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .foregroundStyle(Palette.accent)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, Space.md)
            .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                    .strokeBorder(Palette.accent.opacity(0.35), lineWidth: 1)
            )
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Review and add to Itinerary")
        .accessibilityHint("Opens a preview before adding new activities to this Trip")
    }

    @ViewBuilder private var bubble: some View {
        if message.deleted {
            Text("Message deleted")
                .font(Typography.body.italic()).foregroundStyle(Palette.textSecond)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(bubbleShape.fill(AnyShapeStyle(Palette.panel)))
                .overlay(bubbleShape.strokeBorder(Palette.border, lineWidth: 1))
        } else if message.isBuzz {
            VStack(alignment: isMine ? .trailing : .leading, spacing: 5) {
                Label("BUZZ", systemImage: "wave.3.right")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(senderColor)
                Text(ChatLinkText.attributed(message.text))
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(senderColor)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 16).padding(.vertical, 11)
            .background(bubbleShape.fill(AnyShapeStyle(Palette.panel2)))
            .overlay(bubbleShape.strokeBorder(senderColor.opacity(0.55), lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("BUZZ message from \(senderName): \(message.text)")
            .accessibilityHint("Time Sensitive alert")
            .contextMenu { shareMessageAction }
        } else if let media = message.media, media.isChatAttachment {
            ChatAttachmentBubble(media: media)
                .contextMenu {
                    if !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        shareMessageAction
                    }
                }
        } else if let media = message.media, media.type == "gif",
                  let url = URL(string: media.url ?? media.previewUrl ?? "") {
            AnimatedGIFView(url: url)
                .frame(maxWidth: 240, maxHeight: 240)
                .background(Palette.panel)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .contextMenu {
                    if !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        shareMessageAction
                    }
                    // A GIF with accompanying text is still an eligible
                    // family message; media-only messages have no text and
                    // therefore receive no conversion action.
                    if canAddToShopping && !message.deleted && !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            onAddToShopping(message)
                        } label: {
                            Label("Add to Shopping", systemImage: "cart.badge.plus")
                        }
                    }
                    if canAddToCalendar && !message.deleted && !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            onAddToCalendar(message)
                        } label: {
                            Label("Add to Calendar", systemImage: "calendar.badge.plus")
                        }
                    }
                }
        } else {
            // Each sender keeps a readable identity color in both the sender
            // label and message text; alignment and names remain the secondary
            // identity cues so color is never the only signal.
            Text(ChatLinkText.attributed(message.text))
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(senderColor)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(bubbleShape.fill(AnyShapeStyle(Palette.panel2)))
                .overlay(bubbleShape.strokeBorder(senderColor.opacity(0.55), lineWidth: 1))
                .contextMenu {
                    shareMessageAction
                    if canImportMealPlan {
                        Button {
                            onImportMealPlan(message)
                        } label: {
                            Label("Review & add to Meals", systemImage: "fork.knife")
                        }
                    }
                    if canImportTripItinerary {
                        Button {
                            onImportTripItinerary(message)
                        } label: {
                            Label("Review & add to Itinerary", systemImage: "airplane")
                        }
                    }
                    if canAddToShopping && !message.deleted && message.card == nil && !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            onAddToShopping(message)
                        } label: {
                            Label("Add to Shopping", systemImage: "cart.badge.plus")
                        }
                    }
                    if canAddToCalendar && !message.deleted && message.card == nil && !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            onAddToCalendar(message)
                        } label: {
                            Label("Add to Calendar", systemImage: "calendar.badge.plus")
                        }
                    }
                    Button {
                        onPinToNotes(message)
                    } label: {
                        Label("Pin to Notes", systemImage: "pin")
                    }
                }
        }
    }

    @ViewBuilder
    private var shareMessageAction: some View {
        if !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ShareLink(item: message.text) {
                Label("Share Message", systemImage: "square.and.arrow.up")
            }
        }
    }
}

enum ChatLinkText {
    private static let detector = try? NSDataDetector(
        types: NSTextCheckingResult.CheckingType.link.rawValue
    )

    static func attributed(_ text: String) -> AttributedString {
        var output = AttributedString(text)
        guard let detector else { return output }

        let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
        for match in detector.matches(in: text, range: fullRange) {
            guard let url = match.url,
                  let scheme = url.scheme?.lowercased(),
                  ["http", "https", "mailto"].contains(scheme),
                  let sourceRange = Range(match.range, in: text),
                  let lower = AttributedString.Index(sourceRange.lowerBound, within: output),
                  let upper = AttributedString.Index(sourceRange.upperBound, within: output)
            else { continue }

            output[lower..<upper].link = url
            output[lower..<upper].underlineStyle = .single
        }
        return output
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
