import SwiftUI

// MARK: - Size-class branching strategy
//
// Fam ETC leans on Chat being "always nearby" the way a family group chat is,
// so the layout isn't a plain 1:1 port of RetireOdds's iPhone-only tab bar:
//
//   iPhone (compact width)            → FloatingTabBar (4 tabs), same pill /
//                                        matchedGeometryEffect / glass-material
//                                        pattern as RetireOdds, adapted to 4 tabs.
//                                        Chat is a full tab like the others.
//
//   iPad landscape (regular width,     → NavigationSplitView 3-column: a narrow
//   compact height via GeometryReader    nav rail (sidebar), the selected tab's
//   width>height, `.pad` idiom)          main content, and a DOCKED chat column
//                                        on the trailing edge — so chat is always
//                                        visible while browsing Today/Calendar/
//                                        Homework, mirroring how a family actually
//                                        uses group chat alongside a calendar.
//
//   iPad portrait (regular width AND   → main content fills the screen with a
//   regular height)                      compact top/side nav rail; Chat is
//                                        reached via a slide-in trailing sheet
//                                        instead of a docked column, since there
//                                        isn't width to spare for 3 columns.
//
// Settings/Goals/Activities are NOT native tabs — they're reached from a "More"
// entry inside Today, hosted by `HybridWebView`. That "More" sheet/menu is out
// of scope for this scaffold; only the 4-tab native surface is wired here.
enum Tab: String, CaseIterable, Identifiable {
    case today, chat, calendar, homework
    var id: String { rawValue }

    var label: String {
        switch self {
        case .today: return "Today"
        case .chat: return "Chat"
        case .calendar: return "Calendar"
        case .homework: return "Homework"
        }
    }
    var icon: String {
        switch self {
        case .today: return "sun.max.fill"
        case .chat: return "bubble.left.and.bubble.right.fill"
        case .calendar: return "calendar"
        case .homework: return "book.closed.fill"
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var selection: Tab = .today
    @State private var showChatSlideOver = false

    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    private var isRegularRegular: Bool {
        horizontalSizeClass == .regular && verticalSizeClass == .regular
    }
    private var isPadLandscape: Bool {
        isPad && horizontalSizeClass == .regular && verticalSizeClass == .compact
    }

    var body: some View {
        Group {
            if isPad && isPadLandscape {
                iPadLandscapeLayout
            } else if isPad && isRegularRegular {
                iPadPortraitLayout
            } else {
                iPhoneLayout
            }
        }
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
        .overlay { if store.needsAuth { ReauthOverlay() } }
        .onAppear {
            #if DEBUG
            switch DebugLaunch.screen {
            case "chat": selection = .chat
            case "calendar": selection = .calendar
            case "homework": selection = .homework
            default: break   // today starts on the today tab
            }
            #endif
        }
    }

    // MARK: iPhone — floating pill tab bar (4 tabs)

    private var iPhoneLayout: some View {
        TabView(selection: $selection) {
            TodayScreen().toolbar(.hidden, for: .tabBar).tag(Tab.today)
            ChatScreen().toolbar(.hidden, for: .tabBar).tag(Tab.chat)
            CalendarScreen().toolbar(.hidden, for: .tabBar).tag(Tab.calendar)
            HomeworkScreen().toolbar(.hidden, for: .tabBar).tag(Tab.homework)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            FloatingTabBar(selection: $selection)
                .padding(.bottom, Space.md)
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onChange(of: selection) { _, _ in Haptics.selection() }
    }

    // MARK: iPad landscape — 3-column split: nav rail | content | docked chat

    private var iPadLandscapeLayout: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            NavRailList(selection: $selection)
                .navigationSplitViewColumnWidth(min: 90, ideal: 110, max: 140)
        } content: {
            mainContent(for: selection)
                .navigationSplitViewColumnWidth(min: 360, ideal: 480)
        } detail: {
            // Chat stays docked on the trailing edge regardless of the selected
            // tab, except when Chat itself is selected — the content column
            // already shows it, so the detail column offers a friendly stand-in.
            if selection == .chat {
                ComingSoonDockedNote()
            } else {
                ChatScreen()
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    // MARK: iPad portrait — full-width content, chat via trailing slide-over

    private var iPadPortraitLayout: some View {
        HStack(spacing: 0) {
            NavRailList(selection: $selection)
                .frame(width: 90)
            Divider()
            mainContent(for: selection)
                .frame(maxWidth: .infinity)
                .safeAreaInset(edge: .top) {
                    HStack {
                        Spacer()
                        Button {
                            showChatSlideOver = true
                        } label: {
                            Image(systemName: "bubble.left.and.bubble.right.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Palette.accent)
                                .padding(Space.sm)
                                .background(Palette.accentSoft, in: Circle())
                        }
                        .padding(.trailing, Space.lg)
                        .padding(.top, Space.sm)
                    }
                }
        }
        .sheet(isPresented: $showChatSlideOver) {
            ChatScreen()
                .presentationDetents([.large])
        }
    }

    @ViewBuilder
    private func mainContent(for tab: Tab) -> some View {
        switch tab {
        case .today: TodayScreen()
        case .chat: ChatScreen()
        case .calendar: CalendarScreen()
        case .homework: HomeworkScreen()
        }
    }
}

/// Friendly filler for the iPad-landscape detail column when Chat is already
/// the selected tab (so the content column covers it) — avoids showing the same
/// screen twice side by side.
private struct ComingSoonDockedNote: View {
    var body: some View {
        ZStack {
            ScreenBackground()
            Text("Chat is open in the main column.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .padding(Space.lg)
        }
    }
}

// MARK: - iPad nav rail

/// Simple List-based nav rail shared by both iPad layouts: icon + label rows,
/// selection bound to `Tab`.
private struct NavRailList: View {
    @Binding var selection: Tab

    /// `List(selection:)` requires an Optional binding; `Tab` itself is never
    /// nil here, so this just bridges the two without ever going nil.
    private var optionalSelection: Binding<Tab?> {
        Binding(get: { selection }, set: { if let v = $0 { selection = v } })
    }

    var body: some View {
        List(selection: optionalSelection) {
            ForEach(Tab.allCases) { tab in
                Label(tab.label, systemImage: tab.icon)
                    .tag(tab)
            }
        }
        .listStyle(.sidebar)
    }
}

// MARK: - Floating tab bar (iPhone)

/// Custom floating tab bar: a glass capsule raised clear of the home-indicator /
/// Siri gesture zone, with an ink pill that slides between tabs
/// (matchedGeometryEffect). Icon-only; VoiceOver reads the full labels.
struct FloatingTabBar: View {
    @Binding var selection: Tab
    @Namespace private var pillNS
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases) { tab in
                let isOn = selection == tab
                Button {
                    guard !isOn else { return }
                    withAnimation(Motion.maybe(Motion.snappy, reduceMotion: reduceMotion)) {
                        selection = tab
                    }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 17, weight: .semibold))
                        Text(tab.label)
                            .font(.system(size: 10, weight: .semibold))
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
                .accessibilityLabel(tab.label)
                .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(Space.xs + 2)
        .background(.ultraThinMaterial, in: Capsule())
        .background(Palette.panel.opacity(0.55), in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.border.opacity(0.85), lineWidth: 1))
        .shadow(color: .black.opacity(0.14), radius: 18, x: 0, y: 8)
        .padding(.horizontal, Space.lg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Tab bar")
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
