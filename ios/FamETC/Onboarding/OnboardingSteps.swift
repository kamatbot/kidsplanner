import SwiftUI
import UserNotifications

// The parent steps of onboarding, one view each. Every view
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

    /// Reading, play and rest: the family days Fam ETC helps plan.
    private static let collage: [OnbStickerCollage.Item] = [
        .init(sticker: .sleepyCat, size: 0.66, x: 0.32, y: 0.56, tilt: -8),
        .init(sticker: .cyclingBunny, size: 0.54, x: 0.70, y: 0.32, tilt: 8),
        .init(sticker: .readingBear, size: 0.48, x: 0.74, y: 0.74, tilt: -5),
    ]

    var body: some View {
        OnbPage {
            OnbStickerCollage(items: Self.collage, hue: .violet, height: 196)

            OnbTitle(
                title: "School, homework and family plans in one place.",
                subtitle: "Calendars, homework, family chat, trips and meals for parents and kids. Invite-only for now."
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

    /// Why families use Fam ETC — plain family reasons, no statistics.
    private var whyItMatters: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Text("Why it matters")
                .font(Theme.font(22, weight: .bold, relativeTo: .title2))
                .foregroundStyle(Palette.text)
                .accessibilityAddTraits(.isHeader)
            OnbReasonRow(sticker: .readingBear, hue: .teal, title: "Homework on track",
                         detail: "Due dates, small steps and a calm nudge, so evenings run smoother.")
            OnbReasonRow(sticker: .cyclingBunny, hue: .violet, title: "One family calendar",
                         detail: "School events, clubs and pick-ups for everyone, in one place.")
            OnbReasonRow(sticker: .gratefulOtter, hue: .pink, title: "Chat that stays in the family",
                         detail: "Quick messages, voice notes and Buzz for everyone at home.")
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

    private var trimmedCode: String { inviteCode.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        OnbPage(onBack: onBack) {
            OnbTitle(title: "Have an invite code?",
                     subtitle: "Fam ETC is invite-only for now. Enter the code you were given.")

            VStack(alignment: .leading, spacing: Space.md) {
                HStack(alignment: .top, spacing: Space.lg) {
                    OnbStickerBadge(sticker: .rainbow, hue: .orange, size: 64)
                    VStack(alignment: .leading, spacing: Space.sm) {
                        HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                            Text("Fam ETC")
                                .font(Typography.cardTitle)
                                .foregroundStyle(Palette.text)
                            Spacer(minLength: Space.sm)
                            OnbBadge(text: "Invite code")
                        }
                        Text("School calendar, homework, family chat, trips and meals.")
                            .font(Typography.body)
                            .foregroundStyle(Palette.textSecond)
                            .fixedSize(horizontal: false, vertical: true)
                            .multilineTextAlignment(.leading)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(OnbID.chooseFull)

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
            .onbPanel(selected: true)

            // A co-parent joins with their partner's parent code on the Family step,
            // so they need no invite code here.
            OnbLinkButton(title: "Joining your partner's family? Continue without a code") {
                inviteCode = ""
                inviteMessage = nil
                onPick(.full)
            }
            .accessibilityIdentifier(OnbID.chooseNoCode)
        }
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
    /// Position in the setup progress bar (1-based); nil hides it.
    var step: Int? = nil
    var steps: Int = 0
    let onBack: () -> Void
    let onCreated: () -> Void
    /// The server said the invite code was wrong: the router sends the parent back to Choose.
    let onInviteInvalid: () -> Void

    @State private var busy = false
    @State private var error: String?

    var body: some View {
        OnbPage(onBack: busy ? nil : onBack, hero: .sunshine, hue: .gold, step: step, steps: steps) {
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
        let trimmedCode = inviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let code: String? = trimmedCode.isEmpty ? nil : trimmedCode
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
    /// Position in the setup progress bar (1-based); nil hides it.
    let step: Int?
    let steps: Int
    let onDone: (OnbFamilyOutcome) -> Void

    @State private var familyName: String
    @State private var joinOpen = false
    @State private var joinCode = ""
    @State private var busy = false
    @State private var error: String?
    /// Set when the server refused to create a family for want of an invite code.
    @State private var needsInvite = false
    @State private var inviteEntry = ""

    init(plan: OnboardingPlan?, inviteCode: String, suggestedName: String,
         step: Int? = nil, steps: Int = 0, onDone: @escaping (OnbFamilyOutcome) -> Void) {
        self.plan = plan
        self.inviteCode = inviteCode
        self.suggestedName = suggestedName
        self.step = step
        self.steps = steps
        self.onDone = onDone
        _familyName = State(initialValue: suggestedName)
    }

    var body: some View {
        OnbPage(hero: .happyCapybara, hue: .teal, step: step, steps: steps) {
            OnbTitle(
                title: joinOpen ? "Join your partner's family" : "Name your family",
                subtitle: joinOpen
                    ? "Ask your co-parent to tap Make parent code in Family settings, then enter their parent invite code here."
                    : "This is what everyone in your family sees. You can change it later."
            )

            if joinOpen {
                OnbTextField(title: "Parent invite code", prompt: "e.g. ABCD2345", text: $joinCode,
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

            if needsInvite && !joinOpen {
                OnbTextField(title: "Invite code", prompt: "Enter your invite code", text: $inviteEntry,
                             capitalization: .never, submitLabel: .go, onSubmit: create,
                             identifier: OnbID.familyInvite)
            }

            if let error { OnbErrorText(message: error) }

            OnbLinkButton(title: joinOpen ? "Creating a new family instead? Go back"
                                          : "Joining your partner's family? Enter their parent invite code",
                          enabled: !busy) {
                withAnimation(.easeInOut(duration: 0.2)) {
                    joinOpen.toggle()
                    error = nil
                }
            }
            .accessibilityIdentifier(OnbID.familyJoinToggle)
        }
    }

    private func create() {
        guard !busy else { return }
        busy = true; error = nil
        let chosen = plan
        let trimmed = familyName.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = trimmed.isEmpty ? "Our family" : trimmed
        let typed = (needsInvite ? inviteEntry : inviteCode).trimmingCharacters(in: .whitespacesAndNewlines)
        let code: String? = typed.isEmpty ? nil : typed
        Task {
            do {
                let fam = try await AuthService.shared.createFamily(
                    name: name,
                    plan: nil,
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
                self.error = needsInvite
                    ? "That invite code didn't work. Check it and try again."
                    : "Creating a family needs an invite code. Enter it above, or join your partner's family."
                needsInvite = true
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
                // Joining a partner's family needs no invite code.
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
    /// Position in the setup progress bar (1-based); nil hides it.
    let step: Int?
    let steps: Int
    let onContinue: () -> Void

    @State private var kids: [String]
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    init(plan: OnboardingPlan, initialKids: [String], step: Int? = nil, steps: Int = 0,
         onContinue: @escaping () -> Void) {
        self.plan = plan
        self.step = step
        self.steps = steps
        self.onContinue = onContinue
        _kids = State(initialValue: initialKids)
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canContinue: Bool { !kids.isEmpty || !trimmedName.isEmpty }

    var body: some View {
        OnbPage(hero: .joyfulPanda, hue: .pink, step: step, steps: steps) {
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
    /// Position in the setup progress bar (1-based); nil hides it.
    var step: Int? = nil
    var steps: Int = 0
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
        .safeAreaInset(edge: .top, spacing: 0) {
            if let step, steps > 0 {
                OnbStepProgress(current: step, total: steps)
                    .padding(.horizontal, Space.xl)
                    .padding(.vertical, Space.sm)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
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
    /// Position in the setup progress bar (1-based); nil hides it.
    var step: Int? = nil
    var steps: Int = 0
    let onDone: () -> Void

    @State private var busy = false

    var body: some View {
        OnbPage(hero: .paperPlane, hue: .violet, step: step, steps: steps) {
            OnbTitle(title: "Stay in the loop",
                     subtitle: "Get a nudge for family chat, homework and when a kid asks to sign in. You can change this any time in Settings.")

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
