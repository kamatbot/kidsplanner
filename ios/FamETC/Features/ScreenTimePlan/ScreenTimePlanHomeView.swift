import SwiftUI

// Parent Home on the Screen Time plan (docs/SCREEN-TIME-ONLY-PLAN.md §4.1).
// Top to bottom: [alert / sign-in banners are mounted by RootView, not here] →
// setup checklist while any kid is unfinished → one card per kid (neutral, evidence-based
// status + Pause / Rules) → more-time requests → a quiet, dismissible upgrade card.
// Status text comes from `ScreenTimeKidStatus`, which never reads "On" without the device's
// own health report (docs/SCREEN-TIME-UX.md, 2026-09-30 owner decisions).

struct ScreenTimePlanHomeView: View {
    /// Opens the kid's rules: a sheet on compact widths, the detail column on regular widths.
    let openRules: (String) -> Void
    /// Jumps to Family (to add the first kid).
    var openFamily: (() -> Void)? = nil

    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @AppStorage("fam_st_upgrade_snoozed_until") private var upgradeSnoozedUntil: Double = 0
    @State private var showUpgrade = false
    @State private var usageByKid: [String: ScreenTimeUsageDay] = [:]
    private var service: ScreenTimeService { .shared }

    /// Kids whose device setup still has a step to do (evidence from the overview).
    private var unfinishedKidIds: [String] {
        store.kids.compactMap { kid in
            guard let state = service.state(for: kid.id) else { return nil }
            return DeviceSetupProgress(state: state).isComplete ? nil : kid.id
        }
    }

    /// Re-run the usage load when kids or their devices change.
    private var usageKey: String {
        store.kids.map { "\($0.id):\(service.state(for: $0.id)?.devices.count ?? -1)" }.joined(separator: ",")
    }

    var body: some View {
        PlanPage(maxWidth: 900) {
            if store.kids.isEmpty {
                addKidCard
            } else if service.overview == nil {
                loadingCard
            } else {
                let unfinished = unfinishedKidIds
                if !unfinished.isEmpty {
                    VStack(alignment: .leading, spacing: Space.sm) {
                        MicroLabel(text: "Finish setting up")
                            .accessibilityAddTraits(.isHeader)
                        DeviceSetupChecklistView(kidIds: unfinished, embedded: true, onOpenRules: openRules)
                    }
                }
                kidCards
                requestsCard
            }
            upgradeCard
        }
        .navigationTitle("Home")
        .navigationBarTitleDisplayMode(.large)
        .refreshable {
            await service.loadOverview()
            await store.refreshKidRequests()
            await loadUsage()
        }
        .task { if service.overview == nil { await service.loadOverview() } }
        .task(id: usageKey) { await loadUsage() }
        .sheet(isPresented: $showUpgrade) { UpgradeView().tint(Palette.frYou) }
        .accessibilityIdentifier("screentimeplan.home")
    }

    // MARK: Cards

    private var loadingCard: some View {
        Card(padding: Space.lg) {
            if let message = service.lastError {
                VStack(alignment: .leading, spacing: Space.sm) {
                    PlanErrorLine(message: message)
                    PlanButton(title: "Try again", systemImage: "arrow.clockwise") {
                        Task { await service.loadOverview() }
                    }
                }
            } else {
                HStack(spacing: Space.sm) {
                    ProgressView()
                    Text("Loading Screen Time…").font(Typography.body).foregroundStyle(Palette.textSecond)
                }
            }
        }
    }

    private var addKidCard: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                Text("Add your first kid")
                    .font(Typography.title)
                    .foregroundStyle(Palette.text)
                Text("Each kid gets their own sign-in on their own iPhone or iPad. Add a profile in Family, then set up their device.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                if let openFamily {
                    PlanButton(title: "Go to Family", systemImage: "person.2", style: .prominent, action: openFamily)
                        .padding(.top, Space.xs)
                }
            }
        }
    }

    private var kidCards: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: Space.lg, alignment: .top)],
                  alignment: .leading, spacing: Space.lg) {
            ForEach(store.kids) { kid in
                KidHomeCard(kid: kid, usageDay: usageByKid[kid.id]) { openRules(kid.id) }
            }
        }
    }

    @ViewBuilder private var requestsCard: some View {
        let waiting = service.pendingRequests.compactMap { request -> (Kid, ScreenTimeRequest)? in
            guard let kid = store.kids.first(where: { $0.id == request.kidId }) else { return nil }
            return (kid, request)
        }
        if !waiting.isEmpty {
            MoreTimeRequestsCard(items: waiting.map { MoreTimeItem(kid: $0.0, request: $0.1) })
        }
    }

    @ViewBuilder private var upgradeCard: some View {
        if store.productPlan == .screenTime, !UpgradePrompt.isSnoozed(until: upgradeSnoozedUntil) {
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    Text("Want the school calendar, homework and family chat too?")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Get the whole Fam ETC. Screen Time stays just as it is.")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Space.sm) { upgradeButtons }
                        VStack(alignment: .leading, spacing: Space.xs) { upgradeButtons }
                    }
                    .padding(.top, Space.xs)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("screentimeplan.upgradeCard")
        }
    }

    @ViewBuilder private var upgradeButtons: some View {
        PlanButton(title: "Get the whole Fam ETC", systemImage: "sparkles") { showUpgrade = true }
            .accessibilityIdentifier("screentimeplan.upgradeCard.open")
        PlanButton(title: "Not now", style: .quiet) {
            upgradeSnoozedUntil = UpgradePrompt.snoozedUntil()
        }
        .accessibilityHint("Hides this for 30 days")
        .accessibilityIdentifier("screentimeplan.upgradeCard.dismiss")
    }

    // MARK: Usage

    /// Today's device reports for kids with a device (a status line, never a guess).
    private func loadUsage() async {
        let account = store.me?.id
        for kid in store.kids {
            guard let state = service.state(for: kid.id), state.policy.enabled, !state.devices.isEmpty else {
                usageByKid[kid.id] = nil
                continue
            }
            if let day = try? await service.usage(kidId: kid.id, days: 1).days.first, account == store.me?.id {
                usageByKid[kid.id] = day
            }
        }
    }
}

// MARK: - One kid

private struct KidHomeCard: View {
    let kid: Kid
    let usageDay: ScreenTimeUsageDay?
    let onRules: () -> Void

    @Environment(AppStore.self) private var store
    @State private var pausing = false
    @State private var granting = false
    @State private var error: String?
    private var service: ScreenTimeService { .shared }

    private var first: String { DealWords.firstName(kid.name) ?? kid.name }
    private var state: ScreenTimeKidState? { service.state(for: kid.id) }
    private var status: ScreenTimeKidStatus { ScreenTimeKidStatus(state: state) }

    private var hasRules: Bool {
        guard let policy = state?.policy else { return false }
        return !policy.limits.isEmpty || !policy.downtime.isEmpty
    }

    /// "Bedtime 9:00 PM–7:00 AM · 2 h a day" — what the rules say, from the saved policy.
    private var rulesLine: String {
        guard let policy = state?.policy else { return "Loading…" }
        var parts: [String] = []
        if let bed = policy.downtime.first(where: { $0.id == ScreenTimeFormat.bedtimeID }) {
            parts.append("Bedtime \(ScreenTimeFormat.time(bed.start))–\(ScreenTimeFormat.time(bed.end))")
        }
        if let total = policy.limits.first(where: \.isTotal) { parts.append(ScreenTimeFormat.allowance(total)) }
        if parts.isEmpty { return hasRules ? "Your own rules are saved" : "No rules yet" }
        return parts.joined(separator: " · ")
    }

    /// The next action in plain words, by status. Never claims protection without the
    /// device's own report, and never guesses why a device went quiet.
    private var nextLine: String? {
        switch status {
        case .notSetUp: return "Choose bedtime and daily time to begin."
        case .off: return "Screen Time is off. Your rules are saved."
        case .waiting: return "Saved. Set up \(first)'s device to start."
        case .finishSetup: return "Finish setup on \(first)'s device."
        case .unverified: return "Waiting for \(first)'s device to confirm the rules."
        case .turnedOff: return "Reconnect Screen Time access on \(first)'s device."
        case .mayBeRemoved, .notCheckingIn: return "Can't reach \(first)'s device. It may be off or offline."
        case .paused, .pauseRequested, .family, .cooperative: return nil
        }
    }

    /// Today's reported time on the device, only for a single recent device.
    private var usageLine: String? {
        guard let state, state.policy.enabled else { return nil }
        let recent = ScreenTimeFormat.statusDevices(state.devices)
        guard let device = recent.first else { return nil }
        if recent.count > 1 { return "\(recent.count) devices · open Rules for each device's time" }
        let usage = usageDay?.date == ScreenTimeSchedule.dayString(Date())
            ? usageDay?.devices?.first(where: { $0.deviceId == device.id }) : nil
        return ScreenTimeEssentialsPresentation.remaining(usage)
    }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(alignment: .center, spacing: Space.md) {
                    KidProfileAvatar(kid: kid, size: 44)
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text(kid.name)
                            .font(Typography.kidName)
                            .foregroundStyle(Palette.text)
                            .lineLimit(1)
                        ScreenTimeChip(text: status.chipText, ink: status.colors.ink, soft: status.colors.soft)
                    }
                    Spacer(minLength: 0)
                }
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(rulesLine)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                        .monospacedDigit()
                        .fixedSize(horizontal: false, vertical: true)
                    if let nextLine {
                        Text(nextLine)
                            .font(Typography.label)
                            .foregroundStyle(Palette.textSecond)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let usageLine {
                        Text(usageLine)
                            .font(Typography.label)
                            .foregroundStyle(Palette.textSecond)
                            .monospacedDigit()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
                if let error { PlanErrorLine(message: error) }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Space.sm) { actions }
                    VStack(alignment: .leading, spacing: Space.sm) { actions }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(kid.name), Screen Time")
        .accessibilityValue(status.text)
        .accessibilityIdentifier("screentimeplan.kid.\(kid.id)")
    }

    // MARK: Actions

    @ViewBuilder private var actions: some View {
        pauseControl
        bonusControl
        PlanButton(title: "Rules", systemImage: "slider.horizontal.3", action: onRules)
            .accessibilityHint("Opens \(first)'s Screen Time rules")
            .accessibilityIdentifier("screentimeplan.rules.\(kid.id)")
    }

    /// Pause / Resume, only when Screen Time is on, rules exist and a device is set up
    /// (the same condition as the controls' Pause section).
    @ViewBuilder private var pauseControl: some View {
        if let state, state.policy.enabled, hasRules, !state.devices.isEmpty {
            if ScreenTimeFormat.pauseUntil(state.policy) != nil {
                PlanButton(title: "Resume", systemImage: "play.fill", style: .prominent, busy: pausing) {
                    pause(minutes: 0)
                }
                .accessibilityIdentifier("screentimeplan.resume.\(kid.id)")
            } else {
                Menu {
                    Button("Pause for 1 hour") { pause(minutes: 60) }
                    Button("Pause until tomorrow") { pause(minutes: ScreenTimeFormat.minutesUntilMorning()) }
                } label: {
                    PlanButtonLabel(title: "Pause", systemImage: "pause.fill", busy: pausing)
                }
                .disabled(pausing)
                .accessibilityLabel("Pause \(first)'s devices")
                .accessibilityIdentifier("screentimeplan.pause.\(kid.id)")
            }
        }
    }

    /// "+15 min" extra time today, only when Screen Time is on and the kid has a daily total
    /// limit to extend (the server answers 409 otherwise).
    @ViewBuilder private var bonusControl: some View {
        if let policy = state?.policy, policy.enabled, policy.limits.contains(where: \.isTotal) {
            PlanButton(title: "+15 min", systemImage: "plus.circle", busy: granting) {
                grantBonus(minutes: 15)
            }
            .accessibilityLabel("Give \(first) 15 more minutes today")
            .accessibilityIdentifier("screentimeplan.bonus.\(kid.id)")
        }
    }

    private func grantBonus(minutes: Int) {
        guard !granting else { return }
        let account = store.me?.id
        Haptics.impact(.light)
        granting = true
        error = nil
        Task {
            do {
                try await service.grantBonus(kidId: kid.id, minutes: minutes)
                if account == store.me?.id { Haptics.notify(.success) }
            } catch {
                if account == store.me?.id { self.error = error.localizedDescription }
            }
            granting = false
        }
    }

    private func pause(minutes: Int) {
        guard !pausing else { return }
        let account = store.me?.id
        Haptics.impact(.light)
        pausing = true
        error = nil
        Task {
            do { try await service.pause(kidId: kid.id, minutes: minutes) } catch {
                if account == store.me?.id { self.error = error.localizedDescription }
            }
            pausing = false
        }
    }
}

// MARK: - More-time requests

private struct MoreTimeItem: Identifiable {
    let kid: Kid
    let request: ScreenTimeRequest
    var id: String { request.id }
}

/// Waiting "more time" requests, answered right on Home. Approving adds the minutes to
/// today only; the Screen Time plan has no fams to spend (docs/SCREEN-TIME-ONLY-PLAN.md D3).
private struct MoreTimeRequestsCard: View {
    let items: [MoreTimeItem]

    @Environment(AppStore.self) private var store
    @State private var deciding: String?
    @State private var error: String?
    private var service: ScreenTimeService { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            MicroLabel(text: "More time")
                .accessibilityAddTraits(.isHeader)
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.lg) {
                    ForEach(items) { item in row(item) }
                    if let error { PlanErrorLine(message: error) }
                    Text("Approving adds the minutes to today only. Bedtime never moves.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
            }
        }
        .accessibilityIdentifier("screentimeplan.requests")
    }

    private func row(_ item: MoreTimeItem) -> some View {
        let name = DealWords.firstName(item.kid.name) ?? item.kid.name
        let r = item.request
        return VStack(alignment: .leading, spacing: Space.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text("⏱️ \(ScreenTimeFormat.moreTimeLine(name: name, minutes: r.minutes, fams: r.fams, plan: store.productPlan))")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                if let note = r.note, !note.isEmpty {
                    Text("“\(note)”")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(ScreenTimeFormat.relative(ScreenTimeFormat.date(r.createdAt)))
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            .accessibilityElement(children: .combine)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.sm) { buttons(r) }
                VStack(alignment: .leading, spacing: Space.sm) { buttons(r) }
            }
            .disabled(deciding != nil)
        }
    }

    @ViewBuilder
    private func buttons(_ r: ScreenTimeRequest) -> some View {
        PlanButton(title: "Approve", systemImage: "checkmark", style: .prominent, busy: deciding == r.id) {
            decide(r, approve: true)
        }
        .accessibilityLabel("Approve \(r.minutes) more minutes")
        .accessibilityIdentifier("screentimeplan.request.approve.\(r.id)")
        PlanButton(title: "Not today") { decide(r, approve: false) }
            .accessibilityLabel("Decline, not today")
            .accessibilityIdentifier("screentimeplan.request.decline.\(r.id)")
    }

    private func decide(_ r: ScreenTimeRequest, approve: Bool) {
        guard deciding == nil else { return }
        let account = store.me?.id
        Haptics.impact(.light)
        deciding = r.id
        error = nil
        Task {
            do {
                if approve {
                    try await service.approveRequest(kidId: r.kidId, requestId: r.id)
                    Haptics.notify(.success)
                } else {
                    try await service.declineRequest(kidId: r.kidId, requestId: r.id)
                }
            } catch {
                if account == store.me?.id {
                    self.error = error.localizedDescription
                    await service.loadOverview()
                }
            }
            deciding = nil
        }
    }
}
