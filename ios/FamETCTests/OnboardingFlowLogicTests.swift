import XCTest
@testable import FamETC

/// The pure onboarding pieces (docs/SCREEN-TIME-ONLY-PLAN.md §2/§3) in `OnboardingFlowLogic.swift`:
/// plan decoding, step order, relaunch resume, the kid setup-code format and the family-name suggestion.
final class OnboardingFlowLogicTests: XCTestCase {

    // MARK: OnboardingPlan / OnboardingStep

    func testPlanReadsTheServerValueAndDefaultsToFull() {
        XCTAssertEqual(OnboardingPlan(serverValue: "screen_time"), .screenTime)
        XCTAssertEqual(OnboardingPlan(serverValue: "full"), .full)
        XCTAssertEqual(OnboardingPlan(serverValue: nil), .full)
        XCTAssertEqual(OnboardingPlan(serverValue: "something_new"), .full)
        XCTAssertEqual(OnboardingPlan.screenTime.rawValue, "screen_time")
        XCTAssertEqual(OnboardingPlan.full.rawValue, "full")
    }

    func testStepsAreOrderedAndTheRawValuesStayStable() {
        XCTAssertEqual(OnboardingStep.allCases, [.welcome, .choose, .account, .family, .kids, .recovery, .notifications, .devices])
        XCTAssertEqual(OnboardingStep.allCases.map(\.rawValue), [0, 1, 2, 3, 4, 5, 6, 7])
        XCTAssertTrue(OnboardingStep.family < OnboardingStep.kids)
        XCTAssertTrue(OnboardingStep.devices > OnboardingStep.notifications)
        XCTAssertEqual(max(OnboardingStep.kids, OnboardingStep.recovery), .recovery)
    }

    func testScreenTimePlanEndsWithTheDeviceChecklist() {
        var steps: [OnboardingStep] = [.welcome]
        while let next = steps.last?.next(plan: .screenTime) { steps.append(next) }
        XCTAssertEqual(steps, OnboardingStep.allCases)
        XCTAssertNil(OnboardingStep.devices.next(plan: .screenTime))
    }

    func testFullPlanEndsAfterNotifications() {
        var steps: [OnboardingStep] = [.welcome]
        while let next = steps.last?.next(plan: .full) { steps.append(next) }
        XCTAssertEqual(steps, [.welcome, .choose, .account, .family, .kids, .recovery, .notifications])
        XCTAssertNil(OnboardingStep.notifications.next(plan: .full))
        XCTAssertNil(OnboardingStep.devices.next(plan: .full))
    }

    // MARK: OnboardingResolver

    private func resolve(isSignedIn: Bool = true, role: String? = "parent", hasFamily: Bool = true,
                         plan: OnboardingPlan = .screenTime, kidCount: Int = 0, active: Bool = true,
                         marker: OnboardingStep? = nil) -> OnboardingResume {
        OnboardingResolver.resolve(isSignedIn: isSignedIn, role: role, hasFamily: hasFamily, plan: plan,
                                   kidCount: kidCount, active: active, marker: marker)
    }

    func testSignedOutAlwaysGoesToWelcome() {
        XCTAssertEqual(resolve(isSignedIn: false), .welcome)
        XCTAssertEqual(resolve(isSignedIn: false, role: "kid", hasFamily: true, kidCount: 3, marker: .devices), .welcome)
        XCTAssertEqual(resolve(isSignedIn: false, role: nil, hasFamily: false, active: false), .welcome)
    }

    func testSignedInKidHasNothingToOnboard() {
        XCTAssertEqual(resolve(role: "kid"), .finish)
        XCTAssertEqual(resolve(role: "kid", hasFamily: false, marker: .family), .finish)
        XCTAssertEqual(resolve(role: "kid", active: false), .finish)
    }

    func testParentWithoutAFamilyResumesAtTheFamilyStep() {
        XCTAssertEqual(resolve(hasFamily: false), .step(.family))
        XCTAssertEqual(resolve(hasFamily: false, active: false), .step(.family))
        XCTAssertEqual(resolve(role: nil, hasFamily: false, marker: .notifications), .step(.family))
    }

    func testExistingAccountWithNoOnboardingInProgressGoesStraightToTheApp() {
        XCTAssertEqual(resolve(kidCount: 2, active: false, marker: nil), .finish)
        XCTAssertEqual(resolve(kidCount: 0, active: false, marker: .kids), .finish)
        XCTAssertEqual(resolve(plan: .full, active: false), .finish)
    }

    func testNoKidsYetResumesAtKidsAtLeast() {
        XCTAssertEqual(resolve(kidCount: 0, marker: nil), .step(.kids))
        XCTAssertEqual(resolve(kidCount: 0, marker: .welcome), .step(.kids))
        XCTAssertEqual(resolve(kidCount: 0, marker: .family), .step(.kids))
        XCTAssertEqual(resolve(kidCount: 0, marker: .kids), .step(.kids))
    }

    func testKidsExistingProvesTheKidsStepIsDone() {
        XCTAssertEqual(resolve(kidCount: 1, marker: nil), .step(.recovery))
        XCTAssertEqual(resolve(kidCount: 3, marker: .family), .step(.recovery))
        XCTAssertEqual(resolve(kidCount: 1, marker: .kids), .step(.recovery))
    }

    func testTheFurthestRecordedStepWinsOverTheServerFloor() {
        XCTAssertEqual(resolve(kidCount: 0, marker: .recovery), .step(.recovery))
        XCTAssertEqual(resolve(kidCount: 2, marker: .notifications), .step(.notifications))
        XCTAssertEqual(resolve(kidCount: 2, marker: .recovery), .step(.recovery))
    }

    func testDeviceChecklistResumesOnlyOnTheScreenTimePlan() {
        XCTAssertEqual(resolve(plan: .screenTime, kidCount: 2, marker: .devices), .step(.devices))
        XCTAssertEqual(resolve(plan: .full, kidCount: 2, marker: .devices), .finish)
        XCTAssertEqual(resolve(plan: .full, kidCount: 0, marker: .devices), .finish)
    }

    func testFullPlanResumesNormallyBeforeTheDevicesStep() {
        XCTAssertEqual(resolve(plan: .full, kidCount: 0, marker: nil), .step(.kids))
        XCTAssertEqual(resolve(plan: .full, kidCount: 1, marker: .notifications), .step(.notifications))
    }

    // MARK: KidSetupCodeFormat

    func testAlphabetHasNoLookAlikes() {
        XCTAssertEqual(KidSetupCodeFormat.length, 6)
        XCTAssertEqual(KidSetupCodeFormat.alphabet.count, 32)
        XCTAssertEqual(Set(KidSetupCodeFormat.alphabet).count, 32)
        for rejected in ["0", "O", "1", "I"] {
            XCTAssertFalse(KidSetupCodeFormat.alphabet.contains(rejected), "\(rejected) must not be in the alphabet")
        }
        XCTAssertEqual(KidSetupCodeFormat.alphabet, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    }

    func testNormalizeUppercases() {
        XCTAssertEqual(KidSetupCodeFormat.normalize("abcdef"), "ABCDEF")
        XCTAssertEqual(KidSetupCodeFormat.normalize("aB3dEf"), "AB3DEF")
    }

    func testNormalizeStripsSpacesAndDashes() {
        XCTAssertEqual(KidSetupCodeFormat.normalize("abc def"), "ABCDEF")
        XCTAssertEqual(KidSetupCodeFormat.normalize("ab-cd-ef"), "ABCDEF")
        XCTAssertEqual(KidSetupCodeFormat.normalize("  a b - c "), "ABC")
        XCTAssertEqual(KidSetupCodeFormat.normalize(" \n\t "), "")
    }

    func testNormalizeRejectsZeroOneAndTheLettersOAndI() {
        XCTAssertEqual(KidSetupCodeFormat.normalize("0O1I"), "")
        XCTAssertEqual(KidSetupCodeFormat.normalize("a0b1c"), "ABC")
        XCTAssertEqual(KidSetupCodeFormat.normalize("abcdoi"), "ABCD")
    }

    func testNormalizeCapsAtSixAfterDroppingInvalidCharacters() {
        XCTAssertEqual(KidSetupCodeFormat.normalize("ABCDEFGH"), "ABCDEF")
        XCTAssertEqual(KidSetupCodeFormat.normalize("A1B2C3D4"), "AB2C3D")
        XCTAssertEqual(KidSetupCodeFormat.normalize("0O1I234567"), "234567")
    }

    func testNormalizeIsIdempotentAndKeepsEveryAlphabetCharacter() {
        for raw in ["abc-def", "A1B2C3D4", "  zz 99 ", "", "0O1I"] {
            let once = KidSetupCodeFormat.normalize(raw)
            XCTAssertEqual(KidSetupCodeFormat.normalize(once), once)
        }
        let every = KidSetupCodeFormat.alphabet
        XCTAssertEqual(KidSetupCodeFormat.normalize(every), String(every.prefix(6)))
        XCTAssertEqual(KidSetupCodeFormat.normalize(String(every.suffix(6))), String(every.suffix(6)))
    }

    func testIsCompleteNeedsSixValidCharacters() {
        XCTAssertTrue(KidSetupCodeFormat.isComplete("ABCDEF"))
        XCTAssertTrue(KidSetupCodeFormat.isComplete("abc-def"))
        XCTAssertTrue(KidSetupCodeFormat.isComplete("ABCDEFG"), "extra characters are capped, not rejected")
        XCTAssertFalse(KidSetupCodeFormat.isComplete("ABCDE"))
        XCTAssertFalse(KidSetupCodeFormat.isComplete("ABC0EF"), "0 is dropped, leaving five")
        XCTAssertFalse(KidSetupCodeFormat.isComplete(""))
    }

    // MARK: FamilyNameSuggestion

    func testSuggestUsesTheLastWordAsTheSurname() {
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "Jane Smith"), "The Smith family")
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "Jane Q Public"), "The Public family")
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "Mary Smith-Jones"), "The Smith-Jones family")
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "Ana García"), "The García family")
    }

    func testSuggestIgnoresExtraWhitespace() {
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "  Jane   Smith  "), "The Smith family")
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "Jane\tSmith"), "The Smith family")
    }

    func testSuggestFallsBackWithoutASurname() {
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "Jane"), "Our family")
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: ""), "Our family")
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "   "), "Our family")
    }

    func testSuggestSkipsGenerationalSuffixes() {
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "Jane Smith Jr."), "The Smith family")
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "Jane Smith, Jr."), "The Smith family")
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "John Smith III"), "The Smith family")
        XCTAssertEqual(FamilyNameSuggestion.suggest(forParentName: "Jane Jr."), "Our family")
    }
}
