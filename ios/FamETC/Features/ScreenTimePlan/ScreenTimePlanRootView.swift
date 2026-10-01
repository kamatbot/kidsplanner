import SwiftUI

// The Screen Time plan's whole app (docs/SCREEN-TIME-ONLY-PLAN.md §4). `RootView` mounts this
// when `AppStore.productPlan == .screenTime`; its banners (kid sign-in requests, Screen Time
// alerts), deep links, Screen Time load, re-auth and sign-out wrap it, so none of that lives here.
//
//   Parent, compact width (iPhone, narrow iPad)   TabView: Home · Family. "Rules" opens the
//                                                 existing controls as a large sheet.
//   Parent, regular width (iPad full / two-thirds) Sidebar: Home, the kid list (avatar, name,
//                                                 neutral status) and Family. A kid's row opens
//                                                 `ScreenTimeKidControls` as the detail.
//   Kid (any width)                               One screen, no tab bar: the kid home.
//
// The layout is chosen by `horizontalSizeClass`, never by device idiom, so Split View and
// Stage Manager resizes move between the two without special cases. The selection lives in
// one `@State` that both layouts read, so a resize keeps the parent where they were.

struct ScreenTimePlanRootView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        if store.isParent {
            ScreenTimePlanParentRoot()
        } else {
            ScreenTimePlanKidHomeView()
        }
    }
}

// MARK: - Parent

private enum PlanDestination: Hashable {
    case home, family, kid(String)
}

private enum CompactTab: Hashable {
    case home, family
}

private struct ScreenTimePlanParentRoot: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var destination: PlanDestination? = .home
    @State private var rulesKid: RulesKid?
    @State private var columns: NavigationSplitViewVisibility = .all
    private var service: ScreenTimeService { .shared }

    private struct RulesKid: Identifiable { let id: String }

    var body: some View {
        Group {
            if sizeClass == .regular {
                regularLayout
            } else {
                compactLayout
            }
        }
        .modifier(ScreenTimeEssentialAppsDraftGuard())
        .onChange(of: store.me?.id) { _, _ in destination = .home; rulesKid = nil }
        .onChange(of: store.needsAuth) { _, needsAuth in if needsAuth { rulesKid = nil } }
        .onChange(of: store.kids.map(\.id)) { _, ids in
            // A removed kid can't stay selected in the sidebar.
            if case .kid(let id)? = destination, !ids.contains(id) { destination = .home }
        }
    }

    /// "Rules": the detail column on regular widths, the existing large sheet on compact.
    private func openRules(_ kidId: String) {
        Haptics.selection()
        if sizeClass == .regular {
            destination = .kid(kidId)
        } else {
            rulesKid = RulesKid(id: kidId)
        }
    }

    private func openFamily() {
        destination = .family
    }

    // MARK: Compact — Home · Family

    private var compactTab: Binding<CompactTab> {
        Binding(
            get: { destination == PlanDestination.family ? CompactTab.family : CompactTab.home },
            set: { destination = $0 == CompactTab.family ? PlanDestination.family : PlanDestination.home }
        )
    }

    private var compactLayout: some View {
        TabView(selection: compactTab) {
            NavigationStack {
                ScreenTimePlanHomeView(openRules: openRules, openFamily: openFamily)
            }
            .tabItem { Label("Home", systemImage: "house.fill") }
            .tag(CompactTab.home)
            .accessibilityIdentifier("screentimeplan.tab.home")

            NavigationStack {
                FamilySettingsView()
            }
            .tabItem { Label("Family", systemImage: "person.2.fill") }
            .tag(CompactTab.family)
            .accessibilityIdentifier("screentimeplan.tab.family")
        }
        .onChange(of: compactTab.wrappedValue) { _, _ in Haptics.selection() }
        .screenTimeControlsCover(item: $rulesKid) { ScreenTimeParentSheet(initialKidId: $0.id).tint(Palette.frYou) }
    }

    // MARK: Regular — sidebar + detail

    private var regularLayout: some View {
        NavigationSplitView(columnVisibility: $columns) {
            sidebar
        } detail: {
            NavigationStack {
                switch destination ?? .home {
                case .home:
                    ScreenTimePlanHomeView(openRules: openRules, openFamily: openFamily)
                case .family:
                    FamilySettingsView()
                case .kid(let id):
                    KidControlsDetail(kidId: id)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private var sidebar: some View {
        List(selection: $destination) {
            Section {
                Label("Home", systemImage: "house.fill")
                    .frame(minHeight: 44, alignment: .leading)
                    .tag(PlanDestination.home)
                    .accessibilityIdentifier("screentimeplan.sidebar.home")
            }
            if !store.kids.isEmpty {
                Section("Kids") {
                    ForEach(store.kids) { kid in
                        SidebarKidRow(kid: kid)
                            .tag(PlanDestination.kid(kid.id))
                    }
                }
            }
            Section {
                Label("Family", systemImage: "person.2.fill")
                    .frame(minHeight: 44, alignment: .leading)
                    .tag(PlanDestination.family)
                    .accessibilityIdentifier("screentimeplan.sidebar.family")
            }
        }
        .navigationTitle("Fam ETC")
        .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 360)
        .accessibilityIdentifier("screentimeplan.sidebar")
    }
}

/// A kid in the sidebar: avatar, name and the same neutral status chip as everywhere else.
private struct SidebarKidRow: View {
    let kid: Kid
    private var service: ScreenTimeService { .shared }

    var body: some View {
        let status = ScreenTimeKidStatus(state: service.state(for: kid.id))
        return HStack(spacing: Space.md) {
            KidProfileAvatar(kid: kid, size: 36)
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(kid.name)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .lineLimit(1)
                ScreenTimeChip(text: status.chipText, ink: status.colors.ink, soft: status.colors.soft)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Space.xs)
        .frame(minHeight: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(kid.name), Screen Time")
        .accessibilityValue(status.text)
        .accessibilityIdentifier("screentimeplan.sidebar.kid.\(kid.id)")
    }
}

/// The selected kid's controls as the iPad detail: exactly the controls the sheet shows,
/// plus the device setup checklist one tap away.
private struct KidControlsDetail: View {
    let kidId: String
    @Environment(AppStore.self) private var store
    @State private var showSetup = false

    private var kid: Kid? { store.kids.first { $0.id == kidId } }

    var body: some View {
        ScreenTimeKidControls(kidId: kidId)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
            .background(ScreenBackground())
            .navigationTitle(kid.map { "Screen Time for \($0.name)" } ?? "Screen Time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Haptics.selection()
                        showSetup = true
                    } label: {
                        Label("Set up a device", systemImage: "plus.circle")
                    }
                    .accessibilityIdentifier("screentimeplan.detail.setupDevice")
                }
            }
            .sheet(isPresented: $showSetup) {
                NavigationStack {
                    DeviceSetupChecklistView(kidIds: [kidId])
                        .navigationTitle("Set up a device")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("Done") { showSetup = false } }
                        }
                }
                .tint(Palette.frYou)
            }
            .accessibilityIdentifier("screentimeplan.detail.\(kidId)")
    }
}
