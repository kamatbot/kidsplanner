import SwiftUI

/// Presentation only: all ring totals are produced by FamilyRingsMath.
struct FamilyRingsHero: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let onSeeAll: () -> Void
    /// iPad child layout: the compact card's small summary ring and header, with full-size action rows.
    var dense = false

    private var viewerItems: [FamilyAction] {
        store.actions.filter { action in
            store.canViewAction(action) && (store.isParent ||
                store.me?.kidId.map { store.canManageOwnKidAction(action, ownKidId: $0) } == true)
        }
    }
    private var active: [FamilyAction] {
        ActionQueue.sortActive(viewerItems).filter { ActionQueue.effectiveDue($0)?.isSnoozed != true }
    }
    private var progress: FamilyRingsMath.ActionProgress { FamilyRingsMath.parentRing(viewerItems: viewerItems) }
    private var identity: String { "\(store.me?.id ?? "")|\(store.family?.id ?? "")|\(Agenda.todayKey())" }
    private var summary: String {
        store.isParent
            ? "\(progress.open) \(progress.open == 1 ? "thing needs" : "things need") you, \(progress.cleared) cleared today"
            : "\(progress.open) to do, \(progress.cleared) cleared today"
    }
    private var compact: Bool { !textSize.isAccessibilitySize && (sizeClass == .compact || verticalSizeClass == .compact) }
    private var wide: Bool { !compact && !dense && !textSize.isAccessibilitySize }
    private var summaryHeader: Bool { compact || (dense && !textSize.isAccessibilitySize) }

    var body: some View {
        Card(padding: compact ? 14 : dense ? 20 : 28) {
            Group {
                if store.me == nil || store.family == nil || (store.isLoadingActions && viewerItems.isEmpty) {
                    VStack(spacing: 16) {
                        Circle().fill(Palette.frCard2).frame(width: summaryHeader ? 64 : 152, height: summaryHeader ? 64 : 152)
                        RoundedRectangle(cornerRadius: 12).fill(Palette.frCard2).frame(height: 44)
                        RoundedRectangle(cornerRadius: 12).fill(Palette.frCard2).frame(height: 44)
                    }
                    .redacted(reason: .placeholder)
                    .accessibilityLabel("Loading your day")
                } else if let error = store.actionError, viewerItems.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(error).font(Typography.body).foregroundStyle(Palette.frInk2)
                        Button("Try again") { Task { await store.loadFamilyActions() } }
                            .frame(minHeight: 44).accessibilityIdentifier("today.hero.retry")
                    }
                } else {
                    let layout = wide ? AnyLayout(HStackLayout(alignment: .center, spacing: 24))
                                      : AnyLayout(VStackLayout(spacing: 8))
                    layout {
                        if !summaryHeader { heroRing.frame(width: wide ? 250 : nil) }
                        VStack(alignment: .leading, spacing: compact ? 6 : 12) {
                            if summaryHeader {
                                ViewThatFits(in: .horizontal) {
                                    HStack(spacing: 10) { compactSummary; Spacer(minLength: 4); allLink }
                                    VStack(alignment: .leading, spacing: 4) { compactSummary; allLink }
                                }
                            } else {
                                ViewThatFits(in: .horizontal) {
                                    HStack { heading; Spacer(); allLink }
                                    VStack(alignment: .leading) { heading; allLink }
                                }
                            }
                            if active.isEmpty {
                                Text("All clear. Nothing waiting right now.")
                                    .font(Typography.body).foregroundStyle(Palette.frInk2)
                                Button("Family actions", action: onSeeAll).frame(minHeight: 44)
                            } else {
                                ForEach(Array(active.prefix(3))) { action in
                                    FamilyRingsActionRow(action: action, compact: compact)
                                    if action.id != active.prefix(3).last?.id { Divider().overlay(Palette.frRule) }
                                }
                                if active.count > 3 && !compact {
                                    Button("+\(active.count - 3) more", action: onSeeAll)
                                        .font(Typography.body.weight(.semibold))
                                        .frame(minHeight: 44).accessibilityIdentifier("today.hero.more")
                                }
                            }
                            if store.actionError != nil {
                                Text("Actions couldn't refresh. Pull down to retry.")
                                    .font(Typography.caption).foregroundStyle(Palette.frDanger)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .animation(Motion.maybe(Motion.ring, reduceMotion: reduceMotion), value: active.map(\.id))
                }
            }
            .frame(maxHeight: dense ? .infinity : nil, alignment: .top)
        }
    }
    private var heading: some View { MicroLabel(text: store.isParent ? "NEEDS YOU" : "YOUR DAY") }
    private var allLink: some View {
        Button("See all \(progress.open)", action: onSeeAll)
            .font(Typography.body.weight(.semibold)).foregroundStyle(Palette.frYouInk)
            .frame(minHeight: 44).accessibilityIdentifier("today.hero.seeAll")
    }
    private var compactSummary: some View {
        HStack(spacing: 10) {
            heroRing
            VStack(alignment: .leading, spacing: 3) {
                heading
                Text("\(progress.cleared) cleared today")
                    .font(Typography.caption).foregroundStyle(Palette.frInk2)
            }.accessibilityHidden(true)
        }
    }
    private var heroRing: some View {
        ZStack {
            FamilyRing(style: .parent, diameter: summaryHeader ? 64 : wide ? 188 : 152, metrics: [
                RingMetric(id: "you", value: progress.cleared, total: progress.total,
                           color: Palette.frYou, label: store.isParent ? "Needs you" : "Your day")
            ]).id(identity)
            VStack(spacing: 3) {
                Text(progress.open == 0 && progress.cleared > 0 ? "✓" : "\(progress.open)")
                    .font(summaryHeader ? Typography.statNumeral : wide ? Typography.heroNumeralRegular : Typography.heroNumeral)
                    .tracking(-2).monospacedDigit().foregroundStyle(Palette.frInk)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge).minimumScaleFactor(0.6)
                if !summaryHeader {
                    Text(progress.open == 0 ? "All clear" : store.isParent ? "Need you" : "To do")
                        .font(Typography.chip).foregroundStyle(Palette.frYouInk)
                    Text("\(progress.cleared) cleared today")
                        .font(Theme.font(11, relativeTo: .caption)).foregroundStyle(Palette.frInk2)
                }
            }
            .padding(summaryHeader ? 8 : 28).frame(width: summaryHeader ? 64 : wide ? 188 : 152)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary).accessibilityIdentifier("today.hero.summary")
    }
}

private struct FamilyRingsActionRow: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var homeworkRef: HWRef?
    let action: FamilyAction
    var compact = false
    private var kid: Kid? {
        let id = action.kidId ?? (action.assigneeType == "kid" ? action.assigneeId : nil)
        return store.kids.first { $0.id == id }
    }
    private var isReview: Bool { store.isParent && action.sourceType == "homework" }
    private var overdue: Bool { ActionQueue.effectiveDue(action).map { $0.dateKey < Agenda.todayKey() } ?? false }
    private var meta: String { "\(kid?.name ?? "Family / shared") · \(action.sourceType.capitalized) · \(ActionQueue.dueLabel(for: action))" }
    var body: some View {
        let layout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                                                 : AnyLayout(HStackLayout(alignment: .center, spacing: compact ? 8 : 12))
        layout {
            HStack(spacing: compact ? 8 : 12) {
                if let kid { KidProfileAvatar(kid: kid, size: compact ? 28 : 40) }
                else { Text("F").font(Typography.itemTitle).foregroundStyle(Palette.frOnYou)
                    .frame(width: compact ? 28 : 40, height: compact ? 28 : 40).background(Palette.frYou, in: Circle()).accessibilityHidden(true) }
                VStack(alignment: .leading, spacing: 4) {
                    Text(action.title).font(compact ? Typography.body.weight(.semibold) : Typography.itemTitle).foregroundStyle(Palette.frInk)
                        .lineLimit(textSize.isAccessibilitySize ? nil : 2)
                    Text(meta).font(compact ? Typography.caption : Typography.label).foregroundStyle(overdue ? Palette.frDanger : Palette.frInk2)
                        .fixedSize(horizontal: false, vertical: true)
                }.frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
            }
            if isReview, let sourceID = action.sourceId {
                Button("Review") { homeworkRef = HWRef(id: sourceID) }
                    .buttonStyle(RingsCapsuleStyle(filled: true, compact: compact))
                    .accessibilityIdentifier("today.action.review.\(action.id)")
            } else if store.canCompleteAction(action) {
                Button("Done") {
                    let before = FamilyRingsMath.parentRing(viewerItems: store.actions.filter { store.canViewAction($0) })
                    Haptics.impact(.light)
                    Task {
                        await store.completeAction(action)
                        let after = FamilyRingsMath.parentRing(viewerItems: store.actions.filter { store.canViewAction($0) })
                        if store.actions.first(where: { $0.id == action.id })?.isDone == true,
                           before.dueNow > 0, after.dueNow == 0, after.cleared > 0 { Haptics.notify(.success) }
                    }
                }
                .buttonStyle(RingsCapsuleStyle(compact: compact))
                .disabled(store.completingActionIDs.contains(action.id))
                .accessibilityIdentifier("today.action.done.\(action.id)")
            }
        }
        .padding(.vertical, 4)
        .sheet(item: $homeworkRef) { HomeworkDetailSheet(homeworkId: $0.id) }
    }
}

struct RingsCapsuleStyle: ButtonStyle {
    var filled = false
    var compact = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(Typography.body.weight(.semibold))
            .foregroundStyle(filled ? Palette.frOnYou : Palette.frYouInk)
            .padding(.horizontal, compact ? 12 : 18).frame(minHeight: 44)
            .background(filled ? Palette.frYou : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(filled ? Color.clear : Palette.frYou, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

struct FamilyRingsKidGrid: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var textSize
    let onOpenHomework: () -> Void
    let onDaily3: () -> Void
    var body: some View {
        if !store.kids.isEmpty {
            // An iPhone can stay horizontally compact in landscape. The grid
            // follows its usable width instead, including safe-area insets.
            LazyVGrid(columns: textSize.isAccessibilitySize ? [GridItem(.flexible())]
                      : [GridItem(.adaptive(minimum: sizeClass == .regular && verticalSizeClass != .compact ? 380 : 300), spacing: 12)], spacing: 12) {
                ForEach(store.kids) { kid in
                    FamilyRingsKidCard(kidID: kid.id, onOpenHomework: onOpenHomework, onDaily3: onDaily3)
                        .id("\(store.me?.id ?? "")|\(store.family?.id ?? "")|\(kid.id)|\(Agenda.todayKey())")
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: textSize.isAccessibilitySize ? 280 : 160), alignment: .leading)], alignment: .leading, spacing: 8) {
                legend("Homework (outer)", Palette.frHw)
                legend("Daily 4 (middle)", Palette.frD3)
                legend("Habits (inner)", Palette.frHab)
                legend("Fams this week", Palette.frFams)
            }.accessibilityIdentifier("today.rings.legend")
        }
    }
    private func legend(_ label: String, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7).accessibilityHidden(true)
            Text(label).font(Typography.caption).foregroundStyle(Palette.frInk2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct FamilyRingsKidCard: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var daily3: Int?
    @State private var daily3Started = false
    @State private var wallet: FamsWallet?
    @State private var loading = true
    @State private var loadedIdentity = ""
    @State private var requestVersion = 0
    @State private var showBrief = false
    @State private var showHabits = false
    @State private var showFams = false
    @State private var showGoals = false
    let kidID: String
    let onOpenHomework: () -> Void
    var interactive = true
    var onDaily3: () -> Void = {}
    var dense = false

    private var kid: Kid? { store.kids.first { $0.id == kidID } }
    private var identity: String { "\(store.me?.id ?? "")|\(store.family?.id ?? "")|\(kidID)|\(Agenda.todayKey())" }
    private var snapshotKey: String { "\(identity)|\(store.attentionUpdatedAt?.timeIntervalSince1970 ?? 0)|\(store.assistanceIdentityVerified)|\(store.needsAuth)" }
    private var validScope: Bool {
        guard !store.needsAuth, let user = store.me, let family = store.family, kid != nil else { return false }
        if user.role == "kid" { return user.kidId == kidID }
        return store.assistanceIdentityVerified && family.parentIds.contains(user.id)
    }
    private var homework: FamilyRingsMath.HomeworkProgress { FamilyRingsMath.homework(kidID: kidID, items: store.homework, today: Agenda.todayKey()) }
    private var habits: FamilyRingsMath.Progress { FamilyRingsMath.habits(kidID: kidID, goals: store.goals, today: Agenda.todayKey()) }
    private var homeworkKnown: Bool { !store.isLoadingHomework && store.homeworkError == nil }
    private var habitsKnown: Bool { store.goalsLoadState == .ready }
    private var snapshotKnown: Bool { loadedIdentity == identity && !loading }
    private var compact: Bool { !textSize.isAccessibilitySize && (dense || sizeClass == .compact || verticalSizeClass == .compact) }
    private var diameter: CGFloat { compact ? (dense ? 112 : 88) : 156 }
    private var d3: Int? { snapshotKnown ? daily3 : nil }
    private var currentWallet: FamsWallet? { snapshotKnown ? wallet : nil }
    private var metrics: [RingMetric?] {
        [homeworkKnown ? RingMetric(id: "homework", value: homework.done, total: homework.total, color: Palette.frHw, label: "Homework") : nil,
         d3.map { RingMetric(id: "daily3", value: $0, total: 4, color: Palette.frD3, label: "Daily 4") },
         habitsKnown ? RingMetric(id: "habits", value: habits.done, total: habits.total, color: Palette.frHab, label: "Habits") : nil]
    }
    private var summary: String {
        var text = "\(kid?.name ?? "Child"): "
        text += homeworkKnown ? "\(FamilyRingsMath.statusChip(homework: homework)). Homework \(homework.done) of \(homework.total) done this week. " : "Homework unavailable. "
        text += d3.map { "Daily 4, \($0) of 4 today. " } ?? "Daily 4 unavailable. "
        text += habitsKnown ? "Habits \(habits.done) of \(habits.total) today. " : "Habits unavailable. "
        if let wallet = currentWallet { text += "\(famsAmount(wallet.balance)) fams, \(famsAmount(wallet.weekly.earned)) of \(famsAmount(wallet.weekly.limit)) this week." }
        return text
    }

    var body: some View {
        if validScope, let kid {
            Card(padding: compact ? (dense ? 20 : 14) : 24) {
                VStack(alignment: .leading, spacing: compact ? 8 : 16) {
                    header(kid)
                    let layout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .center, spacing: 16))
                                                             : AnyLayout(HStackLayout(alignment: .center, spacing: compact ? 12 : 16))
                    layout {
                        Button(action: openBrief) {
                            if loading && !snapshotKnown {
                                Circle().fill(Palette.frCard2).frame(width: diameter, height: diameter).redacted(reason: .placeholder)
                            } else {
                                FamilyRing(style: .kid, diameter: diameter, metrics: metrics, accessibilityText: summary, isButtonContent: interactive).id(identity)
                            }
                        }.buttonStyle(.plain).disabled(!interactive)
                        VStack(alignment: .leading, spacing: compact ? 0 : 10) {
                            metricButton(number: homeworkKnown ? "\(homework.left)" : "—", title: "Homework left", detail: homeworkKnown ? "this week" : "Homework unavailable", color: Palette.frHwInk, id: "homework", action: openHomework)
                            metricButton(number: d3.map { "\($0)/4" } ?? "—", title: "Daily 4 today", detail: dailyStatus, color: Palette.frD3Ink, id: "daily3", action: onDaily3)
                            metricButton(number: habitsKnown && habits.total > 0 ? "\(habits.done)/\(habits.total)" : "—", title: "Habits today", detail: habitStatus, color: Palette.frHabInk, id: "habits", action: openHabits)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if dense { Spacer(minLength: 0) }
                    Divider().overlay(Palette.frRule)
                    famsRow
                }
                .frame(maxHeight: dense ? .infinity : nil, alignment: .top)
            }
            .contentShape(Rectangle())
            .onTapGesture { openBrief() }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(summary)
            .accessibilityIdentifier("today.kidcard.\(kidID)")
            .accessibilityAction { openBrief() }
            .accessibilityAction(named: "Open homework") { openHomework() }
            .accessibilityAction(named: "Check habits") { openHabits() }
            .accessibilityAction(named: "Daily 4") { if interactive { onDaily3() } }
            .accessibilityAction(named: "Open fams") { if interactive { showFams = true } }
            .task(id: snapshotKey) { await loadSnapshot() }
            .onReceive(NotificationCenter.default.publisher(for: .famsRewardsChanged)) { _ in Task { await loadSnapshot() } }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await loadSnapshot() } } }
            .sheet(isPresented: $showBrief) { ParentAttentionSheet(childID: kidID) }
            .sheet(isPresented: $showHabits) { FamilyRingsHabitsSheet(kidID: kidID) }
            .sheet(isPresented: $showGoals, onDismiss: { Task { await store.loadGoals() } }) { RingsWebSheet(title: "Goals", path: "/?tab=goals") }
            .sheet(isPresented: $showFams, onDismiss: { Task { await loadSnapshot() } }) {
                if store.isParent { RingsWebSheet(title: kid.name, path: childPath) }
                else { NavigationStack { FamsJourneyScreen(kidId: kidID, name: kid.name) } }
            }
            .onChange(of: identity) { _, _ in clearSnapshotAndRoutes() }
            .onChange(of: validScope) { _, valid in if !valid { clearSnapshotAndRoutes() } }
        }
    }
    private var childPath: String {
        var components = URLComponents(); components.path = "/"
        components.queryItems = [URLQueryItem(name: "child", value: kidID)]
        return components.string ?? "/"
    }
    private var dailyStatus: String {
        if loading { return "Loading…" }
        guard let d3 else { return "Daily 4 unavailable" }
        if d3 == 4 { return "Done ✓" }
        return d3 > 0 || daily3Started ? "In progress" : "Not started"
    }
    private var habitStatus: String {
        switch store.goalsLoadState {
        case .idle, .loading: return "Loading habits…"
        case .error: return "Habits unavailable"
        case .ready: return habits.total == 0 ? "No habits yet · Set a first habit" : habits.done == habits.total ? "Done ✓" : "Check in"
        }
    }
    private func header(_ kid: Kid) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { name(kid); Spacer(minLength: 4); chip }
            VStack(alignment: .leading, spacing: 8) { name(kid); chip }
        }
    }
    private func name(_ kid: Kid) -> some View {
        Button(action: openBrief) {
            HStack(spacing: 10) { KidProfileAvatar(kid: kid, size: compact ? 28 : 34); Text(kid.name).font(compact ? Theme.font(18, weight: .bold, relativeTo: .title3) : Typography.kidName).foregroundStyle(Palette.frInk) }
                .frame(minHeight: 44)
        }.buttonStyle(.plain).disabled(!interactive)
    }
    private var chip: some View {
        Text(homeworkKnown ? FamilyRingsMath.statusChip(homework: homework) : "Homework unavailable")
            .font(compact ? Theme.font(11, weight: .semibold, relativeTo: .caption) : Typography.chip)
            .foregroundStyle(!homeworkKnown ? Palette.frInk2 : homework.overdue > 0 ? Palette.frDanger : homework.dueToday > 0 ? Palette.frHwInk : Palette.frD3Ink)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(!homeworkKnown ? Palette.frCard2 : homework.overdue > 0 ? Palette.frDangerSoft : homework.dueToday > 0 ? Palette.frHwSoft : Palette.frD3Soft, in: Capsule())
    }
    private func metricButton(number: String, title: String, detail: String, color: Color, id: String, action: @escaping () -> Void) -> some View {
        Button { if interactive { action() } } label: {
            let layout = compact && !textSize.isAccessibilitySize
                ? AnyLayout(HStackLayout(alignment: .center, spacing: 8))
                : AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            layout {
                Text(number).font(compact ? Typography.statNumber : Typography.statNumeralRegular)
                    .tracking(-0.8).monospacedDigit().foregroundStyle(color)
                    .frame(minWidth: compact && !textSize.isAccessibilitySize ? 40 : nil, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Typography.label).foregroundStyle(Palette.frInk2)
                    Text(detail).font(Typography.caption).foregroundStyle(color)
                }
            }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .contentShape(Rectangle())   // the whole row, not just its text
        }.buttonStyle(.plain).disabled(!interactive)
            .accessibilityIdentifier("today.kidcard.\(kidID).\(id)")
    }
    @ViewBuilder private var famsRow: some View {
        Button { if interactive { showFams = true } } label: {
            if let wallet = currentWallet {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { balance(wallet); weeklyBar(wallet); weekText(wallet) }
                    VStack(alignment: .leading, spacing: 8) { balance(wallet); weeklyBar(wallet); weekText(wallet) }
                }
            } else {
                Text(loading ? "Loading fams…" : "Fams unavailable").font(Typography.label).foregroundStyle(Palette.frInk2)
            }
        }.buttonStyle(.plain).frame(minHeight: 44).disabled(!interactive)
            .accessibilityIdentifier("today.kidcard.\(kidID).fams")
    }
    private func balance(_ wallet: FamsWallet) -> some View {
        Text("\(famsAmount(wallet.balance)) fams").font(compact ? Typography.itemTitle : Typography.statNumber).monospacedDigit().foregroundStyle(Palette.frInk)
    }
    private func weeklyBar(_ wallet: FamsWallet) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.frFamsSoft)
                Capsule().fill(Palette.frFams).frame(width: proxy.size.width * wallet.weeklyFraction)
            }
        }.frame(minWidth: 50).frame(height: 8).accessibilityHidden(true)
    }
    private func weekText(_ wallet: FamsWallet) -> some View {
        Text("\(famsAmount(wallet.weekly.earned)) of \(famsAmount(wallet.weekly.limit)) this week")
            .font(Typography.caption).foregroundStyle(Palette.frInk2).fixedSize(horizontal: false, vertical: true)
    }
    private func openHomework() { guard interactive else { return }; store.pendingHomeworkKidID = kidID; onOpenHomework() }
    private func openBrief() { guard interactive else { return }; if store.isParent { showBrief = true } else { openHomework() } }
    private func openHabits() { guard interactive else { return }; if habitsKnown && habits.total == 0 { showGoals = true } else { showHabits = true } }
    private func clearSnapshotAndRoutes() {
        requestVersion += 1; daily3 = nil; wallet = nil; loadedIdentity = ""; loading = true
        showBrief = false; showHabits = false; showGoals = false; showFams = false
    }
    @MainActor private func loadSnapshot() async {
        requestVersion += 1
        let version = requestVersion
        let scope = identity
        let day = Agenda.todayKey()
        guard validScope, let user = store.me, let family = store.family else { clearSnapshotAndRoutes(); return }
        let cookies = HTTPCookieStorage.shared.cookies(for: Config.baseURL) ?? []
        guard cookies.contains(where: { $0.name == "fam_sess" }) else {
            daily3 = nil; wallet = nil; loadedIdentity = scope; loading = false; return
        }
        let cookie = HTTPCookie.requestHeaderFields(with: cookies)["Cookie"] ?? ""
        if loadedIdentity != scope { daily3 = nil; wallet = nil; loading = true }
        var completed: Int?
        var started = false
        if user.role == "kid" {
            let payload = try? await APIClient.shared.dailyFiveProgress(date: day, cookie: cookie)
            completed = FamilyRingsMath.daily3(payload, today: day)?.done
            started = ["news", "quote", "word", "puzzle", "bt"].contains { payload?.parts[$0]?.status == "started" }
        } else {
            let result = try? await APIClient.shared.childDailyFiveProgress(kidID: kidID, date: day, cookie: cookie)
            completed = result?.daily3Completed
            started = (result?.daily3Started ?? 0) > 0
        }
        guard !Task.isCancelled, version == requestVersion, identity == scope, validScope,
              store.me?.id == user.id, store.family?.id == family.id, Agenda.todayKey() == day else { return }
        let loadedWallet = try? await APIClient.shared.famsWallet(kidId: kidID)
        guard !Task.isCancelled, version == requestVersion, identity == scope, validScope,
              store.me?.id == user.id, store.family?.id == family.id, Agenda.todayKey() == day else { return }
        daily3 = completed; daily3Started = started
        wallet = loadedWallet?.kidId == kidID ? loadedWallet : nil
        loadedIdentity = scope; loading = false
    }
}

struct FamilyRingsHabitsSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var showGoals = false
    let kidID: String
    private var visible: [Goal] { store.goals.filter { $0.kidId == kidID && $0.type == "habit" && (store.isParent || store.me?.kidId == kidID) } }
    var body: some View {
        NavigationStack {
            List {
                if store.goalsLoadState == .loading || store.goalsLoadState == .idle { ProgressView("Loading habits…") }
                if let error = store.goalsError { Text(error).foregroundStyle(Palette.frDanger); Button("Try again") { Task { await store.loadGoals() } } }
                ForEach(visible) { goal in
                    Toggle(isOn: Binding(get: { goal.checks?.contains(Agenda.todayKey()) == true }, set: { _ in
                        Haptics.selection()
                        Task { await store.toggleGoalCheck(goal) }
                    })) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(goal.title).font(Typography.itemTitle)
                            Text("\(FamilyRingsMath.habitStreak(goal: goal, today: Agenda.todayKey()))-day streak")
                                .font(Typography.caption).foregroundStyle(Palette.frInk2)
                        }
                    }
                    .disabled(store.goalMutationIDs.contains(goal.id))
                    .accessibilityIdentifier("today.habit.\(goal.id)")
                }
                if visible.isEmpty && store.goalsLoadState == .ready { Text("No habits yet. Set a first habit.").foregroundStyle(Palette.frInk2) }
                Button("All goals") { showGoals = true }.frame(minHeight: 44)
            }
            .scrollContentBackground(.hidden).background(Palette.frBg)
            .navigationTitle("Habits today")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $showGoals, onDismiss: { Task { await store.loadGoals() } }) { RingsWebSheet(title: "Goals", path: "/?tab=goals") }
        }.tint(Palette.frYou)
    }
}

struct RingsWebSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let path: String
    var body: some View {
        NavigationStack {
            HybridWebView(path: path, isEmbedded: true).navigationTitle(title)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.tint(Palette.frYou)
    }
}

struct FamilyRingsActionsSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var saving = false
    private var active: [FamilyAction] { ActionQueue.sortActive(store.actions.filter { store.canViewAction($0) }) }
    var body: some View {
        NavigationStack {
            List {
                if store.isParent {
                    Section("New family action") {
                        TextField("What needs doing?", text: $title).accessibilityIdentifier("today.action.newTitle")
                        Button(saving ? "Adding…" : "Add action") {
                            saving = true
                            Task { if await store.createFamilyAction(title: title, dueDate: nil) { title = "" }; saving = false }
                        }.disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .accessibilityIdentifier("today.action.add")
                    }
                }
                if let error = store.actionError { Text(error).foregroundStyle(Palette.frDanger) }
                Section("Actions") {
                    ForEach(active) { action in
                        VStack(alignment: .leading, spacing: 8) {
                            FamilyRingsActionRow(action: action)
                            HStack {
                                if store.canSnoozeAction(action) {
                                    Menu("Snooze", systemImage: "clock.arrow.circlepath") {
                                        ForEach(ActionSnoozePreset.allCases) { preset in Button(preset.label) { Task { await store.snoozeAction(action, preset: preset) } } }
                                    }.frame(minHeight: 44).buttonStyle(.borderless)
                                        .accessibilityIdentifier("today.action.snooze.\(action.id)")
                                }
                                Spacer()
                                if store.isParent {
                                    Button("Delete", systemImage: "trash", role: .destructive) { Task { await store.deleteFamilyAction(action) } }
                                        .frame(minHeight: 44).buttonStyle(.borderless)
                                        .disabled(store.completingActionIDs.contains(action.id))
                                        .accessibilityIdentifier("today.action.delete.\(action.id)")
                                }
                            }
                        }
                    }
                    if active.isEmpty { Text("All clear. Nothing waiting right now.") }
                }
            }
            .scrollContentBackground(.hidden).background(Palette.frBg)
            .navigationTitle("Family actions")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close") { dismiss() } } }
        }.tint(Palette.frYou)
    }
}
