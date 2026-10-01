import XCTest

/// Native onboarding for the Screen Time plan (docs/SCREEN-TIME-ONLY-PLAN.md §2/§3): the welcome
/// choices, the two plan cards with the inline invite code, and the kid's typed setup code.
/// These tests stay on the screens that need no server: the app is pointed at a closed local
/// port, so the resume check fails fast and the welcome screen stays put.
final class ScreenTimePlanOnboardingUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    private func launchFresh() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = "http://127.0.0.1:9"
        app.launchEnvironment["FAM_THEME"] = "light"
        // Not onboarded, and no onboarding in progress, whatever an earlier run left behind.
        app.launchArguments += ["-fam_onboarded", "NO", "-fam_onboard_active", "NO"]
        app.launch()
        return app
    }

    /// Buttons carry identifiers, so look them up by their visible label explicitly.
    @MainActor
    private func button(labeled label: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    @MainActor
    func testWelcomeOffersTheThreePathsWithoutInviteOnlyCopy() {
        let app = launchFresh()
        // The set-up button keeps the identifier the older "I'm a parent" button had.
        XCTAssertTrue(app.buttons["I'm a parent"].waitForExistence(timeout: 10))
        XCTAssertTrue(button(labeled: "Set up Fam ETC", in: app).exists)
        XCTAssertTrue(button(labeled: "I already have an account", in: app).exists)
        XCTAssertTrue(button(labeled: "I'm a kid", in: app).exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'invite-only'")).firstMatch.exists)
    }

    @MainActor
    func testChooseRevealsTheInviteFieldOnlyForTheWholeFamEtc() {
        let app = launchFresh()
        XCTAssertTrue(app.buttons["I'm a parent"].waitForExistence(timeout: 10))
        app.buttons["I'm a parent"].tap()

        let screenTime = app.buttons["onb.choose.screentime"]
        let full = app.buttons["onb.choose.full"]
        XCTAssertTrue(screenTime.waitForExistence(timeout: 5))
        XCTAssertTrue(full.exists)
        XCTAssertFalse(app.textFields["onb.choose.invite"].exists, "the invite field is hidden until the full card is opened")

        full.tap()
        let invite = app.textFields["onb.choose.invite"]
        XCTAssertTrue(invite.waitForExistence(timeout: 3))
        let proceed = app.buttons["onb.choose.continue"]
        XCTAssertFalse(proceed.isEnabled, "Continue needs a code")
        invite.tap()
        invite.typeText("friends")
        XCTAssertTrue(proceed.isEnabled)

        // Back returns to the welcome screen.
        app.buttons["onb.back"].tap()
        XCTAssertTrue(app.buttons["I'm a parent"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testKidTypesAnUppercaseSixCharacterCode() {
        let app = launchFresh()
        let kid = app.buttons["onb.welcome.kid"]
        XCTAssertTrue(kid.waitForExistence(timeout: 10))
        kid.tap()

        let field = app.textFields["onb.kid.code"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        let proceed = app.buttons["onb.kid.code.continue"]
        XCTAssertFalse(proceed.isEnabled)

        field.tap()
        field.typeText("ab-c")
        XCTAssertFalse(proceed.isEnabled, "three characters are not a full code")
        field.typeText("de9")
        // VoiceOver value: dashes dropped, letters uppercased, one character at a time.
        XCTAssertEqual(field.value as? String, "A, B, C, D, E, 9")
        XCTAssertTrue(proceed.isEnabled)

        // The older family-code path stays reachable.
        app.buttons["onb.kid.legacy"].tap()
        XCTAssertTrue(app.textFields["Family code"].waitForExistence(timeout: 3))
    }
}
