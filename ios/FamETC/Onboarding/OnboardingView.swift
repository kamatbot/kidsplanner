import SwiftUI

// Fam ETC native onboarding (docs/SCREEN-TIME-ONLY-PLAN.md §2 and §3).
//
//   Parent: Welcome → Choose (Screen Time · the whole Fam ETC) → name + passkey → Family →
//           Kids → Recovery codes → Notifications → Device setup → the app.
//           (The whole-Fam-ETC path ends after Notifications; the checklist is Screen Time's.)
//   Kid:    Welcome → I'm a kid → type the code → "Hi {Kid}!" → waiting → passkey (or continue
//           without) → the app. See KidSignInView.
//
// This view only routes. Each step is its own view (OnboardingSteps.swift) that talks to
// AuthService and reports back. Every step is resumable: on launch we ask the server who is
// signed in and what exists (family, kids) and land on the first unfinished step; the local
// `OnboardingProgress` only records what the server cannot know.
struct OnboardingView: View {
    /// Called when onboarding finishes (the app takes over) or a sign-in replaces it.
    let onFinish: (String?) -> Void

    @AppStorage("fam_logout_unconfirmed") private var logoutUnconfirmed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var step: OnboardingStep = .welcome
    @State private var kidFlow = false
    @State private var didCheckResume = false

    /// The plan picked on Choose, or resolved from the family. nil = unknown (resumed before
    /// the family existed with nothing stored): the server then decides.
    @State private var plan: OnboardingPlan?
    @State private var inviteCode = ""
    @State private var inviteMessage: String?
    @State private var parentName = ""
    @State private var familyKids: [String] = []

    var body: some View {
        ZStack {
            Palette.bg.ignoresSafeArea()
            if kidFlow {
                KidSignInView(onFinish: onFinish, onBack: { kidFlow = false; step = .welcome })
            } else {
                parentScreen
            }
        }
        .foregroundStyle(Palette.text)
        .tint(Palette.accent)
        .safeAreaInset(edge: .top) {
            if logoutUnconfirmed {
                HStack {
                    Text("Signed out on this device. Server sign-out could not be confirmed.")
                        .font(.footnote)
                    Button("Dismiss") { logoutUnconfirmed = false }
                }
                .padding()
                .background(Palette.panel)
            }
        }
        .task {
            #if DEBUG
            if applyDebugStart() { return }
            #endif
            await resumeIfNeeded()
        }
    }

    // MARK: Parent steps

    /// Setup runs account → devices: six steps on the Screen Time plan (it ends with the device
    /// checklist), five on the whole Fam ETC. An unknown plan counts as the whole Fam ETC, like
    /// `advance(from:)`.
    private var setupSteps: Int { (plan ?? .full) == .screenTime ? 6 : 5 }
    /// Where the current step sits in the setup progress bar (account = 1 … devices = 6).
    private var setupPosition: Int { step.rawValue - 1 }

    @ViewBuilder private var parentScreen: some View {
        switch step {
        case .welcome:
            OnbWelcomeView(
                onSetUp: { go(.choose) },
                onKid: { kidFlow = true },
                onSignedIn: { finish(track: false) }
            )
        case .choose:
            OnbChooseView(
                inviteCode: $inviteCode,
                inviteMessage: $inviteMessage,
                onBack: { go(.welcome) },
                onPick: { picked in
                    plan = picked
                    go(.account)
                }
            )
        case .account:
            OnbAccountView(
                plan: plan ?? .screenTime,
                parentName: $parentName,
                inviteCode: inviteCode,
                step: setupPosition, steps: setupSteps,
                onBack: { go(.choose) },
                onCreated: { go(.family) },
                onInviteInvalid: {
                    inviteMessage = "That code didn't work — check it, or start with Screen Time and upgrade later."
                    go(.choose)
                }
            )
        case .family:
            OnbFamilyView(
                plan: plan,
                inviteCode: inviteCode,
                suggestedName: FamilyNameSuggestion.suggest(forParentName: parentName),
                step: setupPosition, steps: setupSteps,
                onDone: familyDone
            )
        case .kids:
            OnbKidsView(plan: plan ?? .full, initialKids: familyKids,
                        step: setupPosition, steps: setupSteps, onContinue: { advance(from: .kids) })
        case .recovery:
            OnbRecoveryStepView(step: setupPosition, steps: setupSteps, onDone: { advance(from: .recovery) })
        case .notifications:
            OnbNotificationsView(step: setupPosition, steps: setupSteps, onDone: { advance(from: .notifications) })
        case .devices:
            OnbDevicesView(step: setupPosition, steps: setupSteps, onLater: { finish(track: true) })
        }
    }

    // MARK: Navigation

    private func go(_ next: OnboardingStep) {
        if reduceMotion {
            step = next
        } else {
            withAnimation(.easeInOut(duration: 0.2)) { step = next }
        }
    }

    /// Records the next step as reached, then shows it (or finishes when there is none).
    private func advance(from current: OnboardingStep) {
        if let next = current.next(plan: plan ?? .full) {
            OnboardingProgress.advance(to: next)
            go(next)
        } else {
            finish(track: true)
        }
    }

    private func familyDone(_ outcome: OnbFamilyOutcome) {
        plan = outcome.plan
        familyKids = outcome.kidNames
        OnboardingProgress.setActive()
        OnboardingProgress.setPlan(outcome.plan)
        // A partner joining an existing family has nothing to add; they go straight on.
        let target: OnboardingStep = outcome.joined ? .recovery : .kids
        OnboardingProgress.advance(to: target)
        go(target)
    }

    /// Onboarding is over: `fam_onboarded` is set by the root, which then picks the layout for the
    /// family's plan. `track` is false when an existing account simply signed in.
    private func finish(track: Bool) {
        if track { APIClient.shared.track("onboarding_complete") }
        OnboardingProgress.reset()
        onFinish(nil)
    }

    // MARK: Resume

    #if DEBUG
    /// QA screenshots only (FAM_ONBOARDING_STEP / FAM_KID_STAGE); inert unless those are set.
    private func applyDebugStart() -> Bool {
        if DebugLaunch.kidStage != nil { kidFlow = true; return true }
        guard let target = DebugLaunch.onboardingStep else { return false }
        plan = .screenTime
        parentName = "Kate Walker"
        step = target
        return true
    }
    #endif

    /// If the app was closed after the account or family was created, pick up at the first
    /// unfinished step using server state (me / family / kids), not only local flags.
    private func resumeIfNeeded() async {
        guard !didCheckResume else { return }
        didCheckResume = true
        let lookup = await AuthService.shared.onboardingServerState()
        // The person may already have moved on while we asked.
        guard step == .welcome, !kidFlow else { return }
        switch lookup {
        case .signedOut:
            // A session that no longer exists cannot be mid-onboarding.
            if OnboardingProgress.isActive { OnboardingProgress.reset() }
        case .unavailable:
            break
        case .signedIn(let state):
            let resolved = OnboardingResolver.resolve(
                isSignedIn: true,
                role: state.role,
                hasFamily: state.hasFamily,
                plan: OnboardingPlan(serverValue: state.plan),
                kidCount: state.kidNames.count,
                active: OnboardingProgress.isActive,
                marker: OnboardingProgress.step
            )
            switch resolved {
            case .welcome:
                break
            case .finish:
                finish(track: false)
            case .step(let target):
                if let name = state.parentName, parentName.isEmpty { parentName = name }
                familyKids = state.kidNames
                plan = state.hasFamily ? OnboardingPlan(serverValue: state.plan) : OnboardingProgress.plan
                // An account with no family yet is mid-onboarding by definition.
                if !state.hasFamily { OnboardingProgress.setActive() }
                go(target)
            }
        }
    }
}
