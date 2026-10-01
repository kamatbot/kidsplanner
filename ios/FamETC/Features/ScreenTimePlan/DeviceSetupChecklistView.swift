import SwiftUI

// The parent's per-kid device setup checklist (docs/SCREEN-TIME-ONLY-PLAN.md §2.1).
// One entry for setting up a kid's device: explicit, resumable, and driven only by server
// evidence (`ScreenTimeKidState.setup` + the device's own protection report), never by a
// local "I did it" flag. Used pinned at the top of the parent Home, from Family →
// "Set up a device", and as the last onboarding step (`DeviceSetupChecklistView(kidIds: nil)`).
//
//   1. Get Fam ETC on {Kid}'s device     done = a setup code was used for this kid
//   2. {Kid} types a code                 done = a sign-in request exists
//   3. Approve                            done = the kid is signed in (passkey or no-passkey)
//   4. Make the deal                      done = deal signed and a device enrolled
//   5. Check protection                   done = the device reports the current rules applied

struct DeviceSetupChecklistView: View {
    private let kidIds: [String]?
    private let embedded: Bool
    private let onOpenRules: ((String) -> Void)?

    @Environment(AppStore.self) private var store
    @State private var rulesKid: RulesKid?
    private var service: ScreenTimeService { .shared }

    private struct RulesKid: Identifiable { let id: String }

    /// - Parameters:
    ///   - kidIds: the kids to show; `nil` shows every kid in the family.
    ///   - embedded: `true` when a parent screen already scrolls (Home); the default draws
    ///     its own scroll view and canvas so it can be a screen by itself (onboarding).
    ///   - onOpenRules: lets the host open a kid's rules (Home keeps that presentation so it
    ///     survives this card disappearing); by default the checklist presents them itself.
    init(kidIds: [String]? = nil, embedded: Bool = false, onOpenRules: ((String) -> Void)? = nil) {
        self.kidIds = kidIds
        self.embedded = embedded
        self.onOpenRules = onOpenRules
    }

    private var kids: [Kid] {
        guard let kidIds else { return store.kids }
        return kidIds.compactMap { id in store.kids.first { $0.id == id } }
    }

    /// True while any shown kid still has a step to do (drives the evidence refresh).
    private var anyUnfinished: Bool {
        kids.contains { kid in
            guard let state = service.state(for: kid.id) else { return true }
            return !DeviceSetupProgress(state: state).isComplete
        }
    }

    var body: some View {
        Group {
            if embedded {
                content
            } else {
                ScrollView {
                    content
                        .padding(Space.lg)
                        .frame(maxWidth: 640)
                        .frame(maxWidth: .infinity)
                }
                .scrollBounceBehavior(.basedOnSize)
                .refreshable { await refreshEvidence() }
                .background(ScreenBackground())
            }
        }
        .task {
            if service.overview == nil { await service.loadOverview() }
            await store.refreshKidRequests()
        }
        .task(id: anyUnfinished) { await refreshWhileUnfinished() }
        .screenTimeControlsCover(item: $rulesKid) { ScreenTimeParentSheet(initialKidId: $0.id).tint(Palette.frYou) }
    }

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            if kids.isEmpty {
                Card(padding: Space.lg) {
                    Text("Add a kid in Family first, then come back to set up their device.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if service.overview == nil {
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
                            Text("Checking setup…").font(Typography.body).foregroundStyle(Palette.textSecond)
                        }
                    }
                }
            } else {
                ForEach(kids) { kid in
                    KidSetupCard(kid: kid) { openRules(kid.id) }
                }
            }
        }
    }

    private func openRules(_ kidId: String) {
        if let onOpenRules { onOpenRules(kidId) } else { rulesKid = RulesKid(id: kidId) }
    }

    private func refreshEvidence() async {
        await service.loadOverview()
        await store.refreshKidRequests()
    }

    /// The kid's device does the work, so this screen re-reads the evidence every few
    /// seconds while it is open and something is unfinished. Stops when it disappears.
    private func refreshWhileUnfinished() async {
        guard anyUnfinished else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled, !store.needsAuth else { return }
            await refreshEvidence()
        }
    }
}

// MARK: - One kid

private struct KidSetupCard: View {
    let kid: Kid
    let onOpenRules: () -> Void

    @Environment(AppStore.self) private var store
    @State private var code: KidSetupCode?
    @State private var codeBusy = false
    @State private var codeError: String?
    @State private var addingDevice = false
    @State private var deciding = false
    @State private var decideError: String?
    @State private var checking = false
    @State private var checkRequestedAt: Date?
    @State private var checkError: String?
    @State private var refreshTask: Task<Void, Never>?
    private var service: ScreenTimeService { .shared }

    private var first: String { DealWords.firstName(kid.name) ?? kid.name }
    private var state: ScreenTimeKidState? { service.state(for: kid.id) }
    private var progress: DeviceSetupProgress? { state.map { DeviceSetupProgress(state: $0) } }
    private var stepCount: Int { DeviceSetupStep.allCases.count }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.lg) {
                header
                if let state, let progress {
                    if progress.isComplete && !addingDevice {
                        completeSummary(state)
                    } else if addingDevice {
                        anotherDeviceSteps(state, progress)
                    } else {
                        steps(state, progress)
                    }
                } else {
                    Text("Setup details for \(first) aren't available right now. Pull down to try again.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("checklist.kid.\(kid.id)")
        .onDisappear { refreshTask?.cancel() }
    }

    private var header: some View {
        HStack(spacing: Space.md) {
            KidProfileAvatar(kid: kid, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text("Set up \(first)'s device")
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                if let progress {
                    Text(addingDevice ? "Another device"
                         : progress.isComplete ? "All set"
                         : "\(progress.doneCount) of \(stepCount) done")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .monospacedDigit()
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Steps

    private func steps(_ state: ScreenTimeKidState, _ progress: DeviceSetupProgress) -> some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            ForEach(DeviceSetupStep.allCases) { step in
                row(step, state: state, progress: progress, forceOpen: false)
            }
        }
    }

    /// "Add another device for Mia": the install + code steps again, the approval when one
    /// is waiting, then the protection check once the new device has made the deal.
    private func anotherDeviceSteps(_ state: ScreenTimeKidState, _ progress: DeviceSetupProgress) -> some View {
        var list: [DeviceSetupStep] = [.getApp, .typeCode]
        if progress.requestWaiting { list.append(.approve) }
        list.append(.check)
        return VStack(alignment: .leading, spacing: Space.lg) {
            ForEach(list) { step in
                row(step, state: state, progress: progress, forceOpen: true)
            }
            Text("Once \(first) is signed in on the new device, follow “Make our deal” there, then check protection.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            PlanButton(title: "Done", style: .quiet) {
                addingDevice = false
                code = nil
            }
        }
    }

    private func completeSummary(_ state: ScreenTimeKidState) -> some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Label {
                Text("Rules confirmed on \(ScreenTimeFormat.deviceNames(ScreenTimeFormat.statusDevices(state.devices), kidName: first))")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.frD3Ink)
            }
            PlanButton(title: "Add another device for \(first)", systemImage: "plus") {
                code = nil
                codeError = nil
                addingDevice = true
            }
            .accessibilityIdentifier("checklist.addDevice.\(kid.id)")
        }
    }

    private func title(_ step: DeviceSetupStep) -> String {
        switch step {
        case .getApp: return "Get Fam ETC on \(first)'s device"
        case .typeCode: return "\(first) types a code"
        case .approve: return "Approve \(first)"
        case .deal: return "Make the deal together"
        case .check: return "Check protection"
        }
    }

    /// Short evidence line for a finished row.
    private func doneSummary(_ step: DeviceSetupStep, state: ScreenTimeKidState, progress: DeviceSetupProgress) -> String {
        switch step {
        case .getApp: return "Fam ETC is on \(first)'s device"
        case .typeCode: return "\(first) used a setup code"
        case .approve: return "\(first) is signed in"
        case .deal: return "Deal signed · \(progress.deviceCount) device\(progress.deviceCount == 1 ? "" : "s")"
        case .check: return "Rules confirmed"
        }
    }

    private func row(_ step: DeviceSetupStep, state: ScreenTimeKidState, progress: DeviceSetupProgress,
                     forceOpen: Bool) -> some View {
        let done = !forceOpen && progress.isDone(step)
        let isOpen = forceOpen || progress.isExpanded(step)
        let number = step.rawValue + 1
        return HStack(alignment: .top, spacing: Space.md) {
            marker(number: number, done: done, isOpen: isOpen)
            VStack(alignment: .leading, spacing: Space.sm) {
                Text(title(step))
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(done || isOpen ? Palette.text : Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                if done {
                    Text(doneSummary(step, state: state, progress: progress))
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                } else if isOpen {
                    detail(step, state: state, progress: progress)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("checklist.step.\(kid.id).\(step.rawValue + 1)")
    }

    private func marker(number: Int, done: Bool, isOpen: Bool) -> some View {
        ZStack {
            Circle().fill(done ? Palette.frD3 : (isOpen ? Palette.frYouSoft : Palette.frCard2))
            if done {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Palette.frOnYou)
            } else {
                Text("\(number)")
                    .font(Typography.label.weight(.bold))
                    .foregroundStyle(isOpen ? Palette.frYouInk : Palette.frInk2)
            }
        }
        .frame(width: 28, height: 28)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(done ? "Done" : "Step \(number)")
    }

    @ViewBuilder
    private func detail(_ step: DeviceSetupStep, state: ScreenTimeKidState, progress: DeviceSetupProgress) -> some View {
        switch step {
        case .getApp: getAppDetail
        case .typeCode: codeDetail(progress)
        case .approve: approveDetail(progress)
        case .deal: dealDetail(progress)
        case .check: checkDetail(state, progress)
        }
    }

    // MARK: 1 · Get the app

    private var getAppDetail: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Text("Install Fam ETC on \(first)'s iPhone or iPad, or search *Fam ETC* in the App Store. Their device needs a passcode.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            ShareLink(item: ScreenTimePlanLinks.appStore,
                      subject: Text("Fam ETC"),
                      message: Text("Install Fam ETC on your device so we can set up Screen Time together.")) {
                Label("Send the App Store link", systemImage: "square.and.arrow.up")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.frYouInk)
                    .padding(.horizontal, Space.lg)
                    .frame(minHeight: 44)
                    .background(Capsule().strokeBorder(Palette.frYou, lineWidth: 1))
                    .contentShape(Capsule())
            }
            .accessibilityIdentifier("checklist.share.\(kid.id)")
        }
    }

    // MARK: 2 · The kid types a code

    private func codeDetail(_ progress: DeviceSetupProgress) -> some View {
        VStack(alignment: .leading, spacing: Space.md) {
            if let code {
                codeDisplay(code)
            } else {
                Text("Show a code here, then \(first) types it on their own device. It works once and lasts 30 minutes.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                if progress.codeActive {
                    Text("A code is already waiting. Showing one again replaces it.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
            }
            if let codeError { PlanErrorLine(message: codeError) }
            PlanButton(title: code == nil ? "Show \(first)'s code" : "New code",
                       systemImage: code == nil ? "number.square" : "arrow.clockwise",
                       style: code == nil ? .prominent : .secondary,
                       busy: codeBusy,
                       fullWidth: code == nil) { showCode() }
                .accessibilityIdentifier("checklist.showCode.\(kid.id)")
        }
    }

    private func codeDisplay(_ code: KidSetupCode) -> some View {
        let characters = SetupCodeDisplay.characters(code.code)
        return TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = code.expiresAtDate?.timeIntervalSince(context.date)
            let expired = (remaining ?? 1) <= 0
            VStack(alignment: .center, spacing: Space.sm) {
                HStack(spacing: 6) {
                    ForEach(Array(characters.enumerated()), id: \.offset) { _, character in
                        Text(character)
                            .font(Typography.display(34, .heavy))
                            .foregroundStyle(expired ? Palette.frInk3 : Palette.text)
                            .frame(minWidth: 34, maxWidth: 56, minHeight: 64)
                            .background(Palette.frCard2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                                .strokeBorder(Palette.frRule, lineWidth: 1))
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(first)'s setup code")
                .accessibilityValue(characters.joined(separator: " ") + (expired ? ", expired" : ""))
                .accessibilityIdentifier("checklist.code.\(kid.id)")
                Group {
                    if expired {
                        Text("This code has expired. Tap New code.")
                    } else if let remaining {
                        Text("Expires in \(SetupCodeDisplay.countdown(remaining: remaining)) · works once")
                            .monospacedDigit()
                    } else {
                        Text("Expires in 30 minutes · works once")
                    }
                }
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                Text("On \(first)'s device, open Fam ETC, tap **I'm a kid**, and type this code.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.text)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func showCode() {
        guard !codeBusy else { return }
        let account = store.me?.id
        codeBusy = true
        codeError = nil
        Task {
            do {
                let fresh = try await APIClient.shared.kidSetupCode(kidId: kid.id)
                guard account == store.me?.id else { codeBusy = false; return }
                code = fresh
                Haptics.notify(.success)
                await service.loadOverview()
            } catch {
                codeError = error.localizedDescription
            }
            codeBusy = false
        }
    }

    // MARK: 3 · Approve

    private var waitingKidIds: [String] {
        (service.overview?.kids ?? []).filter { $0.setup?.requestPending == true }.map(\.kidId)
    }

    private var matchedRequest: KidAccessRequest? {
        KidRequestMatch.request(for: kid, in: store.kidRequests, waitingKidIds: waitingKidIds)
    }

    @ViewBuilder
    private func approveDetail(_ progress: DeviceSetupProgress) -> some View {
        if progress.requestWaiting {
            if let request = matchedRequest {
                VStack(alignment: .leading, spacing: Space.md) {
                    Text("\(first) is asking to sign in on \(request.deviceLabel ?? "their device"). Make sure you're sitting with them.")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                    if let decideError { PlanErrorLine(message: decideError) }
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Space.sm) { decideButtons(request) }
                        VStack(alignment: .leading, spacing: Space.sm) { decideButtons(request) }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: Space.md) {
                    Text("\(first) is asking to sign in. Approve the request from the banner at the top of the screen, or check again.")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                    PlanButton(title: "Check for the request", systemImage: "arrow.clockwise") {
                        Task { await store.refreshKidRequests() }
                    }
                }
            }
        } else {
            Text("When \(first) types the code, the request appears here. You'll get a notification too.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func decideButtons(_ request: KidAccessRequest) -> some View {
        PlanButton(title: "Approve \(first)", systemImage: "checkmark", style: .prominent, busy: deciding) {
            decide(request, approve: true)
        }
        .accessibilityIdentifier("checklist.approve.\(kid.id)")
        PlanButton(title: "Not \(first)?", style: .quiet) { decide(request, approve: false) }
            .disabled(deciding)
    }

    private func decide(_ request: KidAccessRequest, approve: Bool) {
        guard !deciding else { return }
        deciding = true
        decideError = nil
        let account = store.me?.id
        Task {
            if approve { await store.approveKid(request.id) } else { await store.denyKid(request.id) }
            guard account == store.me?.id else { deciding = false; return }
            // `AppStore` swallows the error and keeps the request listed when it fails.
            if store.kidRequests.contains(where: { $0.id == request.id }) {
                decideError = "That didn't go through. Try again."
            } else {
                Haptics.notify(approve ? .success : .warning)
            }
            await service.loadOverview()
            deciding = false
        }
    }

    // MARK: 4 · The deal

    private func dealDetail(_ progress: DeviceSetupProgress) -> some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Text("Sit with \(first). On their device, follow *Make our deal*. If \(first)'s Apple Account is in your Family Sharing group, you'll approve with your Apple ID; otherwise choose *Without Family Sharing*.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            if !progress.rulesOn {
                Text("The deal covers the rules you choose, so set bedtime and daily time first.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                PlanButton(title: "Choose \(first)'s rules", systemImage: "moon.stars", action: onOpenRules)
                    .accessibilityIdentifier("checklist.rules.\(kid.id)")
            } else if progress.signedIn {
                Text("Waiting for \(first)'s device to report the signed deal.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
            }
        }
    }

    // MARK: 5 · Check protection

    private func checkDetail(_ state: ScreenTimeKidState, _ progress: DeviceSetupProgress) -> some View {
        VStack(alignment: .leading, spacing: Space.md) {
            if state.devices.isEmpty {
                Text("No device has connected yet. Once \(first) has made the deal, check protection here.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(state.devices) { device in
                    let confirmed = ScreenTimeEssentialsPresentation.confirmed(device, policy: state.policy, after: checkRequestedAt)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(device.label).font(Typography.label.weight(.semibold)).foregroundStyle(Palette.text)
                        Text(ScreenTimeEssentialsPresentation.protection(device, policy: state.policy, after: checkRequestedAt))
                            .font(Typography.label)
                            .foregroundStyle(confirmed ? Palette.frD3Ink : Palette.frFamsInk)
                            .fixedSize(horizontal: false, vertical: true)
                        if !confirmed, let action = ScreenTimeEssentialsPresentation.nextAction(device, policy: state.policy, after: checkRequestedAt) {
                            Text(action).font(Typography.caption).foregroundStyle(Palette.textSecond)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if !progress.rulesOn {
                Text("Protection starts once bedtime or daily time is on.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
                PlanButton(title: "Choose \(first)'s rules", systemImage: "moon.stars", action: onOpenRules)
            }
            if let checkError { PlanErrorLine(message: checkError) }
            if checkRequestedAt != nil, !progress.protectionConfirmed {
                Text("Check sent. Protection isn't confirmed until \(first)'s device answers.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.frFamsInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            PlanButton(title: checking ? "Requesting check…" : "Check protection", systemImage: "arrow.clockwise",
                       busy: checking) { checkProtection() }
                .disabled(state.devices.isEmpty)
                .accessibilityIdentifier("checklist.check.\(kid.id)")
        }
    }

    private func checkProtection() {
        guard !checking else { return }
        let account = store.me?.id
        let requested = Date()
        checking = true
        checkError = nil
        checkRequestedAt = requested
        Task {
            do {
                try await service.checkProtection(kidId: kid.id)
                if account == store.me?.id { refreshAfterCheck() }
            } catch {
                if account == store.me?.id {
                    checkError = "Couldn't request a check. \(error.localizedDescription)"
                    checkRequestedAt = nil
                }
            }
            checking = false
        }
    }

    /// A short refresh window after an explicit check; waiting is persistent afterwards.
    private func refreshAfterCheck() {
        refreshTask?.cancel()
        refreshTask = Task { @MainActor in
            for delay in [3, 6, 10] {
                do { try await Task.sleep(for: .seconds(delay)) } catch { return }
                guard !Task.isCancelled, !store.needsAuth else { return }
                await service.loadOverview()
            }
        }
    }
}
