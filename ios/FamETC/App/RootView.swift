import SwiftUI

// MARK: - Size-class branching strategy
//
// Fam ETC leans on Chat being "always nearby" the way a family group chat is,
// so the layout isn't a plain 1:1 port of RetireOdds's iPhone-only tab bar:
//
//   iPhone (any orientation)          → FloatingTabBar (5 compact entries),
//                                        same pill / matchedGeometryEffect /
//                                        glass-material pattern as RetireOdds.
//                                        Planning switches between Trips and
//                                        Meals through its context menu.
//
//   iPad landscape, PARENT session    → compact nav rail (Today/Calendar/
//                                        Homework/Trips/Meals — no Chat entry) +
//                                        main content + a DOCKED chat column on
//                                        the trailing edge (canvas-1f) — so chat
//                                        is always visible while browsing. The
//                                        docked column defaults to the family
//                                        room, with a Menu room-switcher once
//                                        Trips adds more rooms.
//
//   iPad portrait, OR any kid         → compact nav rail (Today/Calendar/
//   session (any orientation)           Homework/Chat/Trips/Meals) + full-width
//                                        main content; tapping the Chat rail
//                                        item opens the Chat surface as a
//                                        slide-over sheet instead of docking a
//                                        column (canvas-1g) — there isn't width
//                                        to spare for a permanent 3rd column at
//                                        kid-friendly scale or in portrait.
//
// iPad size classes are regular×regular in BOTH orientations, so orientation is
// read from actual geometry (`onGeometryChange`), not size classes.
//
// Chat's own tab content is `ChatTabHost`: family chat opens immediately and,
// once the signed-in user is on a trip, a compact header control switches rooms
// without adding another navigation layer (docs/TRIPS-PLAN.md "iOS" §2).
//
// Settings/Goals/Activities are NOT native tabs — they're reached from a "More"
// entry inside Today, hosted by `HybridWebView`. That "More" sheet/menu is out
// of scope for this scaffold; only the compact five-entry native surface is
// wired here.
enum PlanningDestination: String, CaseIterable, Identifiable {
    case trips, meals

    var id: String { rawValue }

    var label: String {
        switch self {
        case .trips: return "Trips"
        case .meals: return "Meals"
        }
    }

    var icon: String {
        switch self {
        case .trips: return "airplane"
        case .meals: return "fork.knife"
        }
    }
}

enum Tab: String, CaseIterable, Identifiable {
    case today, calendar, homework, chat, planning
    var id: String { rawValue }

    var label: String {
        switch self {
        case .today: return "Today"
        case .calendar: return "Calendar"
        case .homework: return "Homework"
        case .chat: return "Chat"
        case .planning: return "Planning"
        }
    }
    var icon: String {
        switch self {
        case .today: return "sun.max.fill"
        case .calendar: return "calendar"
        case .homework: return "book.closed.fill"
        case .chat: return "bubble.left.and.bubble.right.fill"
        case .planning: return PlanningDestination.trips.icon
        }
    }

    func displayLabel(for planningDestination: PlanningDestination) -> String {
        self == .planning ? planningDestination.label : label
    }

    func displayIcon(for planningDestination: PlanningDestination) -> String {
        self == .planning ? planningDestination.icon : icon
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var selection: Tab = .today
    @State private var planningSelection: PlanningDestination = .trips
    @State private var showChatSlideOver = false
    /// iPad docked chat column's own room selection (Trips room switcher) —
    /// independent of `selection`/`showChatSlideOver`, which the docked layout
    /// doesn't use for chat at all.
    @State private var dockedRoomId: String = familyRoomId
    // iPad size classes are regular×regular in BOTH orientations, so they can't
    // tell landscape from portrait — read it from the actual geometry.
    @State private var isLandscape = true

    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    /// Docked chat column shows only for parent sessions in iPad landscape —
    /// kid sessions and iPad portrait always use the rail + slide-over instead.
    private var showDockedChat: Bool { isPad && isLandscape && store.isParent }
    /// Notes remains available as a screen, but is intentionally not a native
    /// navigation entry in the compact shell.
    private var roleTabs: [Tab] { Tab.allCases }
    private var mainTabs: [Tab] { roleTabs.filter { $0 != .chat } }

    var body: some View {
        Group {
            if isPad {
                if showDockedChat {
                    iPadDockedChatLayout
                } else {
                    iPadRailLayout
                }
            } else {
                iPhoneLayout
            }
        }
        .onGeometryChange(for: Bool.self) { $0.size.width > $0.size.height } action: { isLandscape = $0 }
        .tint(Palette.accent)
        .preferredColorScheme(store.colorScheme)
        // Parents: kids waiting to be let in appear as a banner above everything.
        .safeAreaInset(edge: .top, spacing: 0) {
            KidApprovalBanner()
                .animation(Motion.snappy, value: store.kidRequests.map(\.id))
        }
        .task {
            await store.load()
            // Now that we know there's an authenticated session, ask for push
            // permission (prompts once) and register/refresh the APNs token. Gated
            // on !needsAuth so the token POST to /api/push/register has a session.
            if !store.needsAuth {
                #if DEBUG
                if !DebugLaunch.skipPush { PushRegistrationService.shared.requestAuthorizationAndRegister() }
                #else
                PushRegistrationService.shared.requestAuthorizationAndRegister()
                #endif
            }
        }
        // A kid_access_request push (or returning to the foreground) refreshes the
        // pending list so the approval banner is current without waiting for a poll.
        .onReceive(NotificationCenter.default.publisher(for: .famDeepLinkToKidApproval)) { _ in
            Task { await store.refreshKidRequests() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            Task { await store.refreshKidRequests() }
        }
        // Trips (docs/TRIPS-PLAN.md) push routing, v1: surface the Chat tab/
        // room. `ChatTabHost` finishes the job (switches to the exact trip
        // room) once `store.pendingChatRoomId` matches a room it knows about —
        // see `AppStore.pendingChatRoomId`.
        .onReceive(NotificationCenter.default.publisher(for: .famDeepLinkToTripChat)) { note in
            guard let tripId = note.userInfo?["tripId"] as? String else { return }
            let roomId = "trip:\(tripId)"
            if showDockedChat {
                dockedRoomId = roomId
            } else {
                selection = .chat
                if isPad { showChatSlideOver = true }
                store.pendingChatRoomId = roomId
            }
        }
        .overlay { if store.needsAuth { ReauthOverlay() } }
        .onAppear {
            #if DEBUG
            switch DebugLaunch.screen {
            case "chat":
                if !isPad { selection = .chat }
                else if !showDockedChat { showChatSlideOver = true }
                // else: docked column already shows chat.
            case "calendar": selection = .calendar
            case "homework": selection = .homework
            case "trips": planningSelection = .trips; selection = .planning
            case "meals": planningSelection = .meals; selection = .planning
            default: break   // today starts on the today tab
            }
            #endif
        }
    }

    // MARK: iPhone — floating pill tab bar (5 entries)

    private var iPhoneLayout: some View {
        TabView(selection: $selection) {
            TodayScreen().toolbar(.hidden, for: .tabBar).tag(Tab.today)
            CalendarScreen().toolbar(.hidden, for: .tabBar).tag(Tab.calendar)
            HomeworkScreen().toolbar(.hidden, for: .tabBar).tag(Tab.homework)
            ChatTabHost().toolbar(.hidden, for: .tabBar).tag(Tab.chat)
            planningDestinationScreen.toolbar(.hidden, for: .tabBar).tag(Tab.planning)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            FloatingTabBar(selection: $selection, planningSelection: $planningSelection, tabs: roleTabs)
                .padding(.bottom, 2) // sit a little lower (was Space.md)
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onChange(of: selection) { _, _ in Haptics.selection() }
    }

    @ViewBuilder
    private var planningDestinationScreen: some View {
        switch planningSelection {
        case .trips: TripsScreen()
        case .meals: MealsScreen()
        }
    }

    // MARK: iPad landscape (parent) — Trips/Meals rail + content + DOCKED chat column

    /// Nav rail (no Chat entry — it's docked, not tabbed; Trips and Meals are
    /// separate entries) + main content +
    /// a fixed-width `ChatScreen` column pinned to the trailing edge, per
    /// canvas-1f. The docked column always keeps the family room as its base
    /// (`ChatScreen` itself is otherwise unmodified — same header/composer,
    /// same horizontalSizeClass-driven bottom inset); Trips adds a compact
    /// Menu room-switcher in its header when the user has more than one room.
    private var iPadDockedChatLayout: some View {
        HStack(spacing: 0) {
            NavRailList(selection: $selection, planningSelection: $planningSelection, tabs: mainTabs)
                .frame(width: 90)
            Divider()
            TabView(selection: $selection) {
                TodayScreen().toolbar(.hidden, for: .tabBar).tag(Tab.today)
                CalendarScreen().toolbar(.hidden, for: .tabBar).tag(Tab.calendar)
                HomeworkScreen().toolbar(.hidden, for: .tabBar).tag(Tab.homework)
                planningDestinationScreen.toolbar(.hidden, for: .tabBar).tag(Tab.planning)
            }
            .frame(maxWidth: .infinity)
            Divider()
            ChatScreen(roomId: dockedRoomId, title: dockedRoomTitle) {
                if store.chatRooms.count > 1 {
                    ChatRoomSwitcher(rooms: store.chatRooms, selection: $dockedRoomId)
                }
            }
            .frame(width: 300)
        }
    }

    /// nil for the family room (falls back to `ChatScreen`'s own default
    /// title); the matching trip's title otherwise.
    private var dockedRoomTitle: String? {
        dockedRoomId == familyRoomId ? nil : store.chatRooms.first { $0.roomId == dockedRoomId }?.title
    }

    // MARK: iPad portrait, or any kid session — Trips/Meals rail + slide-over chat

    /// Nav rail with all compact entries (including Chat and separate Trips /
    /// Meals entries); tapping Chat opens
    /// `ChatTabHost` as a large sheet instead of swapping the main content,
    /// since there isn't width to spare for a permanent chat column here
    /// (canvas-1g). Main `TabView` only carries the non-chat screens, so
    /// `selection` never actually becomes `.chat` in this layout.
    private var iPadRailLayout: some View {
        HStack(spacing: 0) {
            NavRailList(selection: $selection, planningSelection: $planningSelection, tabs: roleTabs, onTapChat: { showChatSlideOver = true })
                .frame(width: 90)
            Divider()
            // A TabView (with its own tab bar hidden) keeps all screens alive,
            // so switching tabs is instant and each screen's loaded data +
            // scroll state persist instead of being rebuilt on every tap.
            TabView(selection: $selection) {
                TodayScreen().toolbar(.hidden, for: .tabBar).tag(Tab.today)
                CalendarScreen().toolbar(.hidden, for: .tabBar).tag(Tab.calendar)
                HomeworkScreen().toolbar(.hidden, for: .tabBar).tag(Tab.homework)
                planningDestinationScreen.toolbar(.hidden, for: .tabBar).tag(Tab.planning)
            }
            .frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $showChatSlideOver) {
            ChatTabHost().presentationDetents([.large])
        }
    }
}

// MARK: - iPad nav rail

/// Vertical nav rail for the iPad layout: icon + label rows stacked down the
/// rail, selection driven by direct taps (not `List(selection:)`, which only
/// updates selection via edit mode / NavigationSplitView row selection and
/// otherwise leaves taps outside a split view inert).
///
/// `tabs` lets a layout omit an entry entirely (docked chat has no Chat row).
/// The Planning slot is rendered as separate Trips and Meals rows on iPad;
/// `planningSelection` keeps the iPhone Tab contract shared with the content.
/// `onTapChat`, when set, intercepts a tap on the Chat row instead of changing
/// `selection` — used to open the chat slide-over sheet rather than swap the
/// main content.
private struct NavRailList: View {
    @Binding var selection: Tab
    @Binding var planningSelection: PlanningDestination
    var tabs: [Tab] = Tab.allCases
    var onTapChat: (() -> Void)? = nil
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(spacing: Space.xs) {
            ForEach(tabs) { tab in
                if tab == .planning {
                    railRow(for: tab, planningDestination: .trips)
                    railRow(for: tab, planningDestination: .meals)
                } else {
                    railRow(for: tab)
                }
            }
            Spacer()
        }
        .padding(.top, Space.md)
        .padding(.horizontal, Space.xs)
    }

    private func railRow(for tab: Tab, planningDestination: PlanningDestination? = nil) -> some View {
        let displayedPlanningDestination = planningDestination ?? self.planningSelection
        let isOn = tab == selection && (tab != .planning || self.planningSelection == displayedPlanningDestination)
        let label = tab.displayLabel(for: displayedPlanningDestination)
        return VStack(spacing: 4) {
            Image(systemName: tab.displayIcon(for: displayedPlanningDestination))
                .font(.system(size: 18, weight: .semibold))
                .overlay(alignment: .topTrailing) {
                    if tab == .chat && store.unreadChatCount > 0 {
                        unreadBadge(store.unreadChatCount)
                    }
                }
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .foregroundStyle(isOn ? Palette.text : Palette.textSecond)
        .frame(maxWidth: .infinity)
        .padding(.vertical, Space.sm)
        .background {
            if isOn {
                RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                    .fill(Palette.accentSoft)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if tab == .chat, let onTapChat {
                Haptics.selection()
                onTapChat()
                return
            }
            if let planningDestination {
                choosePlanning(planningDestination)
                return
            }
            guard selection != tab else { return }
            Haptics.selection()
            selection = tab
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(planningDestination.map(\.label) ?? (tab == .planning ? "Planning, " + label : label))
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }

    private func choosePlanning(_ destination: PlanningDestination) {
        let destinationChanges = planningSelection != destination
        let selectionChanges = selection != .planning
        planningSelection = destination
        if selectionChanges {
            Haptics.selection()
            selection = .planning
        } else if destinationChanges {
            Haptics.selection()
        }
    }

    private func unreadBadge(_ count: Int) -> some View {
        Text(count > 9 ? "9+" : "\(count)")
            .font(.system(size: 10, weight: .heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(Palette.coral, in: Capsule())
            .offset(x: 10, y: -7)
    }
}

private struct PlanningDestinationMenu: View {
    let onSelect: (PlanningDestination) -> Void

    var body: some View {
        Button {
            onSelect(.trips)
        } label: {
            Label(PlanningDestination.trips.label, systemImage: PlanningDestination.trips.icon)
        }
        Button {
            onSelect(.meals)
        } label: {
            Label(PlanningDestination.meals.label, systemImage: PlanningDestination.meals.icon)
        }
    }
}

// MARK: - Floating tab bar (iPhone)

/// Custom floating tab bar: a glass capsule raised clear of the home-indicator /
/// Siri gesture zone, with an ink pill that slides between tabs
/// (matchedGeometryEffect). Icon-only; VoiceOver reads the full labels.
struct FloatingTabBar: View {
    @Binding var selection: Tab
    @Binding var planningSelection: PlanningDestination
    /// Compact tab list (RootView passes all five entries).
    var tabs: [Tab] = Tab.allCases
    @Environment(AppStore.self) private var store
    @Namespace private var pillNS
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            ForEach(tabs) { tab in
                let isOn = selection == tab
                if tab == .planning {
                    tabButton(tab, isOn: isOn)
                        .contextMenu {
                            PlanningDestinationMenu { destination in
                                choosePlanning(destination)
                            }
                        }
                        .accessibilityHint("Long press to choose Trips or Meals.")
                        .accessibilityAction(named: Text("Choose Trips")) {
                            choosePlanning(.trips)
                        }
                        .accessibilityAction(named: Text("Choose Meals")) {
                            choosePlanning(.meals)
                        }
                } else {
                    tabButton(tab, isOn: isOn)
                }
            }
        }
        .padding(Space.xs + 2)
        .background(.ultraThinMaterial, in: Capsule())
        .background(Palette.panel.opacity(0.55), in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.border.opacity(0.85), lineWidth: 1))
        .shadow(color: .black.opacity(0.14), radius: 18, x: 0, y: 8)
        .padding(.horizontal, Space.md)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Tab bar")
    }

    private func tabButton(_ tab: Tab, isOn: Bool) -> some View {
        let label = tab.displayLabel(for: planningSelection)
        return Button {
            guard !isOn else { return }
            withAnimation(Motion.maybe(Motion.snappy, reduceMotion: reduceMotion)) {
                selection = tab
            }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: tab.displayIcon(for: planningSelection))
                    .font(.system(size: 16, weight: .semibold))
                    .overlay(alignment: .topTrailing) {
                        if tab == .chat && store.unreadChatCount > 0 { unreadBadge(store.unreadChatCount) }
                    }
                Text(label)
                    .font(.system(size: 9, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(isOn ? Palette.bg : Palette.textSecond)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background {
                if isOn {
                    Capsule()
                        .fill(Palette.text)
                        .matchedGeometryEffect(id: "activePill", in: pillNS)
                        .padding(.horizontal, 3)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab == .planning ? "Planning, " + label : label)
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }

    private func choosePlanning(_ destination: PlanningDestination) {
        let destinationChanges = planningSelection != destination
        let selectionChanges = selection != .planning
        planningSelection = destination
        if selectionChanges {
            // iPhone's RootView selection observer supplies the normal selection
            // haptic when this changes tabs.
            selection = .planning
        } else if destinationChanges {
            Haptics.selection()
        }
    }

    private func unreadBadge(_ count: Int) -> some View {
        Text(count > 9 ? "9+" : "\(count)")
            .font(.system(size: 10, weight: .heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(Palette.coral, in: Capsule())
            .offset(x: 10, y: -7)
    }
}

// MARK: - Re-auth

/// Shown when a native request 401s (session expired). Re-establishes the session
/// with a passkey and resyncs, without dropping the user back to onboarding.
struct ReauthOverlay: View {
    @Environment(AppStore.self) private var store
    @State private var working = false
    @State private var error: String?
    @State private var showBackupSignIn = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea()
            Card {
                VStack(alignment: .leading, spacing: Space.md) {
                    Text("Session expired")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                    Text("Sign in again with your passkey to keep your family in sync.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                    Button(action: startSignIn) {
                        Text(working ? "Signing in…" : "Sign in")
                            .font(Typography.body.weight(.semibold))
                            .foregroundStyle(Palette.onAccent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Space.md)
                            .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                    }
                    .disabled(working)
                    Button("Use a backup code") { showBackupSignIn = true }
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.accent)
                        .frame(maxWidth: .infinity)
                        .disabled(working)
                    if let error {
                        Text(error)
                            .font(Typography.caption)
                            .foregroundStyle(Palette.warn)
                    }
                }
            }
            .padding(Space.xl)
        }
        .sheet(isPresented: $showBackupSignIn) {
            BackupCodeSignInView {
                showBackupSignIn = false
                store.needsAuth = false
                Task { await store.refresh() }
                PushRegistrationService.shared.requestAuthorizationAndRegister()
            }
            .presentationDetents([.large])
        }
    }

    private func startSignIn() {
        Task { await signIn() }
    }

    private func signIn() async {
        working = true
        error = nil
        do {
            try await AuthService.shared.signInWithPasskey()
            store.needsAuth = false
            await store.refresh()
            // Fresh session — (re)register for push so the token is attached to it.
            PushRegistrationService.shared.requestAuthorizationAndRegister()
        } catch {
            self.error = error.localizedDescription
        }
        working = false
    }
}
