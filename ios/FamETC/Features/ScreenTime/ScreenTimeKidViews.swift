import SwiftUI
import FamilyControls

// Kid-side Screen Time UX (docs/SCREEN-TIME-PLAN.md "UX"). A kid only ever sees
// their own policy (`ScreenTimeService.shared.policy`) — never alerts, other
// kids' rules or device state for other devices.

// MARK: - Kid Today card

struct ScreenTimeKidCard: View {
    @Environment(AppStore.self) private var store
    @State private var showSetup = false
    @State private var showRules = false
    private var service: ScreenTimeService { .shared }

    private var needsSetup: Bool { !service.isEnrolled || service.authState != .approved }
    private var needsFinish: Bool { !needsSetup && service.needsTotalSelection }

    var body: some View {
        if !store.isParent, !store.needsAuth, let policy = service.policy, policy.enabled {
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    HStack {
                        MicroLabel(text: "Screen Time")
                        Spacer()
                        Image(systemName: "hourglass")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Palette.frInk2)
                            .accessibilityHidden(true)
                    }
                    if needsSetup {
                        setupPrompt
                    } else if needsFinish {
                        finishPrompt
                    } else {
                        rulesSummary(policy)
                    }
                }
            }
            .sheet(isPresented: $showSetup) { ScreenTimeKidSetupSheet() }
            .sheet(isPresented: $showRules) { ScreenTimeKidRulesSheet() }
            .onChange(of: store.me?.id) { _, _ in showSetup = false; showRules = false }
        }
    }

    @ViewBuilder private var setupPrompt: some View {
        let wasOn = service.isEnrolled
        Text(wasOn ? "Screen Time is off on this device" : "Your parents turned on Screen Time — set it up")
            .font(Typography.cardTitle)
            .foregroundStyle(Palette.text)
            .fixedSize(horizontal: false, vertical: true)
        Text(wasOn ? "Your parents have been told. Turn it back on to keep your rules working."
                   : "It takes a minute. You'll see your rules here once it's on.")
            .font(Typography.label)
            .foregroundStyle(Palette.textSecond)
            .fixedSize(horizontal: false, vertical: true)
        AccentButton(title: wasOn ? "Turn it back on" : "Set it up", systemImage: "hourglass") { showSetup = true }
            .padding(.top, Space.xs)
    }

    @ViewBuilder private var finishPrompt: some View {
        Text("Finish setup with a parent")
            .font(Typography.cardTitle)
            .foregroundStyle(Palette.text)
        Text("One more step so your daily screen time can work.")
            .font(Typography.label)
            .foregroundStyle(Palette.textSecond)
            .fixedSize(horizontal: false, vertical: true)
        AccentButton(title: "Finish setup", systemImage: "hourglass") { showSetup = true }
            .padding(.top, Space.xs)
    }

    @ViewBuilder
    private func rulesSummary(_ policy: ScreenTimePolicy) -> some View {
        if let until = ScreenTimeFormat.pauseUntil(policy) {
            Label("Paused by a parent until \(ScreenTimeFormat.clock(until))", systemImage: "pause.circle.fill")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frYouInk)
        }
        if policy.limits.isEmpty && policy.downtime.isEmpty {
            Text("No limits yet. Your parents can add some.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
        }
        ForEach(policy.limits.prefix(3)) { limit in
            Label(ScreenTimeFormat.limitLine(limit), systemImage: "timer")
                .font(Typography.body)
                .foregroundStyle(Palette.text)
                .monospacedDigit()
        }
        ForEach(policy.downtime.prefix(2)) { d in
            Label(ScreenTimeFormat.downtimeLine(d), systemImage: "moon.fill")
                .font(Typography.body)
                .foregroundStyle(Palette.text)
                .monospacedDigit()
        }
        Text("Turning this off tells your parents.")
            .font(Typography.caption)
            .foregroundStyle(Palette.textSecond)
        Button {
            Haptics.selection()
            showRules = true
        } label: {
            Label("See my rules", systemImage: "chevron.right")
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frYouInk)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Setup sheet

struct ScreenTimeKidSetupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var step: Step
    @State private var working = false
    @State private var showPicker = false
    @State private var allSelection = FamilyActivitySelection()
    @State private var pickNote: String?
    private var service: ScreenTimeService { .shared }

    init() {
        let s = ScreenTimeService.shared
        _step = State(initialValue: s.isEnrolled && s.authState == .approved && s.needsTotalSelection ? .pickAll : .explain)
    }

    enum Step: Equatable {
        case explain
        /// Family Sharing was refused; offer the cooperative mode with this reason.
        case fallback(String)
        case failed(String)
        /// The whole-device limit needs "All Apps & Categories" picked on this device.
        case pickAll
        case done
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.lg) {
                    switch step {
                    case .explain: explain
                    case .fallback(let reason): fallback(reason)
                    case .failed(let reason): failed(reason)
                    case .pickAll: pickAll
                    case .done: done
                    }
                }
                .padding(Space.xl)
                .frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(ScreenBackground())
            .navigationTitle("Screen Time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if step != .done { Button("Not now") { dismiss() }.disabled(working) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if step == .done { Button("Done") { dismiss() } }
                }
            }
            .interactiveDismissDisabled(working)
            .familyActivityPicker(isPresented: $showPicker, selection: $allSelection)
            .onChange(of: showPicker) { _, open in
                if !open, step == .pickAll { Task { await saveAll() } }
            }
        }
    }

    // Step 1
    private var explain: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Text("Your parents turned on Screen Time")
                .font(Typography.title)
                .foregroundStyle(Palette.text)
            point("timer", "Daily limits", "Some apps get a set amount of time each day. When it's used up, they pause until tomorrow.")
            point("moon.fill", "Downtime", "At times like bedtime, apps pause until the morning.")
            point("bell.badge", "Your parents stay in the loop", "If Screen Time is turned off on this device, Fam ETC tells your parents.")
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    Text("Use Family Sharing (recommended)")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                    Text("Apple will ask a parent to approve on this device with their Apple Account. Do this with a parent next to you.")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                    busyButton("Use Family Sharing") { await authorize(.family) }
                }
            }
        }
    }

    // Step 2 fallback
    private func fallback(_ reason: String) -> some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Text("Family Sharing didn't work")
                .font(Typography.title)
                .foregroundStyle(Palette.text)
            Text(reason)
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    Text("Continue without Family Sharing")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                    Text("You'll approve with Face ID. You could turn this off later in Settings, but Fam ETC will let your parents know.")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                    busyButton("Continue without Family Sharing") { await authorize(.cooperative) }
                }
            }
            Button("Try Family Sharing again") { Task { await authorize(.family) } }
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frYouInk)
                .frame(minHeight: 44)
                .disabled(working)
        }
    }

    private func failed(_ reason: String) -> some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Label("Screen Time isn't on yet", systemImage: "exclamationmark.triangle.fill")
                .font(Typography.title)
                .foregroundStyle(Palette.frDanger)
            Text(reason)
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            busyButton("Try again") { await finish() }
        }
    }

    // Last step: the "everything" selection for daily screen time.
    private var pickAll: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Text("Last step: choose all apps")
                .font(Typography.title)
                .foregroundStyle(Palette.text)
            Text("So your daily screen time counts every app, pick them all.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    Label { Text("Tap **All Apps & Categories**, then Done") } icon: {
                        Image(systemName: "checkmark.circle").foregroundStyle(Palette.frYou)
                    }
                    .font(Typography.body)
                    .foregroundStyle(Palette.text)
                    Text("Your parents will see that this is done.")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                    if let pickNote {
                        Text(pickNote)
                            .font(Typography.label)
                            .foregroundStyle(Palette.frDanger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    busyButton("Choose apps") { showPicker = true }
                }
            }
        }
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
            try await service.saveDeviceSelection(limitId: ScreenTimeFormat.totalID, selection: chosen)
            Haptics.notify(.success)
            step = .done
        } catch {
            pickNote = error.localizedDescription
        }
        working = false
    }

    // Success
    private var done: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 44, weight: .medium))
                .foregroundStyle(Palette.green)
                .accessibilityHidden(true)
            Text("Screen Time is on")
                .font(Typography.title)
                .foregroundStyle(Palette.text)
            Text(service.mode == .family
                 ? "This device is protected with Family Sharing. Your rules will show on Today."
                 : "This device is set up without Family Sharing. Your rules will show on Today. Turning this off tells your parents.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func point(_ icon: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: Space.md) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(Palette.frYou)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                Text(body).font(Typography.label).foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func busyButton(_ title: String, _ action: @escaping () async -> Void) -> some View {
        if working {
            HStack(spacing: Space.sm) { ProgressView(); Text("Setting up…") }
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .frame(maxWidth: .infinity, minHeight: 44)
        } else {
            AccentButton(title: title) { Task { await action() } }
        }
    }

    // Steps 2–3
    private func authorize(_ mode: ScreenTimeMode) async {
        working = true
        do {
            try await service.requestAuthorization(mode)
        } catch {
            working = false
            let reason = service.lastError ?? error.localizedDescription
            step = mode == .family ? .fallback(reason) : .failed(reason)
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
            if service.needsTotalSelection {
                step = .pickAll
            } else {
                Haptics.notify(.success)
                step = .done
            }
        } catch {
            step = .failed(service.lastError ?? error.localizedDescription)
        }
        working = false
    }
}

// MARK: - Rules (kid, enrolled)

struct ScreenTimeKidRulesSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var pickingLimit: ScreenTimeLimit?
    @State private var selection = FamilyActivitySelection()
    @State private var original = FamilyActivitySelection()
    @State private var showPicker = false
    @State private var saving = false
    @State private var error: String?
    private var service: ScreenTimeService { .shared }

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(Typography.label)
                            .foregroundStyle(Palette.frDanger)
                    }
                }
                if let policy = service.policy {
                    if let until = ScreenTimeFormat.pauseUntil(policy) {
                        Section {
                            Label("Paused by a parent until \(ScreenTimeFormat.clock(until))", systemImage: "pause.circle.fill")
                                .foregroundStyle(Palette.frYouInk)
                        }
                    }
                    Section {
                        if policy.limits.isEmpty {
                            Text("No daily limits yet.").foregroundStyle(Palette.textSecond)
                        }
                        ForEach(policy.limits) { limit in
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
                                    Label("Choose apps (with a parent)", systemImage: "square.grid.2x2")
                                        .frame(minHeight: 44)
                                }
                                .buttonStyle(.borderless)
                                .disabled(saving)
                            }
                            .padding(.vertical, Space.xs)
                        }
                    } header: {
                        Text("Daily limits")
                    } footer: {
                        Text("Changes to the apps are shared with your parents.")
                    }
                    Section("Downtime") {
                        if policy.downtime.isEmpty {
                            Text("No downtime yet.").foregroundStyle(Palette.textSecond)
                        }
                        ForEach(policy.downtime) { d in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(ScreenTimeFormat.downtimeLine(d))
                                    .font(Typography.body.weight(.semibold))
                                    .monospacedDigit()
                                Text(ScreenTimeFormat.days(d.days))
                                    .font(Typography.caption)
                                    .foregroundStyle(Palette.textSecond)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    Section {
                        Text(service.mode == .family
                             ? "This device uses Family Sharing. Turning this off tells your parents."
                             : "This device is set up without Family Sharing. Turning this off tells your parents.")
                            .font(Typography.label)
                            .foregroundStyle(Palette.textSecond)
                        if let last = service.lastSyncAt {
                            Text("Last updated \(ScreenTimeFormat.relative(last))")
                                .font(Typography.caption)
                                .foregroundStyle(Palette.textSecond)
                        }
                    }
                }
                if saving {
                    Section { HStack { ProgressView(); Text("Saving…") } }
                }
            }
            .font(Typography.body)
            .scrollContentBackground(.hidden)
            .background(ScreenBackground())
            .refreshable { await service.sync(source: "app") }
            .navigationTitle("My Screen Time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .familyActivityPicker(isPresented: $showPicker, selection: $selection)
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
    }
}
