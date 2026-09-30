import SwiftUI
import FamilyControls

// Kid-side Screen Time UX (docs/SCREEN-TIME-PLAN.md "UX" + "Our Screen Time Deal").
// Setup is a deal the kid and a grown-up make together on the kid's device. A kid
// only ever sees their own policy and deal — never alerts, other kids' rules or
// other devices.

// MARK: - Deal words + helpers

/// Kid-friendly wording and family names shared by the kid card, the deal flow and
/// the read-only contract (also shown to parents).
enum DealWords {
    static let kidPromises: [(emoji: String, text: String)] = [
        ("🔌", "Phone charges outside my room at night"),
        ("⏰", "I'll stop when the timer says so"),
        ("🙋", "I'll ask before new apps"),
        ("📚", "Homework before games"),
        ("🍽️", "No phones at dinner"),
    ]
    static let parentPromises: [(emoji: String, text: String)] = [
        ("⏳", "I'll give a 10-minute heads-up before bedtime"),
        ("📅", "We'll review this together in a month"),
        ("📵", "I'll put my phone away at dinner too"),
        ("🎉", "Extra time for special days — just ask"),
    ]
    static let stamps = ["🦊", "🐼", "🦄", "🐯", "🐸", "🐙", "🦖", "🐝", "🚀", "⚡️", "🌈", "⚽️"]
    static let maxPromises = 3
    static let maxPromiseLength = 80

    static func emoji(for promise: String) -> String {
        (kidPromises + parentPromises).first { $0.text == promise }?.emoji ?? "✏️"
    }

    /// ("Phone sleeps at 9:00 PM", "and wakes up at 7:00 AM"), nil when bedtime is off.
    static func bedtime(_ r: ScreenTimeAgreementRules) -> (title: String, detail: String)? {
        guard let start = r.bedStart, let end = r.bedEnd else { return nil }
        return ("Phone sleeps at \(ScreenTimeFormat.time(start))", "and wakes up at \(ScreenTimeFormat.time(end))")
    }

    /// ("2 h a day", "on school days · 3 h on weekends"), nil when daily time is off.
    static func daily(_ r: ScreenTimeAgreementRules) -> (title: String, detail: String)? {
        guard let school = r.school else { return nil }
        let weekend = r.weekend ?? school
        let title = "\(ScreenTimeFormat.minutes(school)) a day"
        return weekend == school ? (title, "every day") : (title, "on school days · \(ScreenTimeFormat.minutes(weekend)) on weekends")
    }

    /// "2 h a day on school days, 3 h on weekends".
    static func dailyLine(_ r: ScreenTimeAgreementRules) -> String? {
        guard let school = r.school else { return nil }
        let weekend = r.weekend ?? school
        let s = ScreenTimeFormat.minutes(school)
        return weekend == school ? "\(s) a day" : "\(s) a day on school days, \(ScreenTimeFormat.minutes(weekend)) on weekends"
    }

    /// "Sep 27", nil for a deal not saved yet.
    static func signedDate(_ deal: ScreenTimeAgreement) -> String? {
        ScreenTimeFormat.date(deal.signedAt)?.formatted(.dateTime.month(.abbreviated).day())
    }

    static func firstName(_ name: String?) -> String? {
        name?.split(separator: " ").first.map(String.init)
    }

    /// The signed-in kid's first name.
    @MainActor static func kidName(_ store: AppStore) -> String {
        let name = store.kids.first { $0.id == store.me?.kidId }?.name ?? store.me?.name
        return firstName(name) ?? "You"
    }

    @MainActor static func parentNames(_ store: AppStore) -> [String] {
        store.family?.parents?.compactMap { firstName($0.name) } ?? []
    }

    /// "Kate and Tom" / "your grown-ups".
    static func joined(_ names: [String]) -> String {
        names.isEmpty ? "your grown-ups" : (ListFormatter.localizedString(byJoining: names))
    }

    static func fairness(_ parents: [String]) -> String {
        "If Screen Time access changes, \(joined(parents)) gets an update so you can check it together."
    }
}

/// Tall capsule primary button — big tap target for the deal flow.
private struct BigButton: View {
    let title: String
    var systemImage: String? = nil
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.impact(.medium)
            action()
        } label: {
            HStack(spacing: Space.sm) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
            }
            .font(Typography.cardTitle)
            .foregroundStyle(enabled ? Palette.frOnYou : Palette.frInk2)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(enabled ? Palette.frYou : Palette.frRule, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

// MARK: - Kid Today card

struct ScreenTimeKidCard: View {
    @Environment(AppStore.self) private var store
    @State private var setup: SetupKind?
    @State private var showDeal = false
    @State private var showMoreTime = false
    @State private var checkingDevice = false
    private var service: ScreenTimeService { .shared }

    private struct SetupKind: Identifiable {
        let makeDeal: Bool
        var id: Bool { makeDeal }
    }

    private var isOn: Bool { service.isEnrolled && service.authState == .approved }
    private var deviceName: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "phone" }

    var body: some View {
        // Not set up (off, never enrolled here) → nothing. Off with this device
        // enrolled → the quiet Off card (docs/SCREEN-TIME-UX.md §1).
        Group {
        if !store.isParent, !store.needsAuth, let policy = service.policy, policy.enabled || service.isEnrolled {
            card(policy)
                // The deal is made together on the kid's device — mostly an iPad — so
                // it takes the whole screen on every size (§3). "Not now" always closes it.
                .fullScreenCover(item: $setup) { ScreenTimeKidSetupSheet(makeDeal: $0.makeDeal) }
                // The signed deal is read together on the kid's iPad: full screen, Done closes it.
                .fullScreenCover(isPresented: $showDeal) { ScreenTimeKidRulesSheet() }
                .sheet(isPresented: $showMoreTime) { ScreenTimeMoreTimeSheet() }
                .onChange(of: store.me?.id) { _, _ in setup = nil; showDeal = false; showMoreTime = false }
        }
        }
        .modifier(ScreenTimeEssentialAppsDraftGuard())
    }

    @ViewBuilder
    private func card(_ policy: ScreenTimePolicy) -> some View {
        if isSharedDeviceMismatch {
            sharedDeviceNotice
        } else if policy.enabled {
            content(policy)
        } else {
            offCard
        }
    }

    /// This device is enrolled for a different kid than who's signed in — a shared iPad,
    /// or moved without re-enrolling.
    private var isSharedDeviceMismatch: Bool {
        guard service.isEnrolled, let enrolledKidId = service.enrolledKidId else { return false }
        return enrolledKidId != store.me?.kidId
    }

    /// A calm notice instead of the usual card, no button — only a parent can move the device.
    private var sharedDeviceNotice: some View {
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        let whoPossessive = service.enrolledKidName.map { "\($0)'s" } ?? "another kid's"
        return Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .top) {
                    MicroLabel(text: "Screen Time")
                    Spacer()
                    Image(systemName: "person.2")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Palette.frInk2)
                        .accessibilityHidden(true)
                }
                Text("This \(device) follows \(whoPossessive) Screen Time rules. Ask a parent to move it to you.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("screen-time-kid-shared-device")
        }
    }

    /// A grown-up turned Screen Time off: one calm line, no button, nothing red.
    private var offCard: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .top) {
                    MicroLabel(text: "Screen Time")
                    Spacer()
                    Image(systemName: "pause.circle")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Palette.frInk2)
                        .accessibilityHidden(true)
                }
                Text(service.currentDeal == nil
                     ? "Screen Time is off right now — your grown-ups turned it off."
                     : "Screen Time is off right now — your grown-ups turned it off. Your deal is saved.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("screen-time-kid-off")
        }
    }

    @ViewBuilder
    private func content(_ policy: ScreenTimePolicy) -> some View {
        let deal = service.currentDeal
        let needsDeal = deal == nil || service.agreementIsStale
        if !isOn && service.isEnrolled {
            // Revoked on this device.
            prompt(title: "Screen Time needs a check",
                   pitch: "Screen Time access changed on this device. Check it together with a grown-up.",
                   button: "Turn it back on", icon: "arrow.clockwise", bright: false) { setup = SetupKind(makeDeal: needsDeal) }
        } else if !isOn && !needsDeal {
            // Deal already signed (e.g. on another device): just turn it on here.
            prompt(title: "Turn on Screen Time on this \(deviceName)",
                   pitch: "Your deal is already signed. Check the device permissions with your grown-up.",
                   button: "Turn it on", icon: "hourglass", bright: false) { setup = SetupKind(makeDeal: false) }
        } else if deal == nil {
            prompt(title: "Make our Screen Time deal 🤝",
                   pitch: "You and your grown-up agree on the rules — and you both make promises.",
                   button: "Let's make it", icon: "hand.wave.fill", bright: true) { setup = SetupKind(makeDeal: true) }
        } else if needsDeal {
            prompt(title: "Your rules changed — renew your deal together",
                   pitch: "Your grown-ups updated bedtime or daily time. Sit down together and sign the new version.",
                   button: "Renew our deal", icon: "arrow.triangle.2.circlepath", bright: true) { setup = SetupKind(makeDeal: true) }
        } else if service.needsTotalSelection || service.needsUsageSelection {
            prompt(title: "Finish setup with your grown-up",
                   pitch: service.needsTotalSelection ? "Choose the apps and categories that your daily time will measure."
                                                      : "Choose apps and categories to measure screen time on this device.",
                   button: "Finish setup", icon: "checkmark.circle", bright: false) { setup = SetupKind(makeDeal: false) }
        } else if let deal {
            // Re-read every minute so "Bedtime now" / "used up" follow the clock.
            TimelineView(.everyMinute) { context in
                signedCard(deal, policy: policy, now: context.date)
            }
        }
    }

    /// The one status line on the signed deal card, first match wins (§1 precedence):
    /// paused → inside a downtime window → today's daily time used up.
    private enum DealStatus {
        case paused(Date)
        case pauseRequested(Date)
        case downtime(name: String, backAt: String)
        case usedUp
    }

    private func dealStatus(_ policy: ScreenTimePolicy, now: Date) -> DealStatus? {
        if let until = ScreenTimeFormat.pauseUntil(policy) {
            return ScreenTimeEnforcer.shared.shieldReasons[ScreenTimeSchedule.pauseStore] != nil ? .paused(until) : .pauseRequested(until)
        }
        if let window = policy.downtime.first(where: {
            ScreenTimeSchedule.isInsideWindow(start: $0.start, end: $0.end, days: $0.days, now: now)
        }) {
            let name = window.name.trimmingCharacters(in: .whitespacesAndNewlines)
            return .downtime(name: name.isEmpty ? "Bedtime" : name, backAt: ScreenTimeFormat.time(window.end))
        }
        // Device-local: the monitor records the moment the whole-device limit shielded.
        // A grown-up's "more time" today lifts it until the new allowance is reached.
        // Only while the daily-time shield is really on (a raised allowance clears it).
        if ScreenTimeEnforcer.shared.shieldReasons[ScreenTimeSchedule.limitStore("total")] != nil,
           let usage = ScreenTimeEnforcer.shared.todayUsage(now: now), usage.limitReachedAt != nil,
           let allowance = ScreenTimeSchedule.todayAllowance(policy, now: now),
           service.bonusToday == nil || usage.minutes >= allowance {
            return .usedUp
        }
        return nil
    }

    @ViewBuilder
    private func statusLine(_ status: DealStatus) -> some View {
        switch status {
        case .paused(let until):
            Label("Paused by a grown-up until \(ScreenTimeFormat.clock(until))", systemImage: "pause.circle.fill")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frYouInk)
                .monospacedDigit()
        case .pauseRequested(let until):
            Label("A grown-up requested a pause until \(ScreenTimeFormat.clock(until)) · checking this device", systemImage: "clock")
                .font(Typography.body.weight(.semibold)).foregroundStyle(Palette.frFamsInk)
                .monospacedDigit().fixedSize(horizontal: false, vertical: true)
        case .downtime(let name, let backAt):
            Label("\(name) now — schedule ends at \(backAt)", systemImage: "moon.zzz.fill")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frYouInk)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        case .usedUp:
            Label("Daily time is used up — back tomorrow", systemImage: "hourglass.bottomhalf.filled")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frHwInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func prompt(title: String, pitch: String, button: String, icon: String, bright: Bool,
                        action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: Space.md) {
            HStack(alignment: .top) {
                MicroLabel(text: "Screen Time")
                Spacer()
                Image(systemName: bright ? "sparkles" : "hourglass")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(bright ? Palette.frHab : Palette.frInk2)
                    .accessibilityHidden(true)
            }
            Text(title)
                .font(bright ? Typography.title : Typography.cardTitle)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            Text(pitch)
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            BigButton(title: button, systemImage: icon, action: action)
                .padding(.top, Space.xs)
        }
        .padding(Space.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .fill(bright
                      ? AnyShapeStyle(LinearGradient(colors: [Palette.frYouSoft, Palette.frHabSoft, Palette.frHwSoft],
                                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                      : AnyShapeStyle(Palette.frCard))
                .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                    .stroke(bright ? Palette.frYou.opacity(0.25) : Palette.frRule, lineWidth: 1))
        }
    }

    private func signedCard(_ deal: ScreenTimeAgreement, policy: ScreenTimePolicy, now: Date) -> some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack {
                    MicroLabel(text: "Our deal")
                    Spacer()
                    Text("🤝").font(.title3).accessibilityHidden(true)
                }
                HStack(spacing: Space.sm) {
                    stampPill(deal.kidStamp, DealWords.kidName(store))
                    stampPill("✍️", deal.parentSigner)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Signed by \(DealWords.kidName(store)) and \(deal.parentSigner)")
                if let status = dealStatus(policy, now: now) {
                    statusLine(status)
                }
                if let bed = DealWords.bedtime(deal.rules) {
                    Label(bed.title, systemImage: "moon.stars.fill")
                        .font(Typography.body).foregroundStyle(Palette.text).monospacedDigit()
                }
                if let daily = DealWords.dailyLine(deal.rules) {
                    Label(daily, systemImage: "hourglass")
                        .font(Typography.body).foregroundStyle(Palette.text).monospacedDigit()
                }
                if let extra = service.bonusToday {
                    Label("+\(ScreenTimeFormat.minutes(extra)) extra today 🎉", systemImage: "plus.circle.fill")
                        .font(Typography.body.weight(.semibold)).foregroundStyle(Palette.frD3Ink).monospacedDigit()
                }
                if let kid = deal.kidPromises.first {
                    promiseLine(DealWords.kidName(store), kid)
                }
                if let parent = deal.parentPromises.first {
                    promiseLine(deal.parentSigner, parent)
                }
                if service.pendingAgreement != nil {
                    Text("Saving your deal — we'll keep trying.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
                ScreenTimeLocalRemainingView()
                localProtectionLine
                AskMoreTimeButton(isPresented: $showMoreTime)
                Button {
                    Haptics.selection()
                    showDeal = true
                } label: {
                    Label("See our deal", systemImage: "chevron.right")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.frYouInk)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var localProtectionLine: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            if let health = service.deviceHealth {
                Text(health.state == "applied" && health.policyVersion == service.policy?.version
                     ? "Rules registered on this device"
                     : "Protection needs a check on this device")
                    .font(Typography.label.weight(.semibold))
                    .foregroundStyle(health.state == "applied" ? Palette.frD3Ink : Palette.frFamsInk)
            } else {
                Text("Protection hasn't been checked on this device")
                    .font(Typography.label).foregroundStyle(Palette.frFamsInk)
            }
            if let error = service.lastError {
                Text(error).font(Typography.label).foregroundStyle(Palette.frDanger)
            }
            Button {
                guard !checkingDevice else { return }
                checkingDevice = true
                Task { await service.checkThisDevice(); checkingDevice = false }
            } label: {
                HStack(spacing: Space.sm) {
                    if checkingDevice { ProgressView() }
                    Label(checkingDevice ? "Checking this device…" : "Check this device", systemImage: "arrow.clockwise")
                }
                .frame(minHeight: 44)
            }
            .buttonStyle(.borderless).disabled(checkingDevice)
            .accessibilityIdentifier("screentime.kid.check")
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func stampPill(_ emoji: String, _ name: String) -> some View {
        HStack(spacing: Space.xs) {
            Text(emoji)
            Text(name).font(Typography.label.weight(.semibold)).foregroundStyle(Palette.text).lineLimit(1)
        }
        .padding(.horizontal, Space.md)
        .padding(.vertical, 6)
        .background(Palette.frYouSoft, in: Capsule())
    }

    private func promiseLine(_ who: String, _ promise: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
            Text(DealWords.emoji(for: promise)).accessibilityHidden(true)
            Text("**\(who):** \(promise)")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Deal flow (setup sheet)

/// Review rules/promises together → permissions/selection when needed → both
/// signatures → honest verification. Recovery reuses only a current signed deal.
struct ScreenTimeKidSetupSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize

    private typealias Page = ScreenTimeSetupFlow.Stage

    enum TurnOn: Equatable {
        case ready
        /// Family Sharing was refused; offer the without-Family-Sharing mode with this reason.
        case fallback(String)
        case failed(String)
        /// The whole-device limit needs "All Apps & Categories" picked on this device.
        case pickAll
        case on
    }

    enum SaveState: Equatable { case idle, saving, saved, failed(String) }

    @State private var makingDeal: Bool
    @State private var pages: [Page]
    @State private var index = 0
    @State private var forward = true
    @State private var turnOn: TurnOn
    @State private var working = false
    @State private var showPicker = false
    @State private var allSelection = FamilyActivitySelection()
    @State private var pickNote: String?
    @State private var kidPromises: [String]
    @State private var parentPromises: [String]
    @State private var customText = ""
    @State private var writing = false
    @State private var stamp: String?
    @State private var kidSigned = false
    @State private var signer = ""
    @State private var parentSigned = false
    @State private var saveState = SaveState.idle
    @State private var reviewedRules: ScreenTimeAgreementRules?
    @State private var writingParent = false
    @State private var checkingFinish = false
    @State private var flowError: String?
    @State private var showFamilyHelp = false
    @State private var flowGeneration = 0
    @State private var verificationAttempted = false
    private var service: ScreenTimeService { .shared }

    init(makeDeal: Bool = true) {
        let s = ScreenTimeService.shared
        let alreadyOn = s.isEnrolled && s.authState == .approved
        let start: TurnOn = alreadyOn ? (s.needsTotalSelection || s.needsUsageSelection ? .pickAll : .on) : .ready
        let currentSigned = ScreenTimeSetupFlow.currentSignedAgreement(s.agreement, policy: s.policy, hasPendingDraft: s.pendingAgreement != nil)
        let requiresAgreement = ScreenTimeSetupFlow.requiresAgreement(requested: makeDeal, hasCurrentSignedAgreement: currentSigned)
        _pages = State(initialValue: ScreenTimeSetupFlow.stages(requiresAgreement: requiresAgreement, needsPermission: start != .on))
        _makingDeal = State(initialValue: requiresAgreement)
        _turnOn = State(initialValue: start)
        // Renewing keeps last time's promises and stamp; they can change them.
        let old = s.currentDeal
        _kidPromises = State(initialValue: old?.kidPromises ?? [])
        _parentPromises = State(initialValue: old?.parentPromises ?? [])
        _stamp = State(initialValue: old?.kidStamp)
        _signer = State(initialValue: old?.parentSigner ?? "")
    }

    private var page: Page { pages[index] }
    private var kidName: String { DealWords.kidName(store) }
    private var parents: [String] { DealWords.parentNames(store) }
    private var stepCount: Int { pages.count - 1 }

    // Layout by size class, never by device (§3): regular width (iPad full / ⅔) gets a
    // wider column and side-by-side panels instead of a stretched phone column.
    private var regular: Bool { sizeClass == .regular }
    /// Side-by-side panels: regular width and a non-accessibility text size.
    private var wide: Bool { regular && !typeSize.isAccessibilitySize }
    private var column: CGFloat { regular ? 680 : 560 }
    private var titleFont: Font { Theme.font(regular ? 36 : 30, weight: .bold, relativeTo: .largeTitle) }
    private var promisesValid: Bool { ScreenTimeSetupFlow.validPromises(kid: kidPromises, parent: parentPromises) }
    private var currentSignedAgreement: Bool {
        ScreenTimeSetupFlow.currentSignedAgreement(service.agreement, policy: service.policy, hasPendingDraft: service.pendingAgreement != nil)
    }
    private var deviceReady: Bool {
        ScreenTimeSetupFlow.deviceReady(health: service.deviceHealth, policy: service.policy,
                                       authorized: service.isEnrolled && service.authState == .approved
                                       && service.enrolledKidId == store.me?.kidId)
    }
    private var setupComplete: Bool {
        verificationAttempted && !checkingFinish
            && ScreenTimeSetupFlow.complete(requiresAgreement: makingDeal, agreementSaved: saveState == .saved && currentSignedAgreement,
                                            hasCurrentSignedAgreement: currentSignedAgreement, deviceReady: deviceReady)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if page != .verification && stepCount > 1 { progress }
                ScrollView {
                    pageContent
                        .id(page)
                        .transition(pageTransition)
                        .padding(Space.xl)
                        .padding(.top, regular ? Space.xl : 0)
                        .frame(maxWidth: column, alignment: .leading)
                        .frame(maxWidth: .infinity)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDismissesKeyboard(.interactively)
            }
            .safeAreaInset(edge: .bottom) {
                footer
                    .padding(.horizontal, Space.xl)
                    .padding(.vertical, Space.md)
                    .frame(maxWidth: regular ? 480 : 560)
                    .frame(maxWidth: .infinity)
                    .background(Palette.bg.opacity(0.94))
            }
            .background(ScreenBackground())
            .navigationTitle(makingDeal ? "Our Screen Time deal" : "Screen Time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if page != .verification {
                        Button { dismiss() } label: {
                            if regular {
                                HStack(spacing: 6) {
                                    Image(systemName: "xmark").font(.system(size: 15, weight: .semibold))
                                    Text("Not now")
                                }
                            } else {
                                Text("Not now")
                            }
                        }
                        .disabled(working || saveState == .saving)
                        .accessibilityLabel("Not now")
                    }
                }
            }
            .interactiveDismissDisabled(working || saveState == .saving)
            .familyActivityPicker(isPresented: $showPicker, selection: $allSelection)
            .onChange(of: showPicker) { _, open in
                if !open, turnOn == .pickAll { Task { await saveAll() } }
            }
            .onChange(of: kidSigned && parentSigned) { _, both in
                guard both, page == .signatures else { return }
                go(to: .verification)
            }
            .task(id: page) {
                guard page == .verification else { return }
                if makingDeal && saveState == .idle { await saveDeal() }
                else { await verifyDevice() }
            }
            .onChange(of: store.me?.id) { _, _ in clearAndDismissSetup() }
            .onChange(of: store.needsAuth) { _, value in if value { clearAndDismissSetup() } }
            .onChange(of: service.enrolledKidId) { _, value in
                if value != nil && value != store.me?.kidId { clearAndDismissSetup() }
            }
            .onChange(of: ScreenTimeEnforcer.shared.assignmentGeneration) { _, _ in clearAndDismissSetup() }
            .onChange(of: service.policy?.version) { _, _ in
                if let reviewedRules, reviewedRules != ScreenTimeAgreementRules(policy: service.policy ?? .disabled) {
                    requireAgreementReview("The rules changed. Review them together before signing.")
                } else if !makingDeal && service.agreementIsStale {
                    requireAgreementReview("The agreement needs an update. Review the current rules together.")
                }
            }
        }
    }

    private var pageTransition: AnyTransition {
        if reduceMotion { return .opacity }
        return .asymmetric(insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                           removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity))
    }

    private var progress: some View {
        HStack(spacing: 6) {
            ForEach(0..<stepCount, id: \.self) { i in
                Capsule()
                    .fill(i <= index ? Palette.frYou : Palette.frRule)
                    .frame(height: 6)
            }
        }
        .padding(.horizontal, Space.xl)
        .padding(.top, Space.sm)
        .frame(maxWidth: 560)
        .animation(Motion.maybe(Motion.snappy, reduceMotion: reduceMotion), value: index)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(index + 1) of \(stepCount)")
    }

    @ViewBuilder private var pageContent: some View {
        switch page {
        case .review: reviewAgreement
        case .permission: turnOnPage
        case .signatures: sign
        case .verification: celebrate
        }
    }

    // MARK: Navigation

    private func go(to target: Page) {
        guard let i = pages.firstIndex(of: target) else { return }
        if i > index {
            if page == .review {
                guard promisesValid else { return }
                reviewedRules = ScreenTimeAgreementRules(policy: service.policy ?? .disabled)
            }
            if page == .permission { guard turnOn == .on && !working else { return } }
            if target == .verification {
                guard ScreenTimeSetupFlow.canEnterVerification(requiresAgreement: makingDeal,
                                                               hasCurrentSignedAgreement: currentSignedAgreement,
                                                               validPromises: promisesValid, reviewedRules: reviewedRules != nil,
                                                               kidSigned: kidSigned, parentSigned: parentSigned) else { return }
            }
        } else if target == .review {
            kidSigned = false; parentSigned = false; saveState = .idle
        }
        forward = i > index
        writing = false
        customText = ""
        withAnimation(Motion.maybe(Motion.gentle, reduceMotion: reduceMotion)) { index = i }
    }

    private func next() { if index + 1 < pages.count { go(to: pages[index + 1]) } }
    private func back() { if index > 0 { go(to: pages[index - 1]) } }

    @ViewBuilder private var footer: some View {
        switch page {
        case .review:
            nav(title: "Continue with this agreement", enabled: promisesValid && service.policy != nil)
        case .permission:
            nav(title: makingDeal ? "Continue to signatures" : "Check setup", enabled: turnOn == .on && !working)
        case .signatures:
            nav(title: "Waiting for both signatures", enabled: false, showsNext: false)
        case .verification:
            celebrateFooter
        }
    }

    private func clearAndDismissSetup() {
        flowGeneration += 1; checkingFinish = false; verificationAttempted = false
        kidPromises = []; parentPromises = []; stamp = nil; signer = ""
        kidSigned = false; parentSigned = false; reviewedRules = nil
        allSelection = FamilyActivitySelection(); flowError = nil
        dismiss()
    }

    private func requireAgreementReview(_ message: String) {
        flowGeneration += 1; checkingFinish = false; verificationAttempted = false
        makingDeal = true
        pages = ScreenTimeSetupFlow.stages(requiresAgreement: true, needsPermission: turnOn != .on)
        reviewedRules = nil; kidSigned = false; parentSigned = false; saveState = .idle
        flowError = message; index = 0
    }

    private var reviewAgreement: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            plan
            if let flowError { Text(flowError).font(Typography.label).foregroundStyle(Palette.frFamsInk) }
            promisesPage(title: "Your promises", subtitle: "Choose at least one together, up to three.",
                         options: DealWords.kidPromises, promises: $kidPromises,
                         tint: Palette.frYou, soft: Palette.frYouSoft, parent: false)
            promisesPage(title: "Grown-up promises", subtitle: "Grown-up, choose at least one promise to \(kidName), up to three.",
                         options: DealWords.parentPromises, promises: $parentPromises,
                         tint: Palette.frD3, soft: Palette.frD3Soft, parent: true)
        }
    }

    private func nav(title: String, enabled: Bool, showsNext: Bool = true) -> some View {
        HStack(spacing: Space.md) {
            if index > 0 {
                Button { Haptics.selection(); back() } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Palette.text)
                        .frame(width: 54, height: 54)
                        .background(Palette.frCard, in: Circle())
                        .overlay(Circle().stroke(Palette.frRule, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(working)
                .accessibilityLabel("Back")
            }
            if showsNext {
                BigButton(title: title, enabled: enabled, action: next)
            } else {
                Text(kidSigned && parentSigned ? "Sealing the deal…" : "Both of you sign to finish")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: Review rules and promises

    private var plan: some View {
        let policy = service.policy ?? .disabled
        let rules = ScreenTimeAgreementRules(policy: policy)
        let appLimits = policy.limits.filter { !$0.isTotal }
        return VStack(alignment: .leading, spacing: Space.lg) {
            Text("Review your agreement")
                .font(titleFont)
                .foregroundStyle(Palette.text)
            Text("Check the rules together, then each choose a promise. You will both sign before the agreement is saved.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            let bed = DealWords.bedtime(rules)
            let daily = DealWords.daily(rules)
            if wide, let bed, let daily {
                // Side by side when both fit (ideal width 280 each); stacked otherwise.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: Space.lg) {
                        bedtimeCard(bed, fill: true)
                            .frame(minWidth: 0, idealWidth: 280, maxWidth: .infinity)
                        dailyCard(daily, fill: true)
                            .frame(minWidth: 0, idealWidth: 280, maxWidth: .infinity)
                    }
                    .fixedSize(horizontal: false, vertical: true)   // equal-height cards
                    VStack(spacing: Space.lg) {
                        bedtimeCard(bed, fill: false)
                        dailyCard(daily, fill: false)
                    }
                }
            } else {
                if let bed { bedtimeCard(bed, fill: false) }
                if let daily { dailyCard(daily, fill: false) }
            }
            if !appLimits.isEmpty {
                VStack(alignment: .leading, spacing: Space.sm) {
                    MicroLabel(text: "App limits")
                    ForEach(appLimits) { limit in
                        Label(ScreenTimeFormat.limitLine(limit), systemImage: "timer")
                            .font(Typography.body)
                            .foregroundStyle(Palette.text)
                            .monospacedDigit()
                    }
                }
                .padding(Space.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            }
            if rules.bedStart == nil && rules.school == nil && appLimits.isEmpty {
                Text("No rules yet — your grown-ups can add some later. You can still make your promises.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func bedtimeCard(_ bed: (title: String, detail: String), fill: Bool) -> some View {
        ruleCard(icon: "moon.stars.fill", tint: Palette.frYou, soft: Palette.frYouSoft,
                 label: "Bedtime", title: bed.title, detail: bed.detail, fill: fill)
            .accessibilityIdentifier("deal-plan-bedtime")
    }

    private func dailyCard(_ daily: (title: String, detail: String), fill: Bool) -> some View {
        ruleCard(icon: "hourglass", tint: Palette.frHw, soft: Palette.frHwSoft,
                 label: "Daily time", title: daily.title, detail: daily.detail, fill: fill)
            .accessibilityIdentifier("deal-plan-daily")
    }

    private func ruleCard(icon: String, tint: Color, soft: Color, label: String, title: String, detail: String,
                          fill: Bool = false) -> some View {
        HStack(spacing: Space.lg) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 72, height: 72)
                .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Space.xs) {
                MicroLabel(text: label)
                Text(title)
                    .font(Typography.title)
                    .foregroundStyle(Palette.text)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Space.lg)
        .frame(maxWidth: .infinity, maxHeight: fill ? CGFloat.infinity : nil, alignment: .leading)
        .background(soft, in: RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: Promises

    private func promisesPage(title: String, subtitle: String, options: [(emoji: String, text: String)],
                              promises: Binding<[String]>, tint: Color, soft: Color, parent: Bool) -> some View {
        let chosen = promises.wrappedValue
        let full = chosen.count >= DealWords.maxPromises
        let custom = chosen.filter { p in !options.contains { $0.text == p } }
        return VStack(alignment: .leading, spacing: Space.lg) {
            Text(title)
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.text)
            Text(subtitle)
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
            if wide {
                // Regular width: an adaptive grid (2+ chips a row) instead of a stretched list.
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: Space.sm)], spacing: Space.sm) {
                    promiseChips(options: options, chosen: chosen, custom: custom, full: full,
                                 promises: promises, tint: tint, soft: soft)
                }
            } else {
                VStack(spacing: Space.sm) {
                    promiseChips(options: options, chosen: chosen, custom: custom, full: full,
                                 promises: promises, tint: tint, soft: soft)
                }
            }
            if writing && writingParent == parent {
                VStack(alignment: .leading, spacing: Space.sm) {
                    TextField("Write a promise", text: $customText, axis: .vertical)
                        .font(Typography.body)
                        .lineLimit(1...3)
                        .padding(Space.md)
                        .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Radius.field, style: .continuous).stroke(tint, lineWidth: 1.5))
                        .onChange(of: customText) { _, v in
                            if v.count > DealWords.maxPromiseLength { customText = String(v.prefix(DealWords.maxPromiseLength)) }
                        }
                        .submitLabel(.done)
                        .onSubmit { addCustom(to: promises) }
                    HStack {
                        Text("\(customText.count)/\(DealWords.maxPromiseLength)")
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                            .monospacedDigit()
                        Spacer()
                        Button("Add") { addCustom(to: promises) }
                            .font(Typography.body.weight(.semibold))
                            .frame(minWidth: 44, minHeight: 44)
                            .disabled(customText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            } else if !full {
                Button {
                    Haptics.selection()
                    writing = true; writingParent = parent; customText = ""
                } label: {
                    Label("Write my own", systemImage: "pencil")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.frYouInk)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(RoundedRectangle(cornerRadius: Radius.field + 4, style: .continuous)
                            .strokeBorder(Palette.frYou.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])))
                }
                .buttonStyle(.plain)
            }
            Text("\(chosen.count) of up to 3 picked · at least one required")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
        }
    }

    @ViewBuilder
    private func promiseChips(options: [(emoji: String, text: String)], chosen: [String], custom: [String], full: Bool,
                              promises: Binding<[String]>, tint: Color, soft: Color) -> some View {
        ForEach(options, id: \.text) { option in
            PromiseChip(emoji: option.emoji, text: option.text, selected: chosen.contains(option.text),
                        disabled: full, tint: tint, soft: soft) { toggle(option.text, in: promises) }
        }
        ForEach(custom, id: \.self) { text in
            PromiseChip(emoji: "✏️", text: text, selected: true, disabled: false, tint: tint, soft: soft) {
                toggle(text, in: promises)
            }
        }
    }

    private func toggle(_ promise: String, in promises: Binding<[String]>) {
        if let i = promises.wrappedValue.firstIndex(of: promise) {
            promises.wrappedValue.remove(at: i)
        } else if promises.wrappedValue.count < DealWords.maxPromises {
            promises.wrappedValue.append(promise)
        }
    }

    private func addCustom(to promises: Binding<[String]>) {
        let text = String(customText.trimmingCharacters(in: .whitespacesAndNewlines).prefix(DealWords.maxPromiseLength))
        guard !text.isEmpty, promises.wrappedValue.count < DealWords.maxPromises else { return }
        if !promises.wrappedValue.contains(text) { promises.wrappedValue.append(text) }
        Haptics.selection()
        customText = ""
        writing = false
    }

    // MARK: Permission and selection

    private var turnOnPage: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Text(turnOn == .on ? "Permissions and selection ready" : "Set up this device")
                .font(titleFont)
                .foregroundStyle(Palette.text)
            switch turnOn {
            case .ready:
                Text("Grown-up, choose the mode for this device. Apple will ask for Screen Time permission.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                optionCard(title: "With Family Sharing",
                           detail: "Approve with your Apple Account. Works if \(kidName) is a child in your Family Sharing group.",
                           button: "Turn on with Family Sharing") { await authorize(.family) }
                // Both modes are first-class: families that never set up a child
                // Apple Account shouldn't have to sit through a failed attempt.
                optionCard(title: "Without Family Sharing",
                           detail: "Use this when the device is not in a child Apple Account's Family Sharing group. The device owner approves; access can be changed in Settings.",
                           button: "Turn on without Family Sharing") { await authorize(.cooperative) }
                DisclosureGroup("Not sure which mode?", isExpanded: $showFamilyHelp) {
                    Text("Check this device's Settings → Family with your grown-up. If the child Apple Account belongs to your Family Sharing group, choose With Family Sharing. Otherwise choose Without Family Sharing. Fam ETC cannot determine this for you; Apple's permission screen confirms whether a mode is available.")
                        .font(Typography.label).foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(minHeight: 44)
            case .fallback(let reason):
                Text("Family Sharing permission wasn't completed.")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                Text(reason)
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                optionCard(title: "Without Family Sharing",
                           detail: "The device owner approves access. If access changes in Settings, \(DealWords.joined(parents)) gets an update.",
                           button: "Turn on without Family Sharing") { await authorize(.cooperative) }
                Button("Try Family Sharing again") { Task { await authorize(.family) } }
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.frYouInk)
                    .frame(minHeight: 44)
                    .disabled(working)
            case .failed(let reason):
                Label("Not on yet", systemImage: "exclamationmark.triangle.fill")
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.frDanger)
                Text(reason)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                busyButton("Try again") {
                    if service.authState == .approved { await finish() } else { turnOn = .ready }
                }
            case .pickAll:
                Text(service.policy?.limits.contains(where: \.isTotal) == true
                     ? "Choose the apps and categories to measure for daily time on this device."
                     : "Choose the apps and categories to measure for screen time on this device.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                VStack(alignment: .leading, spacing: Space.md) {
                    Label { Text("Tap **All Apps & Categories**, then **Done**") } icon: {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.frYou)
                    }
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.text)
                    if let pickNote {
                        Text(pickNote)
                            .font(Typography.label)
                            .foregroundStyle(Palette.frDanger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    busyButton("Choose apps") { showPicker = true }
                }
                .padding(Space.lg)
                .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            case .on:
                HStack(spacing: Space.md) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 40, weight: .semibold))
                        .foregroundStyle(Palette.green)
                        .accessibilityHidden(true)
                    Text(service.mode == .family ? "Permission granted with Family Sharing." : "Permission granted without Family Sharing.")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(makingDeal ? "Both signatures are still required. We will check the device's rules after saving your agreement." : "Your saved agreement still stands. Continue to check this device's rules.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
            }
        }
    }

    private func optionCard(title: String, detail: String, button: String, action: @escaping () async -> Void) -> some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Text(title).font(Typography.cardTitle).foregroundStyle(Palette.text)
            Text(detail)
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            busyButton(button, action).padding(.top, Space.xs)
        }
        .padding(Space.lg)
        .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    @ViewBuilder
    private func busyButton(_ title: String, _ action: @escaping () async -> Void) -> some View {
        if working {
            HStack(spacing: Space.sm) { ProgressView(); Text("Turning it on…") }
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .frame(maxWidth: .infinity, minHeight: 54)
        } else {
            BigButton(title: title) { Task { await action() } }
        }
    }

    private func authorize(_ mode: ScreenTimeMode) async {
        working = true
        do {
            try await service.requestAuthorization(mode)
        } catch {
            working = false
            let reason = service.lastError ?? error.localizedDescription
            turnOn = mode == .family ? .fallback(reason) : .failed(reason)
            return
        }
        await finish()
    }

    private func finish() async {
        working = true
        do {
            // Turning access back on keeps the existing device; only a new device enrolls.
            if !service.isEnrolled { try await service.enroll() }
            await service.sync(source: "app")
            guard service.policy != nil else {
                turnOn = .failed("The rules couldn't load. Check your connection and try again.")
                working = false; return
            }
            if service.needsTotalSelection || service.needsUsageSelection {
                turnOn = .pickAll
            } else {
                turnOn = .on
            }
        } catch {
            turnOn = .failed(service.lastError ?? error.localizedDescription)
        }
        working = false
    }

    private func saveAll() async {
        let chosen = allSelection
        guard !ScreenTimeService.summary(of: chosen).isEmpty else {
            pickNote = "Nothing was chosen. Try again and tap All Apps & Categories."
            return
        }
        working = true
        pickNote = nil
        do {
            try await service.saveAllAppsSelection(chosen)
            turnOn = .on
        } catch {
            pickNote = service.lastError ?? error.localizedDescription
        }
        working = false
    }

    // MARK: Required signatures

    private var sign: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            Text("Sign it")
                .font(titleFont)
                .foregroundStyle(Palette.text)
            Label {
                Text(DealWords.fairness(parents))
                    .font(Typography.body)
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "bell.badge.fill").foregroundStyle(Palette.frHw)
            }
            .padding(Space.lg)
            .background(Palette.frHwSoft, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .accessibilityElement(children: .combine)

            if wide {
                // Regular width: the kid and the grown-up sign side by side.
                HStack(alignment: .top, spacing: Space.lg) {
                    signPanel(fill: true) { kidSignContent }
                    signPanel(fill: true) { parentSignContent }
                }
                .fixedSize(horizontal: false, vertical: true)   // equal-height panels
            } else {
                signPanel(fill: false) { kidSignContent }
                signPanel(fill: false) { parentSignContent }
            }
        }
        .onAppear {
            if signer.isEmpty { signer = parents.first ?? "" }
        }
    }

    private func signPanel<C: View>(fill: Bool, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: Space.md) { content() }
            .padding(Space.lg)
            .frame(maxWidth: .infinity, maxHeight: fill ? CGFloat.infinity : nil, alignment: .topLeading)
            .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    /// Kid: pick a stamp, then press and hold.
    @ViewBuilder private var kidSignContent: some View {
        Text("\(kidName), pick your stamp")
            .font(Typography.cardTitle)
            .foregroundStyle(Palette.text)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: Space.sm)], spacing: Space.sm) {
            ForEach(DealWords.stamps, id: \.self) { emoji in
                Button {
                    Haptics.selection()
                    stamp = emoji
                } label: {
                    Text(emoji)
                        .font(.system(size: 30))
                        .frame(width: 52, height: 52)
                        .background(stamp == emoji ? Palette.frYouSoft : Palette.frCard, in: Circle())
                        .overlay(Circle().stroke(stamp == emoji ? Palette.frYou : Palette.frRule,
                                                 lineWidth: stamp == emoji ? 2.5 : 1))
                }
                .buttonStyle(.plain)
                .disabled(kidSigned)
                .accessibilityLabel("Stamp \(emoji)")
                .accessibilityAddTraits(stamp == emoji ? .isSelected : [])
            }
        }
        HStack(spacing: Space.lg) {
            HoldToSign(stamp: stamp, signed: $kidSigned)
            Text(kidSigned ? "Signed! 🎉" : (stamp == nil ? "Pick a stamp, then press and hold your thumb here." : "Press and hold to sign."))
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(kidSigned ? Palette.frD3Ink : Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
    }

    /// Grown-up: type a name, then "I'm in".
    @ViewBuilder private var parentSignContent: some View {
        Text("Grown-up, type your name")
            .font(Typography.cardTitle)
            .foregroundStyle(Palette.text)
        if parents.count > 1 && !parentSigned {
            HStack(spacing: Space.sm) {
                ForEach(parents, id: \.self) { name in
                    Button(name) { Haptics.selection(); signer = name }
                        .font(Typography.label.weight(.semibold))
                        .foregroundStyle(signer == name ? Palette.frOnYou : Palette.frYouInk)
                        .padding(.horizontal, Space.md)
                        .frame(minHeight: 44)
                        .background(signer == name ? Palette.frYou : Palette.frYouSoft, in: Capsule())
                        .buttonStyle(.plain)
                }
            }
        }
        TextField("Your name", text: $signer)
            .font(Typography.title)
            .textContentType(.givenName)
            .submitLabel(.done)
            .padding(Space.md)
            .background(Palette.frCard2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .disabled(parentSigned)
            .onChange(of: signer) { _, v in if v.count > 40 { signer = String(v.prefix(40)) } }
        if parentSigned {
            Label("\(trimmedSigner) is in!", systemImage: "checkmark.seal.fill")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frD3Ink)
        } else {
            BigButton(title: "I'm in", systemImage: "hand.thumbsup.fill", enabled: !trimmedSigner.isEmpty) {
                Haptics.notify(.success)
                withAnimation(Motion.maybe(Motion.overshoot, reduceMotion: reduceMotion)) { parentSigned = true }
            }
        }
    }

    private var trimmedSigner: String { signer.trimmingCharacters(in: .whitespacesAndNewlines) }

    // MARK: Verification

    private var celebrate: some View {
        VStack(alignment: .center, spacing: Space.lg) {
            Image(systemName: setupComplete ? "checkmark.circle" : "clock.arrow.circlepath")
                .font(.largeTitle).foregroundStyle(setupComplete ? Palette.frD3Ink : Palette.frFamsInk)
                .accessibilityHidden(true)
            .padding(.top, Space.xl)
            Text(verificationTitle)
                .font(Typography.display(40, .heavy))
                .foregroundStyle(Palette.text)
            if makingDeal {
                HStack(spacing: Space.md) {
                    Text("\(stamp ?? "⭐️") \(kidName)")
                    Text("🤝").accessibilityHidden(true)
                    Text("✍️ \(trimmedSigner)")
                }
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.text)
                .accessibilityElement(children: .combine)
                switch saveState {
                case .idle, .saving:
                    HStack(spacing: Space.sm) { ProgressView(); Text("Saving your deal…") }
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                case .saved:
                    Text(setupComplete ? "Your agreement is saved and the current rules registered successfully on this device."
                         : "Your agreement is saved. We still need this device to confirm that its current rules registered successfully.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .multilineTextAlignment(.center)
                case .failed(let message):
                    Text("Couldn't save it yet — your deal is kept on this \(UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "phone") and we'll keep trying.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.text)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(message)
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                        .multilineTextAlignment(.center)
                }
            } else {
                Text(setupComplete ? "Your saved agreement still stands. The current rules registered successfully on this device."
                     : "Your saved agreement still stands. This device still needs a protection check.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
            }
            if checkingFinish {
                HStack(spacing: Space.sm) { ProgressView(); Text("Checking this device…") }.font(Typography.body)
            } else if !deviceReady {
                if let health = service.deviceHealth {
                    Text(health.state == "needsSelection" ? "App selection is still needed. Choose apps with your grown-up."
                         : health.state == "failed" || health.state == "partial" ? "Some device rules could not register. Retry the device check together."
                         : "Waiting for the current device check. Keep Fam ETC open and retry when online.")
                        .font(Typography.body).foregroundStyle(Palette.textSecond)
                        .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                }
                if let error = service.lastError { Text(error).font(Typography.label).foregroundStyle(Palette.frDanger) }
            }
            if service.policy?.enabled == false {
                Text("Screen Time is off in the saved rules. Your parent can turn it on in their controls.")
                    .font(Typography.label).foregroundStyle(Palette.textSecond)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var verificationTitle: String {
        if setupComplete { return "Setup checked" }
        if makingDeal && saveState == .saved { return "Agreement saved — one step left" }
        if makingDeal && saveState == .saving { return "Saving agreement" }
        if makingDeal { return "Agreement needs to save" }
        return "One device check left"
    }

    @ViewBuilder private var celebrateFooter: some View {
        switch saveState {
        case .saving:
            EmptyView()
        case .failed:
            VStack(spacing: Space.sm) {
                BigButton(title: "Try again", systemImage: "arrow.clockwise") { Task { await saveDeal() } }
                Button("Close — we'll keep trying") { dismiss() }
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.frYouInk)
                    .frame(minHeight: 44)
            }
        case .idle, .saved:
            VStack(spacing: Space.sm) {
                if !setupComplete {
                    if service.needsTotalSelection || service.needsUsageSelection {
                        BigButton(title: "Choose apps with your grown-up", enabled: !checkingFinish) {
                            turnOn = .pickAll
                            if !pages.contains(.permission) { pages.insert(.permission, at: max(0, pages.count - 1)) }
                            go(to: .permission)
                        }
                    } else {
                        BigButton(title: "Retry device check", systemImage: "arrow.clockwise", enabled: !checkingFinish) { Task { await verifyDevice() } }
                    }
                }
                Button(setupComplete ? "Done" : "Close — finish later") { dismiss() }
                    .font(Typography.body.weight(.semibold)).frame(minHeight: 44)
            }
        }
    }

    private func verifyDevice() async {
        guard !checkingFinish else { return }
        if !makingDeal && !currentSignedAgreement {
            requireAgreementReview("Review and sign your family agreement before finishing setup.")
            return
        }
        let generation = flowGeneration
        verificationAttempted = false
        checkingFinish = true
        await service.checkThisDevice()
        guard generation == flowGeneration, !Task.isCancelled else { return }
        verificationAttempted = true
        checkingFinish = false
    }

    private func saveDeal() async {
        guard saveState != .saving else { return }
        guard promisesValid, kidSigned, parentSigned,
              let reviewedRules, reviewedRules == ScreenTimeAgreementRules(policy: service.policy ?? .disabled) else {
            requireAgreementReview("Review the current rules and both sets of promises, then sign together.")
            return
        }
        let generation = flowGeneration
        saveState = .saving
        let deal = ScreenTimeAgreement(
            kidPromises: kidPromises,
            parentPromises: parentPromises,
            kidStamp: stamp ?? "⭐️",
            parentSigner: trimmedSigner,
            rules: reviewedRules,
            signedAt: nil,
            deviceId: nil)
        do {
            try await service.saveAgreement(deal)
            guard generation == flowGeneration, !Task.isCancelled else { return }
            saveState = .saved
            await verifyDevice()
        } catch {
            guard generation == flowGeneration, !Task.isCancelled else { return }
            saveState = .failed(service.lastError ?? error.localizedDescription)
        }
    }
}

// MARK: - Deal pieces

private struct PromiseChip: View {
    let emoji: String
    let text: String
    let selected: Bool
    let disabled: Bool
    let tint: Color
    let soft: Color
    let action: () -> Void

    var body: some View {
        let dim = disabled && !selected
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: Space.md) {
                Text(emoji).font(.title2).accessibilityHidden(true)
                Text(text)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(selected ? tint : Palette.frInk3)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, Space.lg)
            .padding(.vertical, Space.md)
            .frame(minHeight: 58)
            .background(selected ? soft : Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.field + 4, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.field + 4, style: .continuous)
                .stroke(selected ? tint : Palette.frRule, lineWidth: selected ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(dim)
        .opacity(dim ? 0.45 : 1)
        .accessibilityLabel(text)
        .accessibilityHint(selected ? "Double-tap to remove" : "Double-tap to promise this")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Press-and-hold "thumbprint" signature: a ring fills while held, with haptics.
/// VoiceOver / Switch Control users sign with the default action instead.
private struct HoldToSign: View {
    let stamp: String?
    @Binding var signed: Bool
    @State private var progress: CGFloat = 0
    private let duration = 1.2

    var body: some View {
        let ready = stamp != nil
        ZStack {
            Circle().fill(signed ? Palette.frD3Soft : Palette.frYouSoft)
            Circle().stroke(Palette.frRule, lineWidth: 6)
            Circle()
                .trim(from: 0, to: signed ? 1 : progress)
                .stroke(signed ? Palette.frD3 : Palette.frYou, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if signed, let stamp {
                Text(stamp).font(.system(size: 50)).transition(.scale.combined(with: .opacity))
            } else {
                Image(systemName: "touchid")
                    .font(.system(size: 48, weight: .regular))
                    .foregroundStyle(ready ? Palette.frYou : Palette.frInk3)
            }
        }
        .frame(width: 112, height: 112)
        .contentShape(Circle())
        .onLongPressGesture(minimumDuration: duration, maximumDistance: 40) {
            complete()
        } onPressingChanged: { pressing in
            guard ready, !signed else { return }
            if pressing { Haptics.impact(.light) }
            withAnimation(pressing ? .linear(duration: duration) : .easeOut(duration: 0.2)) { progress = pressing ? 1 : 0 }
        }
        .accessibilityElement()
        .accessibilityLabel(signed ? "Signed with stamp \(stamp ?? "")" : "Thumbprint signature")
        .accessibilityHint(signed ? "" : (ready ? "Double-tap to sign" : "Pick a stamp first"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { complete() }
    }

    private func complete() {
        guard stamp != nil, !signed else { return }
        Haptics.notify(.success)
        withAnimation(Motion.overshoot) { signed = true }
    }
}

/// A one-shot burst of Family Rings-colored confetti. Callers skip it under Reduce Motion.
private struct DealConfetti: View {
    private struct Piece { let x: CGFloat; let y: CGFloat; let spin: Double; let color: Color; let round: Bool }
    private static let colors = [Palette.frYou, Palette.frHw, Palette.frHab, Palette.frD3, Palette.frFams]
    @State private var pieces: [Piece] = (0..<28).map { i in
        Piece(x: .random(in: -170...170), y: .random(in: -150...110), spin: .random(in: -300...300),
              color: DealConfetti.colors[i % DealConfetti.colors.count], round: i.isMultiple(of: 3))
    }
    @State private var burst = false

    var body: some View {
        ZStack {
            ForEach(pieces.indices, id: \.self) { i in
                let p = pieces[i]
                RoundedRectangle(cornerRadius: p.round ? 5 : 2)
                    .fill(p.color)
                    .frame(width: p.round ? 10 : 8, height: p.round ? 10 : 14)
                    .rotationEffect(.degrees(burst ? p.spin : 0))
                    .offset(x: burst ? p.x : 0, y: burst ? p.y : 0)
                    .animation(.spring(response: 0.9, dampingFraction: 0.7), value: burst)
                    .opacity(burst ? 0 : 1)
                    .animation(.easeIn(duration: 0.6).delay(1.1), value: burst)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .task { burst = true }
    }
}

// MARK: - Contract (kid "Our deal" + parent read-only)

/// The full signed deal: rules, both promise lists, stamps and date.
struct ScreenTimeDealContract: View {
    let deal: ScreenTimeAgreement
    let kidName: String
    var pending = false

    var body: some View {
        Card(padding: Space.xl) {
            VStack(alignment: .leading, spacing: Space.lg) {
                HStack(alignment: .center, spacing: Space.md) {
                    Text("🤝").font(.system(size: 40)).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Our Screen Time deal")
                            .font(Typography.title)
                            .foregroundStyle(Palette.text)
                        Text(pending ? "Signed on this device — saving…"
                                     : DealWords.signedDate(deal).map { "Signed \($0)" } ?? "Signed")
                            .font(Typography.label)
                            .foregroundStyle(Palette.textSecond)
                    }
                }
                section("The plan") {
                    if let bed = DealWords.bedtime(deal.rules) {
                        Label("\(bed.title), \(bed.detail)", systemImage: "moon.stars.fill")
                            .foregroundStyle(Palette.text)
                    }
                    if let daily = DealWords.dailyLine(deal.rules) {
                        Label(daily, systemImage: "hourglass").foregroundStyle(Palette.text)
                    }
                    if deal.rules.bedStart == nil && deal.rules.school == nil {
                        Text("No bedtime or daily time in this deal.").foregroundStyle(Palette.textSecond)
                    }
                }
                section("\(kidName) promises") { promises(deal.kidPromises) }
                section("\(deal.parentSigner) promises") { promises(deal.parentPromises) }
                Divider()
                HStack(alignment: .top) {
                    stamp(deal.kidStamp, kidName, "Thumbprint ✓")
                    Spacer()
                    stamp("✍️", deal.parentSigner, "I'm in ✓")
                }
            }
            .font(Typography.body)
            .monospacedDigit()
        }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            MicroLabel(text: title)
            content()
        }
    }

    @ViewBuilder private func promises(_ list: [String]) -> some View {
        if list.isEmpty {
            Text("No promises").foregroundStyle(Palette.textSecond)
        }
        ForEach(list, id: \.self) { p in
            HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                Text(DealWords.emoji(for: p)).accessibilityHidden(true)
                Text(p).foregroundStyle(Palette.text).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func stamp(_ emoji: String, _ name: String, _ caption: String) -> some View {
        VStack(spacing: Space.xs) {
            Text(emoji)
                .font(.system(size: 34))
                .frame(width: 64, height: 64)
                .background(Palette.frYouSoft, in: Circle())
                .overlay(Circle().stroke(Palette.frYou.opacity(0.35), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])))
            Text(name).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
            Text(caption).font(Typography.caption).foregroundStyle(Palette.textSecond)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name) signed")
    }
}

/// Parent's read-only view of a kid's deal.
struct ScreenTimeDealSheet: View {
    @Environment(\.dismiss) private var dismiss
    let deal: ScreenTimeAgreement
    let kidName: String

    var body: some View {
        NavigationStack {
            ScrollView {
                ScreenTimeDealContract(deal: deal, kidName: kidName)
                    .padding(Space.xl)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
            }
            .background(ScreenBackground())
            .navigationTitle("\(kidName)'s deal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.large])
    }
}

// MARK: - Our deal (kid, enrolled)

struct ScreenTimeKidRulesSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var pickingLimit: ScreenTimeLimit?
    @State private var selection = FamilyActivitySelection()
    @State private var original = FamilyActivitySelection()
    @State private var showPicker = false
    @State private var saving = false
    @State private var error: String?
    @State private var showMoreTime = false
    @State private var showEssentialApps = false
    @State private var checkingDevice = false
    private var service: ScreenTimeService { .shared }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.lg) {
                    AskMoreTimeButton(isPresented: $showMoreTime)
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(Typography.label)
                            .foregroundStyle(Palette.frDanger)
                    }
                    if let until = ScreenTimeFormat.pauseUntil(service.policy) {
                        Label("\(ScreenTimeEnforcer.shared.shieldReasons[ScreenTimeSchedule.pauseStore] != nil ? "Paused by a grown-up" : "Pause requested") until \(ScreenTimeFormat.clock(until))", systemImage: "pause.circle.fill")
                            .font(Typography.body.weight(.semibold))
                            .foregroundStyle(Palette.frYouInk)
                    }
                    if service.agreementIsStale {
                        Label("Your rules changed — renew your deal together from Today.", systemImage: "arrow.triangle.2.circlepath")
                            .font(Typography.body.weight(.semibold))
                            .foregroundStyle(Palette.frHwInk)
                    }
                    if let deal = service.currentDeal {
                        ScreenTimeDealContract(deal: deal, kidName: DealWords.kidName(store),
                                               pending: service.pendingAgreement != nil)
                    }
                    let appLimits = service.policy?.limits.filter { !$0.isTotal } ?? []
                    if !appLimits.isEmpty { appLimitsCard(appLimits) }
                    essentialAppsCard
                    Card(padding: Space.lg) {
                        VStack(alignment: .leading, spacing: Space.xs) {
                            Text(DealWords.fairness(DealWords.parentNames(store)))
                                .font(Typography.label)
                                .foregroundStyle(Palette.textSecond)
                                .fixedSize(horizontal: false, vertical: true)
                            if let last = service.lastSyncAt {
                                Text("Last updated \(ScreenTimeFormat.relative(last))")
                                    .font(Typography.caption)
                                    .foregroundStyle(Palette.textSecond)
                            }
                            if let message = service.lastError {
                                Text(message).font(Typography.label).foregroundStyle(Palette.frDanger)
                            }
                            Button(checkingDevice ? "Checking this device…" : "Check this device") {
                                guard !checkingDevice else { return }
                                checkingDevice = true
                                Task { await service.checkThisDevice(); checkingDevice = false }
                            }
                            .frame(minHeight: 44).disabled(checkingDevice)
                        }
                    }
                }
                .padding(Space.xl)
                .frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(ScreenBackground())
            .refreshable { await service.sync(source: "app") }
            .navigationTitle("Our deal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .familyActivityPicker(isPresented: $showPicker, selection: $selection)
            .sheet(isPresented: $showMoreTime) { ScreenTimeMoreTimeSheet() }
            .sheet(isPresented: $showEssentialApps) { ScreenTimeEssentialAppsProposalSheet() }
            .onChange(of: store.me?.id) { _, _ in dismiss() }
            .onChange(of: store.needsAuth) { _, needsAuth in if needsAuth { dismiss() } }
            .onChange(of: service.enrolledKidId) { _, _ in dismiss() }
            .onChange(of: showPicker) { _, open in
                guard !open, let limit = pickingLimit else { return }
                pickingLimit = nil
                guard selection != original else { return }
                saving = true
                error = nil
                let chosen = selection
                Task {
                    do { try await service.saveDeviceSelection(limitId: limit.id, selection: chosen) }
                    catch { self.error = service.lastError ?? error.localizedDescription }
                    saving = false
                }
            }
        }
        .presentationDetents([.large])
    }

    private var essentialAppsCard: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                Text("Essential apps").font(Typography.cardTitle).accessibilityAddTraits(.isHeader)
                Text("Approved: \(service.policy?.essentialApps?.summary.map { ScreenTimeFormat.summary($0) } ?? "No essential apps")")
                    .font(Typography.label)
                if let pending = service.policy?.essentialApps?.pending {
                    Text("Waiting for a parent: \(ScreenTimeFormat.summary(pending.summary))")
                        .font(Typography.label.weight(.semibold)).foregroundStyle(Palette.frYouInk)
                    if let note = pending.note, !note.isEmpty {
                        Text("“\(note)”").font(Typography.label).foregroundStyle(Palette.textSecond)
                    }
                }
                Text("Ask to keep individual apps available during bedtime and quiet time. Your daily limits and a grown-up's pause still apply. Only a parent can approve.")
                    .font(Typography.label).foregroundStyle(Palette.textSecond)
                Button(service.policy?.essentialApps?.pending == nil ? "Propose essential apps" : "Review or replace proposal") {
                    showEssentialApps = true
                }
                .frame(minHeight: 44).buttonStyle(.borderless)
                .accessibilityIdentifier("screentime.kid.essentialApps")
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func appLimitsCard(_ limits: [ScreenTimeLimit]) -> some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.md) {
                MicroLabel(text: "App limits")
                ForEach(limits) { limit in
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text(ScreenTimeFormat.limitLine(limit))
                            .font(Typography.body.weight(.semibold))
                            .foregroundStyle(Palette.text)
                            .monospacedDigit()
                        Text(ScreenTimeFormat.summary(limit.selectionSummary))
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                        Button {
                            selection = service.selection(for: limit)
                            original = selection
                            pickingLimit = limit
                            showPicker = true
                        } label: {
                            Label("Choose apps (with your grown-up)", systemImage: "square.grid.2x2")
                                .font(Typography.body.weight(.semibold))
                                .foregroundStyle(Palette.frYouInk)
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(.borderless)
                        .disabled(saving)
                    }
                }
                if saving { HStack { ProgressView(); Text("Saving…") }.font(Typography.label) }
                Text("Changes to the apps are shared with your grown-ups.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
        }
    }
}

/// A proposal never grants an exception. Apple's picker stays on the child's
/// device, where a parent can review the actual apps before approving remotely.
private struct ScreenTimeEssentialAppsProposalSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var selection = FamilyActivitySelection()
    @State private var note = ""
    @State private var showPicker = false
    @State private var saving = false
    @State private var sent = false
    @State private var error: String?
    @State private var reviewedRequestId: String?
    @State private var submittedSelection: FamilyActivitySelection?
    @State private var submittedNote: String?
    private var service: ScreenTimeService { .shared }

    private var validation: String? {
        ScreenTimeEssentialsPresentation.selectionError(apps: selection.applicationTokens.count,
                                                        categories: selection.categoryTokens.count,
                                                        websites: selection.webDomainTokens.count)
    }

    private var canPropose: Bool {
        !store.isParent && !store.needsAuth && service.isEnrolled && service.enrolledKidId == store.me?.kidId
    }

    private var reviewIdentity: ScreenTimeEssentialAppsReviewDraft.Identity? {
        guard canPropose, let deviceId = ScreenTimeEnforcer.shared.deviceId,
              let accountId = store.me?.id, let kidId = store.me?.kidId else { return nil }
        return .init(deviceId: deviceId, assignmentGeneration: ScreenTimeEnforcer.shared.assignmentGeneration,
                     kidId: kidId, accountId: accountId)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Choose individual apps to request during bedtime and quiet time. Daily limits and a parent pause still apply.")
                        .font(Typography.body).fixedSize(horizontal: false, vertical: true)
                    Text("Only a parent can approve. Review the selected apps together on this device before your parent approves in their Screen Time controls.")
                        .font(Typography.label).foregroundStyle(Palette.textSecond)
                }
                if let pending = service.policy?.essentialApps?.pending {
                    Section("Waiting for a parent") {
                        Text(ScreenTimeFormat.summary(pending.summary)).font(Typography.body.weight(.semibold))
                        if let pendingNote = pending.note, !pendingNote.isEmpty { Text("“\(pendingNote)”") }
                        if reviewedRequestId == pending.id && selection == submittedSelection {
                            Text("The submitted apps are restored below. Tap Review selected apps to show them in Apple's picker together.")
                                .font(Typography.label).foregroundStyle(Palette.textSecond)
                        } else if reviewedRequestId == pending.id {
                            Text("These edited choices differ from the waiting proposal. Resubmit them before reviewing for parent approval.")
                                .font(Typography.label.weight(.semibold)).foregroundStyle(Palette.frFamsInk)
                        } else {
                            Text("The previous selected apps can't be reviewed here. Choose the apps again and resubmit before reviewing them together for parent approval.")
                                .font(Typography.label.weight(.semibold)).foregroundStyle(Palette.frFamsInk)
                        }
                        Text("Sending again replaces this waiting proposal. Apps already approved are kept until a parent approves the replacement or removes them.")
                            .font(Typography.label).foregroundStyle(Palette.textSecond)
                    }
                }
                Section {
                    Button {
                        showPicker = true
                    } label: {
                        Label(selection.applicationTokens.isEmpty ? "Choose individual apps" : "Review selected apps", systemImage: "square.grid.2x2")
                            .frame(minHeight: 44)
                    }
                    .disabled(saving)
                    Text(ScreenTimeFormat.summary(ScreenTimeService.summary(of: selection)))
                        .font(Typography.label)
                    if let validation, !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty {
                        Text(validation).font(Typography.label).foregroundStyle(Palette.frDanger)
                    }
                } header: { Text("Apps on this device") }
                footer: { Text("Select 1–50 individual apps. Categories and websites cannot be essential apps.") }
                Section("Note to your parent (optional)") {
                    TextField("Why do you need these apps?", text: $note, axis: .vertical)
                        .lineLimit(2...4)
                        .disabled(saving)
                        .onChange(of: note) { _, value in
                            if value.count > 80 { note = String(value.prefix(80)) }
                            if note != submittedNote { sent = false }
                        }
                    Text("\(note.count) of 80 characters").font(Typography.caption).foregroundStyle(Palette.textSecond)
                }
                if let error {
                    Section {
                        Text(error).font(Typography.label).foregroundStyle(Palette.frDanger)
                        Text("Your choices are kept here. Try sending again when you're online.")
                            .font(Typography.label).foregroundStyle(Palette.textSecond)
                        Button("Check proposal status") {
                            Task { await service.checkThisDevice() }
                        }
                        .frame(minHeight: 44).disabled(saving)
                    }
                }
                Section {
                    if sent {
                        Label("Proposal sent · waiting for a parent", systemImage: "clock")
                            .foregroundStyle(Palette.frYouInk)
                    }
                    Button { sendProposal() } label: {
                        HStack(spacing: Space.sm) {
                            if saving { ProgressView() }
                            Text(saving ? "Sending proposal…" : error == nil ? "Send for parent approval" : "Retry sending proposal")
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(saving || sent || validation != nil || !canPropose)
                    .accessibilityIdentifier("screentime.kid.essentialApps.send")
                }
            }
            .font(Typography.body)
            .scrollContentBackground(.hidden)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
            .background(ScreenBackground())
            .navigationTitle("Essential apps")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(saving) }
            }
            .familyActivityPicker(isPresented: $showPicker, selection: $selection)
            .onChange(of: selection) { _, chosen in
                error = nil
                if chosen != submittedSelection { sent = false }
            }
            .task { restoreReviewDraft() }
            .onChange(of: service.policy?.essentialApps?.pending?.id) { _, _ in
                if !saving { restoreReviewDraft() }
            }
            .onChange(of: store.me?.id) { _, _ in clearAndDismiss() }
            .onChange(of: service.enrolledKidId) { _, _ in clearAndDismiss() }
            .onChange(of: store.needsAuth) { _, needsAuth in if needsAuth { clearAndDismiss() } }
            .onChange(of: ScreenTimeEnforcer.shared.assignmentGeneration) { _, _ in clearAndDismiss() }
            .onChange(of: ScreenTimeEnforcer.shared.deviceId) { _, _ in clearAndDismiss() }
        }
        .interactiveDismissDisabled(saving)
        .presentationDetents([.large])
    }

    private func clearAndDismiss() {
        ScreenTimeEssentialAppsReviewDraft.clear(defaults: ScreenTimeEnforcer.shared.defaults)
        selection = FamilyActivitySelection(); note = ""; error = nil; sent = false
        reviewedRequestId = nil; submittedSelection = nil; submittedNote = nil
        dismiss()
    }

    private func restoreReviewDraft() {
        guard service.policy != nil else { return }
        let pendingId = service.policy?.essentialApps?.pending?.id
        guard let record = ScreenTimeEssentialAppsReviewDraft.restore(identity: reviewIdentity, pendingId: pendingId,
                                                                     defaults: ScreenTimeEnforcer.shared.defaults),
              let restored = ScreenTimeEnforcer.decodeSelection(record.selection),
              ScreenTimeEssentialsPresentation.selectionError(apps: restored.applicationTokens.count,
                                                               categories: restored.categoryTokens.count,
                                                               websites: restored.webDomainTokens.count) == nil else {
            ScreenTimeEssentialAppsReviewDraft.clear(defaults: ScreenTimeEnforcer.shared.defaults)
            if reviewedRequestId != nil {
                selection = FamilyActivitySelection(); note = ""; sent = false
            }
            reviewedRequestId = nil; submittedSelection = nil; submittedNote = nil
            return
        }
        submittedSelection = restored; submittedNote = record.note
        selection = restored; note = record.note; sent = true; reviewedRequestId = record.pendingId
    }

    private func sendProposal() {
        guard !saving, canPropose else { return }
        if let validation { error = validation; return }
        let chosen = selection
        let chosenNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let account = store.me?.id
        let assignment = ScreenTimeEnforcer.shared.assignmentGeneration
        let identity = reviewIdentity
        saving = true
        error = nil
        Task {
            do {
                try await service.proposeEssentialApps(selection: chosen, note: chosenNote.isEmpty ? nil : chosenNote)
                guard account == store.me?.id, assignment == ScreenTimeEnforcer.shared.assignmentGeneration else {
                    clearAndDismiss(); saving = false; return
                }
                if let identity, let pendingId = service.policy?.essentialApps?.pending?.id,
                   let encoded = ScreenTimeService.encode(chosen),
                   ScreenTimeEssentialAppsReviewDraft.save(.init(identity: identity, pendingId: pendingId, selection: encoded,
                                                                note: chosenNote), defaults: ScreenTimeEnforcer.shared.defaults) {
                    submittedSelection = chosen; submittedNote = chosenNote; note = chosenNote
                    reviewedRequestId = pendingId; sent = true
                } else {
                    reviewedRequestId = nil
                    error = "The proposal was sent, but its apps couldn't be saved for later review. Keep this screen open to review them, or select and resubmit before parent approval."
                }
            } catch {
                if account == store.me?.id && assignment == ScreenTimeEnforcer.shared.assignmentGeneration {
                    self.error = error.localizedDescription
                }
            }
            saving = false
        }
    }
}

// MARK: - More time for fams (kid)

/// "Ask for more time ⏱️" — only when there's a daily screen time limit to extend.
private struct AskMoreTimeButton: View {
    @Binding var isPresented: Bool
    private var service: ScreenTimeService { .shared }

    var body: some View {
        if service.policy?.limits.contains(where: \.isTotal) == true {
            let waiting = service.pendingRequest != nil
            Button {
                Haptics.selection()
                isPresented = true
            } label: {
                HStack(spacing: Space.sm) {
                    Text(waiting ? "Asked for more time · waiting ⏳" : "Ask for more time ⏱️")
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: Space.xs)
                    Image(systemName: "chevron.right").accessibilityHidden(true)
                }
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frYouInk)
                .padding(.horizontal, Space.lg)
                .padding(.vertical, Space.sm)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(Palette.frYouSoft, in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(waiting ? "Asked for more time, waiting for a grown-up" : "Ask for more time")
            .accessibilityHint("Swap fams for extra screen time today")
        }
    }
}

/// A small gold fams coin + amount, matching the Fams coin.
private struct FamsBadge: View {
    let amount: Int
    @ScaledMetric(relativeTo: .caption) private var coin: CGFloat = 18

    var body: some View {
        HStack(spacing: 5) {
            ZStack {
                Circle().fill(Color(hex: 0xFFD66B))
                Circle().stroke(Color(hex: 0xE7A62B), lineWidth: 1.5)
                Text("F").font(.system(size: coin * 0.58, weight: .black, design: .rounded))
                    .foregroundStyle(Color(hex: 0x704212))
            }
            .frame(width: coin, height: coin)
            .accessibilityHidden(true)
            Text("\(amount) fams")
                .font(Typography.label.weight(.bold))
                .foregroundStyle(Palette.frFamsInk)
                .monospacedDigit()
        }
        .padding(.leading, 4)
        .padding(.trailing, Space.sm)
        .padding(.vertical, 4)
        .background(Palette.frFamsSoft, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// Pick 15/30/45/60 minutes, paid in fams (1 fam per 3 min) only if a grown-up
/// says yes. One request waits at a time; the answer arrives by push + sync.
struct ScreenTimeMoreTimeSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var minutes: Int?
    @State private var note = ""
    @State private var sending = false
    @State private var error: String?
    private var service: ScreenTimeService { .shared }

    private var balance: Double? { service.famsBalance }
    private var latest: ScreenTimeRequest? { service.requests.first }
    /// Today's latest answer (approved / declined), shown above the choices.
    private var todaysAnswer: ScreenTimeRequest? {
        guard let latest, !latest.isPending, latest.date == ScreenTimeSchedule.dayString(Date()),
              ["approved", "declined"].contains(latest.status) else { return nil }
        return latest
    }

    /// Fams still to earn for `minutes` (0 = affordable; unknown balance lets the server decide).
    private func shortfall(_ minutes: Int) -> Int {
        guard let balance else { return 0 }
        return max(0, Int((Double(ScreenTimeRequest.cost(minutes: minutes)) - balance).rounded(.up)))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.lg) {
                    if let pending = service.pendingRequest { waiting(pending) } else { chooser }
                }
                .padding(Space.xl)
                .frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) {
                footer
                    .padding(.horizontal, Space.xl)
                    .padding(.vertical, Space.md)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
                    .background(Palette.bg.opacity(0.94))
            }
            .background(ScreenBackground())
            .navigationTitle("More time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(sending) }
            }
            .interactiveDismissDisabled(sending)
            .task { await service.loadFamsBalance(kidId: store.me?.kidId) }
            // While waiting, check in now and then in case the push is slow.
            .task(id: service.pendingRequest?.id) {
                guard service.pendingRequest != nil else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(20))
                    if Task.isCancelled { break }
                    await service.sync(source: "app")
                }
            }
            .onChange(of: latest?.status) { old, new in
                guard old == "pending", let new else { return }
                Haptics.notify(new == "approved" ? .success : .warning)
                Task { await service.loadFamsBalance(kidId: store.me?.kidId) }
            }
        }
        .presentationDetents([.large])
    }

    // MARK: Pick

    @ViewBuilder private var chooser: some View {
        if let answer = todaysAnswer { answerCard(answer) }
        Text("⏱️").font(.system(size: 56)).accessibilityHidden(true)
        Text("Need a bit more time?")
            .font(Typography.largeTitle)
            .foregroundStyle(Palette.text)
            .fixedSize(horizontal: false, vertical: true)
        Text("Swap fams for extra screen time today. A grown-up says yes or no — fams are only spent if they say yes.")
            .font(Typography.body)
            .foregroundStyle(Palette.textSecond)
            .fixedSize(horizontal: false, vertical: true)
        if let balance {
            HStack(spacing: Space.sm) {
                Text("You have").font(Typography.body).foregroundStyle(Palette.textSecond)
                FamsBadge(amount: Int(balance.rounded(.down)))
            }
            .accessibilityElement(children: .combine)
        }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: Space.md)], spacing: Space.md) {
            ForEach(ScreenTimeRequest.choices, id: \.self) { choice($0) }
        }
        VStack(alignment: .leading, spacing: Space.xs) {
            TextField("Add a note (optional)", text: $note, axis: .vertical)
                .font(Typography.body)
                .lineLimit(1...3)
                .padding(Space.md)
                .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Radius.field, style: .continuous).stroke(Palette.frRule, lineWidth: 1))
                .onChange(of: note) { _, v in if v.count > 80 { note = String(v.prefix(80)) } }
                .submitLabel(.done)
            Text("Like “Just finishing my level” · \(note.count)/80")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
                .monospacedDigit()
        }
        if let error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(Typography.label)
                .foregroundStyle(Palette.frDanger)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func choice(_ m: Int) -> some View {
        let cost = ScreenTimeRequest.cost(minutes: m)
        let short = shortfall(m)
        let selected = minutes == m
        return Button {
            Haptics.selection()
            minutes = m
        } label: {
            VStack(spacing: Space.xs) {
                Text("+\(m)")
                    .font(Typography.display(40, .heavy))
                    .foregroundStyle(selected ? Palette.frYouInk : Palette.text)
                    .monospacedDigit()
                Text("minutes")
                    .font(Typography.label.weight(.semibold))
                    .foregroundStyle(Palette.textSecond)
                if short > 0 {
                    Text("Earn \(short) more fams")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.frInk2)
                        .multilineTextAlignment(.center)
                        .padding(.top, Space.xs)
                } else {
                    FamsBadge(amount: cost).padding(.top, Space.xs)
                }
            }
            .padding(Space.md)
            .frame(maxWidth: .infinity, minHeight: 150)
            .background(selected ? Palette.frYouSoft : Palette.frCard,
                        in: RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous)
                .stroke(selected ? Palette.frYou : Palette.frRule, lineWidth: selected ? 2.5 : 1))
            .contentShape(RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(short > 0 || sending)
        .opacity(short > 0 ? 0.55 : 1)
        .accessibilityLabel("\(m) more minutes, \(cost) fams")
        .accessibilityValue(short > 0 ? "Earn \(short) more fams first" : "")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func answerCard(_ r: ScreenTimeRequest) -> some View {
        let yes = r.status == "approved"
        return VStack(alignment: .leading, spacing: Space.xs) {
            Text(yes ? "🎉 +\(r.minutes) minutes today" : "Not today — that's OK 💜")
                .font(Typography.title)
                .foregroundStyle(Palette.text)
                .monospacedDigit()
            Text(yes ? "A grown-up said yes. \(r.fams) fams spent — enjoy!"
                     : "Your fams are safe. You can ask again another time.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Space.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(yes ? Palette.frD3Soft : Palette.frYouSoft,
                    in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: Waiting

    private func waiting(_ r: ScreenTimeRequest) -> some View {
        VStack(alignment: .center, spacing: Space.lg) {
            Text("⏳").font(.system(size: 72)).accessibilityHidden(true)
                .padding(.top, Space.xl)
            Text("Asked! Waiting for a grown-up…")
                .font(Typography.largeTitle)
                .foregroundStyle(Palette.text)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: Space.sm) {
                Text("+\(r.minutes) more minutes")
                    .font(Typography.title)
                    .foregroundStyle(Palette.frYouInk)
                    .monospacedDigit()
                FamsBadge(amount: r.fams)
                if let note = r.note, !note.isEmpty {
                    Text("“\(note)”")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Space.lg)
            .frame(maxWidth: .infinity)
            .background(Palette.frYouSoft, in: RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous))
            .accessibilityElement(children: .combine)
            Text("We'll tell you as soon as they answer. Fams are only spent if they say yes.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Footer

    @ViewBuilder private var footer: some View {
        if service.pendingRequest != nil {
            BigButton(title: "OK") { dismiss() }
        } else if sending {
            HStack(spacing: Space.sm) { ProgressView(); Text("Asking…") }
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .frame(maxWidth: .infinity, minHeight: 54)
        } else {
            let ok = minutes.map { shortfall($0) == 0 } ?? false
            BigButton(title: minutes.map { ok ? "Ask for \($0) more minutes" : "Pick another amount" } ?? "Pick how much time",
                      systemImage: ok ? "paperplane.fill" : nil, enabled: ok) { send() }
        }
    }

    private func send() {
        guard let minutes, shortfall(minutes) == 0 else { return }
        sending = true
        error = nil
        Task {
            do {
                try await service.requestMoreTime(minutes: minutes, note: note)
                Haptics.notify(.success)
                note = ""
                self.minutes = nil
            } catch {
                self.error = error.localizedDescription
            }
            sending = false
        }
    }
}
