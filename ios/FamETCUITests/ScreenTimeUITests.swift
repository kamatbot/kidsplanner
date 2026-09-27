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

    /// No Family Sharing device in the fixture: Advanced shows the honest empty state
    /// instead of Apple's report, and Basic shows no usage line without reported minutes.
    func testParentDetailedUsageEmptyStateWithoutFamilySharing() {
        let app = launch(.parent)
        let row = app.descendants(matching: .any)["Leo Visual, Screen Time"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 12))
        reveal(row, app)
        row.tap()
        let bedtime = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Bedtime'")).firstMatch
        XCTAssertTrue(bedtime.waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Today: '")).firstMatch.exists)
        let advanced = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Advanced'")).firstMatch
        reveal(advanced, app)
        advanced.tap()
        let empty = app.staticTexts["App-by-app details need Family Sharing. You'll still see daily totals on fametc.com and here."]
        reveal(empty, app)
        attach("parent-detailed-usage-empty")
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

    func testParentApprovesMoreTimeRequest() throws {
        let kid = "qa-visual-kid-1"
        post("/__qa/screen-time/credit", ["kidId": kid, "amount": 12], role: .parent)
        post("/api/screen-time/kids/\(kid)/policy", ["enabled": true,
            "limits": [["id": "total", "kind": "total", "name": "Screen time", "minutesPerDay": 120, "weekendMinutes": 180]],
            "downtime": [["id": "bedtime", "name": "Bedtime", "start": "21:00", "end": "07:00", "days": [1, 2, 3, 4, 5, 6, 7]]]],
            role: .parent, method: "PUT")
        let day = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
        post("/api/screen-time/requests", ["minutes": 15, "date": day, "note": "Finishing a level"], role: .kid)

        let app = launch(.parent)
        let review = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Review'")).firstMatch
        XCTAssertTrue(review.waitForExistence(timeout: 12), "Pending request banner should show")
        attach("parent-request-banner")
        review.tap()
        let approve = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Approve 15 more minutes'")).firstMatch
        XCTAssertTrue(approve.waitForExistence(timeout: 8))
        attach("parent-request-card")
        approve.tap()
        XCTAssertTrue(approve.waitForNonExistence(timeout: 8), "Card should leave the pending state")
        attach("parent-request-approved")
    }

    @discardableResult
    private func post(_ path: String, _ body: [String: Any], role: Role, method: String = "POST") -> Int {
        var request = URLRequest(url: fixtureURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("fam_sess=\(role.rawValue); fam_qa_scenario=family-rings", forHTTPHeaderField: "Cookie")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let done = expectation(description: path); var status = 0
        URLSession.shared.dataTask(with: request) { _, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0; done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        return status
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
