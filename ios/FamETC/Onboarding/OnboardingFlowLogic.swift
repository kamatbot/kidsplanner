import Foundation

// Pure, UI-free pieces of the onboarding flow (docs/SCREEN-TIME-ONLY-PLAN.md §2/§3):
// the step order, where to resume after a relaunch, the kid setup-code alphabet,
// and the family-name suggestion. Kept free of SwiftUI so they can be unit-tested.

/// Which product a new family is on. Raw values are the server's `family.plan`.
enum OnboardingPlan: String, Equatable {
    case screenTime = "screen_time"
    case full

    /// Absent or unknown (older server / cache) means the whole Fam ETC, like `Family.productPlan`.
    init(serverValue: String?) {
        self = serverValue == "screen_time" ? .screenTime : .full
    }
}

/// The parent steps in order. The raw value is persisted (`OnboardingProgress`), so
/// only ever append new steps in the right place and never renumber lightly.
enum OnboardingStep: Int, Comparable, CaseIterable {
    case welcome = 0, choose, account, family, kids, recovery, notifications, devices

    static func < (lhs: OnboardingStep, rhs: OnboardingStep) -> Bool { lhs.rawValue < rhs.rawValue }

    /// The step after this one, or nil when onboarding is complete. The device-setup
    /// checklist belongs to the Screen Time plan only: the whole-Fam-ETC path keeps
    /// today's behaviour and ends after notifications.
    func next(plan: OnboardingPlan) -> OnboardingStep? {
        switch self {
        case .welcome: return .choose
        case .choose: return .account
        case .account: return .family
        case .family: return .kids
        case .kids: return .recovery
        case .recovery: return .notifications
        case .notifications: return plan == .screenTime ? .devices : nil
        case .devices: return nil
        }
    }
}

enum OnboardingResume: Equatable {
    case welcome
    case step(OnboardingStep)
    case finish
}

enum OnboardingResolver {
    /// Where a relaunch should land, from SERVER state first and the local progress
    /// marker second:
    ///  - not signed in: the welcome screen;
    ///  - a signed-in kid: nothing to onboard, go to the app;
    ///  - a signed-in parent with no family: the family step (the account exists);
    ///  - a parent with a family but no onboarding in progress on this device (an
    ///    existing account): straight into the app;
    ///  - otherwise the later of "what the server proves is done" (kids exist) and the
    ///    furthest step this device recorded.
    static func resolve(isSignedIn: Bool, role: String?, hasFamily: Bool, plan: OnboardingPlan,
                        kidCount: Int, active: Bool, marker: OnboardingStep?) -> OnboardingResume {
        guard isSignedIn else { return .welcome }
        if role == "kid" { return .finish }
        guard hasFamily else { return .step(.family) }
        guard active else { return .finish }
        let serverFloor: OnboardingStep = kidCount == 0 ? .kids : .recovery
        let step = max(serverFloor, marker ?? .family)
        if step == .devices && plan != .screenTime { return .finish }
        return .step(step)
    }
}

/// Device-local onboarding progress. Server state wins on resume; this only records
/// what the server cannot know (recovery codes shown, notifications offered, the plan
/// chosen before the family existed).
enum OnboardingProgress {
    static let activeKey = "fam_onboard_active"
    static let stepKey = "fam_onboard_step"
    static let planKey = "fam_onboard_plan"
    static let codesPendingKey = "fam_onboard_codes_pending"

    private static var defaults: UserDefaults { .standard }

    /// True from account creation until onboarding finishes on this device.
    static var isActive: Bool { defaults.bool(forKey: activeKey) }

    /// The furthest step reached (nil if none recorded).
    static var step: OnboardingStep? {
        guard defaults.object(forKey: stepKey) != nil else { return nil }
        return OnboardingStep(rawValue: defaults.integer(forKey: stepKey))
    }

    /// The plan picked on the Choose step (nil if the app was killed before one was stored).
    static var plan: OnboardingPlan? {
        defaults.string(forKey: planKey).flatMap(OnboardingPlan.init(rawValue:))
    }

    /// True while recovery codes were minted for this onboarding but not yet confirmed saved.
    static var recoveryCodesPending: Bool { defaults.bool(forKey: codesPendingKey) }

    /// The account was just created in this flow: it has no recovery codes shown yet.
    static func begin(plan: OnboardingPlan) {
        defaults.set(true, forKey: activeKey)
        defaults.set(OnboardingStep.family.rawValue, forKey: stepKey)
        defaults.set(plan.rawValue, forKey: planKey)
        defaults.set(true, forKey: codesPendingKey)
    }

    /// Record a step as reached (never moves backwards).
    static func advance(to step: OnboardingStep) {
        if let current = Self.step, current >= step { return }
        defaults.set(step.rawValue, forKey: stepKey)
    }

    static func setPlan(_ plan: OnboardingPlan) { defaults.set(plan.rawValue, forKey: planKey) }

    static func setActive() { defaults.set(true, forKey: activeKey) }

    static func recoveryCodesSaved() { defaults.set(false, forKey: codesPendingKey) }

    /// Onboarding is over (finished, or a different sign-in took over).
    static func reset() {
        for key in [activeKey, stepKey, planKey, codesPendingKey] { defaults.removeObject(forKey: key) }
    }
}

/// The per-kid setup code a parent shows and a kid types (D6): 6 characters from an
/// alphabet without 0/O/1/I, case-insensitive, spaces and dashes ignored.
enum KidSetupCodeFormat {
    static let alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    static let length = 6

    /// Uppercases, drops anything outside the alphabet (spaces, dashes, look-alikes)
    /// and caps at `length`, so a pasted "abc-def" becomes "ABCDEF".
    static func normalize(_ raw: String) -> String {
        let allowed = Set(alphabet)
        return String(raw.uppercased().filter { allowed.contains($0) }.prefix(length))
    }

    static func isComplete(_ raw: String) -> Bool { normalize(raw).count == length }
}

enum FamilyNameSuggestion {
    /// Generational suffixes that are never the surname ("Jane Smith Jr." -> "Smith").
    private static let suffixes: Set<String> = ["jr", "sr", "ii", "iii", "iv"]

    private static func isSuffix(_ word: Substring) -> Bool {
        suffixes.contains(word.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".,")))
    }

    /// "The {Surname} family" from a full name; "Our family" when there is no surname to use.
    static func suggest(forParentName name: String) -> String {
        var parts = name.split(whereSeparator: { $0.isWhitespace })
        while parts.count > 1, let last = parts.last, isSuffix(last) { parts.removeLast() }
        guard parts.count >= 2, let last = parts.last else { return "Our family" }
        let surname = last.trimmingCharacters(in: CharacterSet(charactersIn: ","))
        return surname.isEmpty ? "Our family" : "The \(surname) family"
    }
}
