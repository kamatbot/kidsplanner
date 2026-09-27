import XCTest

/// Screen Time Basic flow against the synthetic fixture
/// (tests/fixtures/ios-family-assistance-server.js, which runs the real
/// lib/screen-time.js). Start the fixture before running.
final class ScreenTimeUITests: XCTestCase {
    private let fixtureURL = URL(string: "http://127.0.0.1:18247")!

    override func setUp() { continueAfterFailure = false }

    func testParentTurnsOnBedtimeAndDailyTimeInTwoTaps() {
        let app = launch(.parent)
        let row = app.descendants(matching: .any)["Leo Visual, Screen Time"].firstMatch
        XCTAssertTrue(app.staticTexts["Maya Visual"].firstMatch.waitForExistence(timeout: 12))
        reveal(row, app)
        attach("parent-today-card")
        row.tap()

        let bedtime = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Bedtime'")).firstMatch
        XCTAssertTrue(bedtime.waitForExistence(timeout: 8))
        attach("parent-basic-first-run")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'authorization' OR label CONTAINS[c] 'cooperative' OR label CONTAINS[c] 'token'")).firstMatch.exists)
        bedtime.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        let daily = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Daily screen time'")).firstMatch
        daily.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        attach("parent-basic-on")

        let save = app.buttons["Save"].firstMatch
        reveal(save, app)
        save.tap()
        // Saved = the draft matches the server again, so Save disables.
        let saved = expectation(for: NSPredicate(format: "isEnabled == false"), evaluatedWith: save)
        wait(for: [saved], timeout: 8)
        attach("parent-basic-saved")
    }

    func testKidSeesDealCardAndWalksTheDealUpToTurnOn() {
        parentTurnsOnBedtime(for: "Maya Visual")
        let app = launch(.kid)
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 12))
        let card = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Make our Screen Time deal'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 12))
        reveal(card, app)
        attach("kid-deal-card")
        app.buttons["Let's make it"].firstMatch.tap()

        // Fixture-free pages only: device routes 401 in the fixture, so stop at "Turn it on".
        XCTAssertTrue(app.staticTexts["Let's make a deal"].waitForExistence(timeout: 6))
        attach("kid-deal-hello")
        app.buttons["Let's go"].tap()
        XCTAssertTrue(app.staticTexts["The plan"].waitForExistence(timeout: 4))
        attach("kid-deal-plan")
        app.buttons["Sounds fair"].tap()
        XCTAssertTrue(app.staticTexts["Your promises"].waitForExistence(timeout: 4))
        let next = app.buttons["Next"].firstMatch
        XCTAssertFalse(next.isEnabled)
        app.buttons["Homework before games"].tap()
        XCTAssertTrue(next.isEnabled)
        attach("kid-deal-kid-promises")
        next.tap()
        XCTAssertTrue(app.staticTexts["Pass the phone to your grown-up"].waitForExistence(timeout: 4))
        app.buttons["I'm the grown-up"].tap()
        XCTAssertTrue(app.staticTexts["Grown-up promises"].waitForExistence(timeout: 4))
        app.buttons["We'll review this together in a month"].tap()
        attach("kid-deal-parent-promises")
        app.buttons["Next"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Turn it on"].waitForExistence(timeout: 4))
        attach("kid-deal-turn-on")
    }

    /// Makes sure the fixture kid has an enabled policy (idempotent across runs).
    private func parentTurnsOnBedtime(for kidName: String) {
        let app = launch(.parent)
        let row = app.descendants(matching: .any)["\(kidName), Screen Time"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 12))
        reveal(row, app)
        row.tap()
        let bedtime = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Bedtime'")).firstMatch
        XCTAssertTrue(bedtime.waitForExistence(timeout: 8))
        if bedtime.value as? String == "0" {
            bedtime.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
            let save = app.buttons["Save"].firstMatch
            reveal(save, app)
            save.tap()
            let saved = expectation(for: NSPredicate(format: "isEnabled == false"), evaluatedWith: save)
            wait(for: [saved], timeout: 8)
        }
        app.terminate()
    }

    private enum Role: String { case parent, kid }
    private func launch(_ role: Role) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = fixtureURL.absoluteString
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_THEME"] = "light"
        app.launchEnvironment["FAM_SCREEN"] = "today"
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=\(role.rawValue); fam_qa_scenario=family-rings"
        app.launch()
        return app
    }
    private func reveal(_ element: XCUIElement, _ app: XCUIApplication) {
        for _ in 0..<14 where !(element.exists && element.isHittable) { app.swipeUp() }
        XCTAssertTrue(element.isHittable)
    }
    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "SYNTHETIC QA — \(name)"; shot.lifetime = .keepAlways; add(shot)
    }
}
