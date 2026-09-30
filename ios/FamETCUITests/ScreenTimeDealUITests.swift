import UIKit
import XCTest

/// Kid Screen Time deal presentation (docs/SCREEN-TIME-UX.md §3, WP4) against the
/// synthetic fixture (tests/fixtures/ios-family-assistance-server.js, which runs the
/// real lib/screen-time.js). Start the fixture before running.
///
/// The fixture can't enroll a device (FamilyControls isn't grantable in the
/// simulator), so the walk stops at "Set up this device". Signatures and actual
/// registration verification require authorized device testing. These updated
/// scenarios were source/build checked only; simulator execution was declined.
final class ScreenTimeDealUITests: XCTestCase {
    private let fixtureURL = URL(string: "http://127.0.0.1:18247")!
    private let kidId = "qa-visual-kid-1"   // "Maya Visual", the kid session in family-rings

    override func setUp() { continueAfterFailure = false }

    /// iPhone and iPad: the deal is a full-screen cover (full window width, a swipe
    /// down doesn't close it), both promise groups are required, and Not now
    /// remains available through review and permissions.
    func testKidDealOpensFullScreenWithNotNowOnEveryPage() {
        seedPolicy()
        let app = launchKid()
        let card = openDealCard(app)
        app.buttons["Let's make it"].firstMatch.tap()

        let review = app.staticTexts["Review your agreement"]
        XCTAssertTrue(review.waitForExistence(timeout: 6))
        let bar = app.navigationBars["Our Screen Time deal"].firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 4))
        let window = app.windows.firstMatch.frame
        XCTAssertEqual(bar.frame.width, window.width, accuracy: 1, "Deal should span the whole window, not a form sheet")
        attach("kid-deal-cover-review")
        // A sheet would close on a swipe down; a cover stays until "Not now".
        bar.swipeDown(velocity: .fast)
        XCTAssertFalse(review.waitForNonExistence(timeout: 2), "Swipe down must not close the deal")
        assertNotNow(app, "review")
        let proceed = app.buttons["Continue with this agreement"].firstMatch
        XCTAssertFalse(proceed.isEnabled, "Both promise groups are required")
        let childPromise = app.buttons["Homework before games"].firstMatch
        reveal(childPromise, app); childPromise.tap()
        XCTAssertFalse(proceed.isEnabled, "A child promise alone must not bypass the parent agreement")
        let parentPromise = app.buttons["We'll review this together in a month"].firstMatch
        reveal(parentPromise, app); parentPromise.tap()
        XCTAssertTrue(proceed.isEnabled)
        proceed.tap()

        XCTAssertTrue(app.staticTexts["Set up this device"].waitForExistence(timeout: 4))
        assertNotNow(app, "permissions")
        XCTAssertTrue(app.buttons["Turn on with Family Sharing"].exists)
        XCTAssertTrue(app.buttons["Turn on without Family Sharing"].exists)
        XCTAssertFalse(app.buttons["Continue to signatures"].isEnabled, "Permission and selection must precede signatures")
        attach("kid-deal-cover-turn-on")

        // "Not now" closes it straight back to Today.
        app.buttons["Not now"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Set up this device"].waitForNonExistence(timeout: 4))
        XCTAssertTrue(card.waitForExistence(timeout: 4))
    }

    /// iPad (regular width): the plan shows Bedtime and Daily time side by side and
    /// the promises are a grid with at least two chips a row.
    func testKidDealUsesRegularWidthLayoutOnIPad() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "Regular-width layout is checked on iPad")
        XCUIDevice.shared.orientation = .portrait
        seedPolicy()
        let app = launchKid()
        openDealCard(app)
        app.buttons["Let's make it"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Review your agreement"].waitForExistence(timeout: 6))
        let bar = app.navigationBars["Our Screen Time deal"].firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 4))
        XCTAssertEqual(bar.frame.width, app.windows.firstMatch.frame.width, accuracy: 1)
        attach("kid-deal-ipad-review")
        let bedtime = app.descendants(matching: .any)["deal-plan-bedtime"].firstMatch
        let daily = app.descendants(matching: .any)["deal-plan-daily"].firstMatch
        XCTAssertTrue(bedtime.waitForExistence(timeout: 4))
        XCTAssertTrue(daily.exists)
        XCTAssertEqual(bedtime.frame.minY, daily.frame.minY, accuracy: 1, "Bedtime and Daily time should share a row")
        XCTAssertLessThanOrEqual(bedtime.frame.maxX, daily.frame.minX, "Bedtime should sit left of Daily time")
        attach("kid-deal-ipad-plan")

        let first = app.buttons["Phone charges outside my room at night"].firstMatch
        let second = app.buttons["I'll stop when the timer says so"].firstMatch
        reveal(first, app)
        XCTAssertTrue(first.exists)
        XCTAssertTrue(second.exists)
        XCTAssertEqual(first.frame.midY, second.frame.midY, accuracy: 2, "At least two promise chips a row")
        XCTAssertLessThan(first.frame.maxX, second.frame.minX)
        attach("kid-deal-ipad-promises")

        app.buttons["Not now"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Your promises"].waitForNonExistence(timeout: 4))
    }

    // MARK: Helpers

    /// Bedtime + a daily limit on the fixture kid, so the plan has both cards (idempotent).
    private func seedPolicy() {
        let status = send("/api/screen-time/kids/\(kidId)/policy", ["enabled": true,
            "limits": [["id": "total", "kind": "total", "name": "Screen time", "minutesPerDay": 120, "weekendMinutes": 180]],
            "downtime": [["id": "bedtime", "name": "Bedtime", "start": "21:00", "end": "07:00", "days": [1, 2, 3, 4, 5, 6, 7]]]],
            role: .parent, method: "PUT")
        XCTAssertEqual(status, 200, "Fixture should accept the policy")
    }

    @discardableResult
    private func openDealCard(_ app: XCUIApplication) -> XCUIElement {
        let card = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Make our Screen Time deal'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 12))
        reveal(card, app)
        reveal(app.buttons["Let's make it"].firstMatch, app)
        return card
    }

    private func assertNotNow(_ app: XCUIApplication, _ page: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.buttons["Not now"].firstMatch.exists, "\"Not now\" missing on the \(page) page", file: file, line: line)
    }

    @discardableResult
    private func send(_ path: String, _ body: [String: Any], role: Role, method: String = "POST") -> Int {
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
    private func launchKid() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = fixtureURL.absoluteString
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_THEME"] = "light"
        app.launchEnvironment["FAM_SCREEN"] = "today"
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=\(Role.kid.rawValue); fam_qa_scenario=family-rings"
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
