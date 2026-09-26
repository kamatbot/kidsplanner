import SwiftUI

// A single native tab hierarchy adapts to phone, tablet, and resizable displays.
// Do not branch the screen tree by device idiom: doing so recreates local drafts,
// navigation stacks, and web views when the available space changes.
// Chat stays a destination; Planning retains both Trips and Meals while switching.
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
    @AppStorage("fam_onboarded") private var onboarded = false
    @State private var selection: Tab = .today
    @State private var planningSelection: PlanningDestination = .trips
    @State private var assistanceChild: AssistanceChildRoute?
    @State private var pendingAssistanceURL: URL?
    @State private var signingOut = false
    private struct AssistanceChildRoute: Identifiable { let id: String }

    private func openAssistanceRoute(_ url: URL) {
        guard url.scheme == "https", let host = url.host?.lowercased(),
              ["fametc.com", "www.fametc.com"].contains(host), url.path == "/",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.first(where: { $0.name == "famRoute" })?.value == "today",
              let id = components.queryItems?.first(where: { $0.name == "childId" })?.value else { return }
        if (store.me == nil || store.isRefreshing || !store.assistanceIdentityVerified), !store.needsAuth {
            pendingAssistanceURL = url
            return
        }
        pendingAssistanceURL = nil
        guard !store.needsAuth, store.assistanceIdentityVerified, let user = store.me, user.role != "kid",
              store.family?.parentIds.contains(user.id) == true,
              store.kids.contains(where: { $0.id == id }) else { return }
        selection = .today
        assistanceChild = AssistanceChildRoute(id: id)
    }


    var body: some View {
        Group {
            if signingOut { ProgressView("Signing out…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else { adaptiveLayout }
        }
        .tint(Palette.frYou)
        .preferredColorScheme(store.colorScheme)
        .onOpenURL { openAssistanceRoute($0) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { openAssistanceRoute(url) }
        }
        .sheet(item: $assistanceChild) { route in
            ParentAttentionSheet(childID: route.id)
        }
        .onChange(of: store.isRefreshing) { _, refreshing in
            guard !refreshing else { return }
            if store.assistanceIdentityVerified, let url = pendingAssistanceURL { openAssistanceRoute(url) }
            else { pendingAssistanceURL = nil }
        }
        .onChange(of: store.me?.id) { _, _ in assistanceChild = nil }
        .onChange(of: store.needsAuth) { _, needsAuth in
            if needsAuth { assistanceChild = nil; pendingAssistanceURL = nil }
        }
        // Parents: kids waiting to be let in appear as a banner above everything.
        .safeAreaInset(edge: .top, spacing: 0) {
            KidApprovalBanner()
                .animation(Motion.snappy, value: store.kidRequests.map(\.id))
        }
        .task {
            await store.load()
            if let url = pendingAssistanceURL { openAssistanceRoute(url) }
            consumePendingChatRoute()
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
        .onReceive(NotificationCenter.default.publisher(for: .famDeepLinkToChat)) { _ in
            routeFromLiveChatNotification(fallbackRoomId: familyRoomId)
        }
        // Trips (docs/TRIPS-PLAN.md) push routing: surface the Chat tab/room.
        // `ChatTabHost` finishes the job (switches to the exact trip
        // room) once `store.pendingChatRoomId` matches a room it knows about —
        // see `AppStore.pendingChatRoomId`.
        .onReceive(NotificationCenter.default.publisher(for: .famDeepLinkToTripChat)) { note in
            guard let tripId = note.userInfo?["tripId"] as? String else { return }
            routeFromLiveChatNotification(fallbackRoomId: "trip:\(tripId)")
        }
        .overlay { if store.needsAuth && !signingOut { ReauthOverlay() } }
        .onAppear {
            #if DEBUG
            switch DebugLaunch.screen {
            case "chat": selection = .chat
            case "calendar": selection = .calendar
            case "homework": selection = .homework
            case "trips": planningSelection = .trips; selection = .planning
            case "meals": planningSelection = .meals; selection = .planning
            default: break   // today starts on the today tab
            }
            #endif
            consumePendingChatRoute()
        }
    }

    private func routeToChat(roomId: String) {
        selection = .chat
        store.pendingChatRoomId = roomId
    }

    private func routeFromLiveChatNotification(fallbackRoomId: String) {
        let roomId = NotificationHandler.shared.consumePendingChatRoomId() ?? fallbackRoomId
        routeToChat(roomId: roomId)
    }

    private func consumePendingChatRoute() {
        guard let roomId = NotificationHandler.shared.consumePendingChatRoomId() else { return }
        routeToChat(roomId: roomId)
    }

    // MARK: iPhone — floating pill tab bar (5 entries)

    /// One structural identity across window sizes and display transitions.
    /// System bars own safe areas and can adapt to Duo's vertical presentation.
    private var adaptiveLayout: some View {
        TabView(selection: $selection) {
            TodayScreen(onOpenHomework: { selection = .homework }, onOpenMeals: {
                planningSelection = .meals
                selection = .planning
            })
                .accessibilityIdentifier("screen-today")
                .tabItem { Label("Today", systemImage: Tab.today.icon) }
                .tag(Tab.today)
            CalendarScreen()
                .accessibilityIdentifier("screen-calendar")
                .tabItem { Label("Calendar", systemImage: Tab.calendar.icon) }.tag(Tab.calendar)
            HomeworkScreen()
                .accessibilityIdentifier("screen-homework")
                .tabItem { Label("Homework", systemImage: Tab.homework.icon) }.tag(Tab.homework)
            ChatTabHost()
                .accessibilityIdentifier("screen-chat")
                .badge(store.unreadChatCount)
                .tabItem { Label("Chat", systemImage: Tab.chat.icon) }.tag(Tab.chat)
            planningDestinationScreen
                .accessibilityIdentifier("screen-planning")
                .tabItem { Label("Planning", systemImage: Tab.planning.icon) }.tag(Tab.planning)
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabViewSidebarFooter {
            Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", action: signOut)
        }
        .onChange(of: selection) { _, _ in Haptics.selection() }
    }

    private var planningDestinationScreen: some View {
        // Keep both destinations mounted. In particular this preserves the
        // WKWebView's scroll/form state when switching Trips <-> Meals and
        // avoids treating every rail tap as a departure from Trips.
        ZStack {
            TripsScreen()
                .opacity(planningSelection == .trips ? 1 : 0)
                .allowsHitTesting(planningSelection == .trips)
                .accessibilityHidden(planningSelection != .trips)
            MealsScreen()
                .opacity(planningSelection == .meals ? 1 : 0)
                .allowsHitTesting(planningSelection == .meals)
                .accessibilityHidden(planningSelection != .meals)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            Picker("Planning destination", selection: $planningSelection) {
                ForEach(PlanningDestination.allCases) { destination in
                    Label(destination.label, systemImage: destination.icon).tag(destination)
                }
            }
            .pickerStyle(.segmented)
            .padding(Space.md)
            .background(Palette.sidebar)
        }
    }

    private func signOut() {
        guard !signingOut else { return }
        signingOut = true
        assistanceChild = nil
        pendingAssistanceURL = nil
        // Unmount private native/web content before the network revocation wait.
        store.signedOut()
        Task {
            let confirmed = await APIClient.shared.logout()
            UserDefaults.standard.set(!confirmed, forKey: "fam_logout_unconfirmed")
            onboarded = false
        }
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
