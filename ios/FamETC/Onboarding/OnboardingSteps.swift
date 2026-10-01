import SwiftUI
import UserNotifications

// The parent steps of onboarding (docs/SCREEN-TIME-ONLY-PLAN.md §2), one view each. Every view
// owns its own form state and talks to AuthService itself; `OnboardingView` only routes
// between them and records progress. All of them sit in `OnbPage`, so iPad gets the
// centred card and Dynamic Type just scrolls.

extension View {
    /// Applies an accessibility identifier only when one is given.
    @ViewBuilder func onbIdentifier(_ id: String?) -> some View {
        if let id { self.accessibilityIdentifier(id) } else { self }
    }
}

/// What the family step produced.
struct OnbFamilyOutcome {
    var plan: OnboardingPlan
    /// True when the parent joined a partner's family instead of creating one.
    var joined: Bool
    var kidNames: [String]
}

private func onbKidNames(from family: [String: Any]) -> [String] {
    ((family["kids"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
}

// MARK: - Welcome

struct OnbWelcomeView: View {
    let onSetUp: () -> Void
    let onKid: () -> Void
    /// A returning parent signed in with a passkey or a backup code.
    let onSignedIn: () -> Void

    @State private var signingIn = false
    @State private var error: String?
    @State private var showBackupSignIn = false

    /// Sleep, play and reading — the three things a screen time deal protects.
    private static let collage: [OnbStickerCollage.Item] = [
        .init(sticker: .sleepyCat, size: 0.66, x: 0.32, y: 0.56, tilt: -8),
        .init(sticker: .cyclingBunny, size: 0.54, x: 0.70, y: 0.32, tilt: 8),
        .init(sticker: .readingBear, size: 0.48, x: 0.74, y: 0.74, tilt: -5),
    ]

    var body: some View {
        OnbPage {
            OnbStickerCollage(items: Self.collage, hue: .violet, height: 196)

            OnbTitle(
                title: "More sleep. More play. Fewer screen fights.",
                subtitle: "Make a screen time deal with your kids — bedtime, daily limits and promises you agree on together. Free for any family."
            )

            VStack(spacing: Space.md) {
                OnbPrimaryButton(title: "Set up Fam ETC", enabled: !signingIn, action: onSetUp)
                    .accessibilityIdentifier(OnbID.welcomeSetUp)
                OnbSecondaryButton(title: signingIn ? "Signing in…" : "I already have an account", enabled: !signingIn) {
                    signIn()
                }
                .accessibilityIdentifier(OnbID.welcomeAccount)
                OnbSecondaryButton(title: "I'm a kid 🧒", enabled: !signingIn, action: onKid)
                    .accessibilityLabel("I'm a kid")
                    .accessibilityIdentifier(OnbID.welcomeKid)
            }

            if let error { OnbErrorText(message: error) }

            VStack(spacing: Space.xs) {
                OnbLinkButton(title: "Use a backup code", enabled: !signingIn) { showBackupSignIn = true }
                    .accessibilityIdentifier(OnbID.welcomeBackup)
                Text("Kids sign in with a short code from a parent.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }

            whyItMatters
        }
        .sheet(isPresented: $showBackupSignIn) {
            BackupCodeSignInView {
                showBackupSignIn = false
                onSignedIn()
            }
            .presentationDetents([.large])
        }
    }

    /// Why families set screen time — plain family reasons, no statistics.
    private var whyItMatters: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Text("Why it matters")
                .font(Theme.font(22, weight: .bold, relativeTo: .title2))
                .foregroundStyle(Palette.text)
                .accessibilityAddTraits(.isHeader)
            OnbReasonRow(sticker: .sleepyCat, hue: .violet, title: "Sleep comes first",
                         detail: "Phones go to bed at bedtime too, so kids wake up ready for the day.")
            OnbReasonRow(sticker: .readingBear, hue: .teal, title: "Time for everything",
                         detail: "Homework, play and friends each get their turn — not just the screen.")
            OnbReasonRow(sticker: .gratefulOtter, hue: .pink, title: "Rules you make together",
                         detail: "Kids help set the deal and sign it with you, so it feels fair to everyone.")
            Text("Want school calendars, homework and family chat too? Add the whole Fam ETC any time.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, Space.xl)
    }

    private func signIn() {
        guard !signingIn else { return }
        signingIn = true; error = nil
        Task {
            do {
                try await AuthService.shared.signInWithPasskey()
                await MainActor.run { signingIn = false; onSignedIn() }
            } catch {
                await MainActor.run {
                    signingIn = false
                    if OnbErrors.isCancellation(error) { return }
                    self.error = OnbErrors.friendly(error)
                }
            }
        }
    }
}

// MARK: - Choose

private struct OnbBadge: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Typography.chip)
            .foregroundStyle(Palette.frYouInk)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Palette.accentSoft, in: Capsule())
    }
}

struct OnbChooseView: View {
    @Binding var inviteCode: String
    @Binding var inviteMessage: String?
    let onBack: () -> Void
    let onPick: (OnboardingPlan) -> Void

    @State private var fullOpen: Bool

    init(inviteCode: Binding<String>, inviteMessage: Binding<String?>,
         onBack: @escaping () -> Void, onPick: @escaping (OnboardingPlan) -> Void) {
        _inviteCode = inviteCode
        _inviteMessage = inviteMessage
        self.onBack = onBack
        self.onPick = onPick
        // Come back with the card open when the code was wrong (or already typed).
        _fullOpen = State(initialValue: inviteMessage.wrappedValue != nil || !inviteCode.wrappedValue.isEmpty)
    }

    private var trimmedCode: String { inviteCode.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        OnbPage(onBack: onBack) {
            OnbTitle(title: "Where would you like to start?",
                     subtitle: "Both include Screen Time. Pick the one that fits.")

            screenTimeCard
            fullCard

            Text("You can add the whole Fam ETC later.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private var screenTimeCard: some View {
        Button { onPick(.screenTime) } label: {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                    Image(systemName: "hourglass").foregroundStyle(Palette.accent).accessibilityHidden(true)
                    Text("Screen Time")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: Space.sm)
                    OnbBadge(text: "Free")
                }
                Text("Bedtime, daily limits and a deal you make together. For any family.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }
            .onbPanel()
        }
        .buttonStyle(.plain)
        .accessibilityHint("Starts with the free Screen Time plan.")
        .accessibilityIdentifier(OnbID.chooseScreenTime)
    }

    private var fullCard: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { fullOpen.toggle() }
            } label: {
                VStack(alignment: .leading, spacing: Space.sm) {
                    HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                        Image(systemName: "house.fill").foregroundStyle(Palette.accent).accessibilityHidden(true)
                        Text("The whole Fam ETC")
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.text)
                        Spacer(minLength: Space.sm)
                        OnbBadge(text: "Invite code")
                    }
                    Text("School calendar, homework, family chat, trips, meals — plus Screen Time.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint(fullOpen ? "Hides the invite code field." : "Shows a field for your invite code.")
            .accessibilityIdentifier(OnbID.chooseFull)

            if fullOpen {
                OnbTextField(title: "Invite code", prompt: "Enter your invite code", text: $inviteCode,
                             capitalization: .never, submitLabel: .go, onSubmit: continueFull,
                             identifier: OnbID.chooseInvite)
                    .onChange(of: inviteCode) { _, _ in
                        if inviteMessage != nil { inviteMessage = nil }
                    }
                if let inviteMessage { OnbErrorText(message: inviteMessage) }
                OnbPrimaryButton(title: "Continue", enabled: !trimmedCode.isEmpty, action: continueFull)
                    .accessibilityIdentifier(OnbID.chooseContinue)
            }
        }
        .onbPanel(selected: fullOpen)
    }

    private func continueFull() {
        guard !trimmedCode.isEmpty else { return }
        inviteMessage = nil
        onPick(.full)
    }
}

// MARK: - Name + passkey

struct OnbAccountView: View {
    let plan: OnboardingPlan
    @Binding var parentName: String
    let inviteCode: String
    let onBack: () -> Void
    let onCreated: () -> Void
    /// The server said the invite code was wrong: the router sends the parent back to Choose.
    let onInviteInvalid: () -> Void

    @State private var busy = false
    @State private var error: String?

    var body: some View {
        OnbPage(onBack: busy ? nil : onBack) {
            OnbTitle(title: "What should we call you?",
                     subtitle: "No password. Your face or fingerprint signs you in.")

            OnbTextField(title: "Your name", prompt: "First and last name", text: $parentName,
                         contentType: .name, capitalization: .words, submitLabel: .go,
                         onSubmit: create, identifier: OnbID.accountName)

            OnbPrimaryButton(title: busy ? "Creating…" : "Create my passkey", busy: busy, action: create)
                .accessibilityIdentifier(OnbID.accountPasskey)

            if let error { OnbErrorText(message: error) }

            Text("This is your own sign-in. Your kids get theirs on their own devices.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func create() {
        guard !busy else { return }
        let name = parentName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { error = "Please enter your name."; return }
        busy = true; error = nil
        let code: String? = plan == .full ? inviteCode : nil
        let chosen = plan
        Task {
            do {
                try await AuthService.shared.signUpWithPasskey(inviteCode: code, name: name)
                await MainActor.run {
                    busy = false
                    OnboardingProgress.begin(plan: chosen)
                    onCreated()
                }
            } catch {
                await MainActor.run {
                    busy = false
                    if OnbErrors.isCancellation(error) { return }
                    if let e = error as? AuthServerError, e.isInviteInvalid { onInviteInvalid(); return }
                    self.error = OnbErrors.friendly(error)
                }
            }
        }
    }
}

// MARK: - Family

struct OnbFamilyView: View {
    /// nil when the app was relaunched before a plan was stored: the server then decides.
    let plan: OnboardingPlan?
    let inviteCode: String
    let suggestedName: String
    let onDone: (OnbFamilyOutcome) -> Void

    @State private var familyName: String
    @State private var joinOpen = false
    @State private var joinCode = ""
    @State private var busy = false
    @State private var error: String?
    /// Set when the server refused the whole plan for want of an invite code.
    @State private var offerScreenTime = false
    @State private var planOverride: OnboardingPlan?

    init(plan: OnboardingPlan?, inviteCode: String, suggestedName: String,
         onDone: @escaping (OnbFamilyOutcome) -> Void) {
        self.plan = plan
        self.inviteCode = inviteCode
        self.suggestedName = suggestedName
        self.onDone = onDone
        _familyName = State(initialValue: suggestedName)
    }

    var body: some View {
        OnbPage {
            OnbTitle(
                title: joinOpen ? "Join your partner's family" : "Name your family",
                subtitle: joinOpen
                    ? "Ask your partner to show you their family code in Fam ETC."
                    : "This is what everyone in your family sees. You can change it later."
            )

            if joinOpen {
                OnbTextField(title: "Family code", prompt: "e.g. ABC123", text: $joinCode,
                             capitalization: .characters, submitLabel: .go, onSubmit: join,
                             identifier: OnbID.familyJoinCode)
                OnbPrimaryButton(title: busy ? "Joining…" : "Join our family", busy: busy,
                                 enabled: !joinCode.trimmingCharacters(in: .whitespaces).isEmpty, action: join)
                    .accessibilityIdentifier(OnbID.familyJoin)
            } else {
                OnbTextField(title: "Family name", prompt: "The Smith family", text: $familyName,
                             capitalization: .words, submitLabel: .go, onSubmit: create,
                             identifier: OnbID.familyName)
                OnbPrimaryButton(title: busy ? "Creating…" : "Create our family", busy: busy, action: create)
                    .accessibilityIdentifier(OnbID.familyCreate)
            }

            if let error { OnbErrorText(message: error) }

            if offerScreenTime && !joinOpen {
                OnbSecondaryButton(title: "Start with Screen Time instead") {
                    planOverride = .screenTime
                    offerScreenTime = false
                    create()
                }
            }

            OnbLinkButton(title: joinOpen ? "Creating a new family instead? Go back"
                                          : "Joining your partner's family? Enter their code",
                          enabled: !busy) {
                withAnimation(.easeInOut(duration: 0.2)) {
                    joinOpen.toggle()
                    error = nil
                    offerScreenTime = false
                }
            }
            .accessibilityIdentifier(OnbID.familyJoinToggle)
        }
    }

    private func create() {
        guard !busy else { return }
        busy = true; error = nil; offerScreenTime = false
        let chosen = planOverride ?? plan
        let trimmed = familyName.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = trimmed.isEmpty ? "Our family" : trimmed
        let code: String? = chosen == .full ? inviteCode : nil
        Task {
            do {
                let fam = try await AuthService.shared.createFamily(
                    name: name,
                    plan: chosen?.rawValue,
                    inviteCode: code,
                    timezone: TimeZone.current.identifier
                )
                let resolved = OnboardingPlan(serverValue: (fam["plan"] as? String) ?? chosen?.rawValue)
                let outcome = OnbFamilyOutcome(plan: resolved, joined: false, kidNames: onbKidNames(from: fam))
                await MainActor.run { busy = false; onDone(outcome) }
            } catch {
                await handleCreateFailure(error)
            }
        }
    }

    private func handleCreateFailure(_ error: Error) async {
        // A retry after a lost response: the family may already exist (409). Carry on from
        // what the server says rather than showing an error for work that succeeded.
        if let e = error as? AuthServerError, e.status == 409,
           case .signedIn(let state) = await AuthService.shared.onboardingServerState(), state.hasFamily {
            let outcome = OnbFamilyOutcome(plan: OnboardingPlan(serverValue: state.plan), joined: false,
                                           kidNames: state.kidNames)
            await MainActor.run { busy = false; onDone(outcome) }
            return
        }
        await MainActor.run {
            busy = false
            if let e = error as? AuthServerError, e.isInviteRequired {
                self.error = "The whole Fam ETC needs an invite code. You can start with Screen Time and upgrade later."
                offerScreenTime = true
            } else {
                self.error = OnbErrors.friendly(error)
            }
        }
    }

    private func join() {
        guard !busy else { return }
        let code = joinCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return }
        busy = true; error = nil
        Task {
            do {
                // The plan is inherited from the family; no invite code is needed.
                let fam = try await AuthService.shared.joinFamily(code: code)
                let outcome = OnbFamilyOutcome(plan: OnboardingPlan(serverValue: fam["plan"] as? String),
                                               joined: true, kidNames: onbKidNames(from: fam))
                await MainActor.run { busy = false; onDone(outcome) }
            } catch {
                await MainActor.run { busy = false; self.error = OnbErrors.friendly(error) }
            }
        }
    }
}

// MARK: - Kids

struct OnbKidsView: View {
    let plan: OnboardingPlan
    let onContinue: () -> Void

    @State private var kids: [String]
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    init(plan: OnboardingPlan, initialKids: [String], onContinue: @escaping () -> Void) {
        self.plan = plan
        self.onContinue = onContinue
        _kids = State(initialValue: initialKids)
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canContinue: Bool { !kids.isEmpty || !trimmedName.isEmpty }

    var body: some View {
        OnbPage {
            OnbTitle(title: "Add your kids",
                     subtitle: "Just a first name each. Every kid gets their own sign-in on their own iPhone or iPad.")

            if !kids.isEmpty {
                VStack(alignment: .leading, spacing: Space.sm) {
                    ForEach(Array(kids.enumerated()), id: \.offset) { _, kid in
                        HStack(spacing: Space.sm) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.green).accessibilityHidden(true)
                            Text(kid).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                            Spacer(minLength: 0)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(kid), added")
                    }
                }
                .onbPanel()
            }

            OnbTextField(title: kids.isEmpty ? "First name" : "Add another kid", prompt: "e.g. Maya", text: $name,
                         contentType: .givenName, capitalization: .words, submitLabel: .done,
                         onSubmit: addOnly, identifier: OnbID.kidsName)

            if !trimmedName.isEmpty {
                OnbSecondaryButton(title: "Add \(trimmedName)", enabled: !busy) { addOnly() }
                    .accessibilityIdentifier(OnbID.kidsAdd)
            }

            if let error { OnbErrorText(message: error) }

            OnbPrimaryButton(title: "Continue", busy: busy, enabled: canContinue, action: continueTapped)
                .accessibilityIdentifier(OnbID.kidsContinue)

            if plan == .full && kids.isEmpty {
                OnbLinkButton(title: "Skip for now", enabled: !busy, action: onContinue)
                    .accessibilityIdentifier(OnbID.kidsSkip)
            }

            Text("You create your kids' profiles, and a kid can only sign in once you approve them.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func addOnly() {
        guard !busy, !trimmedName.isEmpty else { return }
        busy = true; error = nil
        Task {
            let ok = await add(trimmedName)
            await MainActor.run { busy = false; if ok { name = "" } }
        }
    }

    private func continueTapped() {
        guard !busy else { return }
        guard !trimmedName.isEmpty else { onContinue(); return }
        busy = true; error = nil
        Task {
            let ok = await add(trimmedName)
            await MainActor.run {
                busy = false
                if ok { name = ""; onContinue() }
            }
        }
    }

    /// Adds one kid through the existing endpoint; the server's kid list is the truth.
    private func add(_ kidName: String) async -> Bool {
        do {
            let fam = try await AuthService.shared.addKid(name: kidName, grade: "", color: nil)
            let names = onbKidNames(from: fam)
            await MainActor.run { kids = names.isEmpty ? kids + [kidName] : names }
            return true
        } catch {
            await MainActor.run { self.error = OnbErrors.friendly(error) }
            return false
        }
    }
}

// MARK: - Recovery codes (the existing RecoveryCodesView, now a step)

struct OnbRecoveryStepView: View {
    let onDone: () -> Void

    @State private var codes: [String]?

    var body: some View {
        Group {
            if let codes {
                RecoveryCodesView(codes: codes) {
                    OnboardingProgress.recoveryCodesSaved()
                    onDone()
                }
            } else {
                ProgressView("Getting your recovery codes…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await mint() }
    }

    /// Mints the codes the first time. If they were already minted for THIS onboarding but
    /// never confirmed saved (the app was closed mid-way), issue a fresh set: the old
    /// plaintext is gone. An existing account's codes are never regenerated here.
    @MainActor private func mint() async {
        guard codes == nil else { return }
        var result = await AuthService.shared.issueBackupCodesIfNeeded()
        if (result == nil || result?.isEmpty == true) && OnboardingProgress.recoveryCodesPending {
            result = try? await AuthService.shared.regenerateBackupCodes()
        }
        if let result, !result.isEmpty {
            codes = result
        } else {
            OnboardingProgress.recoveryCodesSaved()
            onDone()
        }
    }
}

// MARK: - Notifications

struct OnbNotificationsView: View {
    let onDone: () -> Void

    @State private var busy = false

    var body: some View {
        OnbPage {
            Image(systemName: "bell.badge.fill")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Palette.accent)
                .frame(width: 60, height: 60)
                .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .accessibilityHidden(true)

            OnbTitle(title: "Stay in the loop",
                     subtitle: "Get a nudge when a kid asks for more time or a device needs a look. You can change this any time in Settings.")

            OnbPrimaryButton(title: "Turn on notifications", busy: busy, action: enable)
                .accessibilityIdentifier(OnbID.notificationsEnable)
            OnbLinkButton(title: "Not now", enabled: !busy, action: onDone)
                .accessibilityIdentifier(OnbID.notificationsSkip)
        }
    }

    private func enable() {
        guard !busy else { return }
        busy = true
        Task {
            let granted = (try? await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            // The existing service registers the APNs token (and will not prompt again).
            if granted { PushRegistrationService.shared.requestAuthorizationAndRegister() }
            await MainActor.run { busy = false; onDone() }
        }
    }
}

// MARK: - Device setup

struct OnbDevicesView: View {
    /// "Do it later" (Home keeps the checklist pinned) or the end of the list.
    let onLater: () -> Void

    @Environment(AppStore.self) private var store
    @State private var ready = false

    var body: some View {
        // The checklist is a screen by itself (it draws its own scroll view, canvas and iPad
        // width), so the heading and "Do it later" are pinned above and below it.
        Group {
            if ready {
                DeviceSetupChecklistView(kidIds: nil)
            } else {
                ProgressView("Getting your kids' setup ready…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.bg.ignoresSafeArea())
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .safeAreaInset(edge: .bottom, spacing: 0) { footer }
        .task {
            // The checklist reads the family's kids; make sure the account that was just
            // created is loaded. (It loads the Screen Time overview itself.)
            await store.load()
            ready = true
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            OnbBrand()
            Text("Set up each kid's device")
                .font(Typography.title)
                .foregroundStyle(Palette.text)
                .accessibilityAddTraits(.isHeader)
            Text("Follow these steps for each kid. You can pick this up later from Home.")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .padding(.horizontal, Space.xl)
        .padding(.top, Space.sm)
        .padding(.bottom, Space.md)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
        .background(Palette.bg)
    }

    private var footer: some View {
        OnbSecondaryButton(title: "Do it later", action: onLater)
            .accessibilityIdentifier(OnbID.devicesLater)
            .padding(.horizontal, Space.xl)
            .padding(.top, Space.md)
            .padding(.bottom, Space.lg)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
            .background(.ultraThinMaterial)
    }
}
