import UIKit
import XCTest

/// Family Rings journeys use only the isolated mutable localhost fixture.
final class TodayVisualUITests: XCTestCase {
    private let fixtureURL = URL(string: "http://127.0.0.1:18257")!

    override func setUpWithError() throws { continueAfterFailure = false; try resetFixture() }

    func testParentNeedsYouCountsReviewAndDoneJourney() throws {
        let app = launch(.parent)
        waitForHero("2 things need you, 1 cleared today", app)
        attach(app, "family-rings-parent-first-screen")
        let review = wait("today.action.review.qa-visual-homework-action", app)
        reveal(review, app); review.tap()
        XCTAssertTrue(app.staticTexts["The student updates their own progress. You can review the assignment together."].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["Mark as done"].exists, "Parents review homework but never complete it")
        app.navigationBars["Homework"].buttons["Close"].tap()
        let done = wait("today.action.done.qa-visual-action", app)
        reveal(done, app); done.tap()
        waitForHero("1 thing needs you, 2 cleared today", app)
    }

    func testParentFamilyActionsCanCreate() throws {
        let app = launch(.parent)
        let all = wait("today.hero.seeAll", app); reveal(all, app); all.tap()
        XCTAssertTrue(app.navigationBars["Family actions"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Pack the rings activity bag"].exists)
        let field = wait("today.action.newTitle", app); field.tap(); field.typeText("QA created action")
        let add = wait("today.action.add", app); add.tap()
        XCTAssertTrue(app.staticTexts["QA created action"].waitForExistence(timeout: 8))
        let snooze = wait("today.action.snooze.qa-visual-action", app)
        reveal(snooze, app); snooze.tap()
        app.buttons["Tomorrow"].tap()
        let delete = wait("today.action.delete.qa-visual-action", app)
        reveal(delete, app); delete.tap()
        let removed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.staticTexts["Pack the rings activity bag"])
        wait(for: [removed], timeout: 8)
        app.navigationBars["Family actions"].buttons["Close"].tap()
        waitForHero("2 things need you, 1 cleared today", app)
    }

    func testKidScopeAndDailyThree() throws {
        let app = launch(.kid, theme: "dark", accessibilityText: true)
        attach(app, "family-rings-kid-dark-ax")
        XCTAssertFalse(app.descendants(matching: .any)["today.tonight"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["today.kidcard.qa-visual-kid-2"].exists)
        // Kid cards intentionally ignore child elements for VoiceOver and expose
        // habits through a named custom action. XCTest cannot invoke that action
        // reliably. The named action still requires manual VoiceOver verification.
        let card = wait("today.kidcard.qa-visual-kid-1", app)
        XCTAssertTrue(card.label.contains("Maya Visual"))
        reveal(card, app)
        attach(app, "family-rings-kid-card-dark-ax")
        let news = app.descendants(matching: .any)["today.daily3.news"].firstMatch
        reveal(news, app)
        for id in ["today.daily3.news", "today.daily3.quote", "today.daily3.word", "today.daily3.challenge"] {
            XCTAssertTrue(wait(id, app).exists, "Daily 3 must expose all four tiles")
        }
        news.tap()
        XCTAssertTrue(app.navigationBars["Interesting News"].waitForExistence(timeout: 8))
    }

    func testEmptyAndErrorStatesKeepTodayAvailable() throws {
        let empty = launch(.parent, scenario: "family-rings-empty")
        XCTAssertTrue(wait("today.hero.summary", empty).label.contains("0"))
        attach(empty, "family-rings-parent-empty")
        empty.terminate()
        let error = launch(.parent, scenario: "family-rings-error")
        XCTAssertTrue(wait("today.hero.summary", error).exists)
        // The fixture's error variant fails goals, wallet and learning data but
        // deliberately keeps /api/family/actions available, so it cannot reach
        // the hero retry state without adding a fixture failure mode.
    }

    private enum Role: String { case parent, kid }
    private func launch(_ role: Role, scenario: String = "family-rings", theme: String = "light", accessibilityText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = fixtureURL.absoluteString
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_THEME"] = theme
        app.launchEnvironment["FAM_SCREEN"] = "today"
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=\(role.rawValue); fam_qa_scenario=\(scenario)"
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", accessibilityText ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL"]
        app.launch(); return app
    }
    private func wait(_ id: String, _ app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any)[id].firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 12), "Missing Family Rings contract: \(id)")
        return element
    }
    private func reveal(_ element: XCUIElement, _ app: XCUIApplication) {
        for _ in 0..<14 {
            if element.exists && element.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable, "Control was not reachable after bounded scrolling: \(element.identifier)")
    }
    private func waitForHero(_ text: String, _ app: XCUIApplication) {
        let hero = wait("today.hero.summary", app)
        let changed = expectation(for: NSPredicate(format: "label CONTAINS %@", text), evaluatedWith: hero)
        wait(for: [changed], timeout: 8)
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "SYNTHETIC QA — \(name)"; shot.lifetime = .keepAlways; add(shot)
    }
    private func resetFixture() throws {
        var request = URLRequest(url: fixtureURL.appendingPathComponent("__qa/reset")); request.httpMethod = "POST"; request.timeoutInterval = 10
        let done = expectation(description: "reset Family Rings fixture"); var failure: Error?
        URLSession.shared.dataTask(with: request) { _, response, error in
            defer { done.fulfill() }; if let error { failure = error }
            else if (response as? HTTPURLResponse)?.statusCode != 200 { failure = NSError(domain: "TodayVisualUITests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Start the Family Rings fixture on port 18257."]) }
        }.resume()
        wait(for: [done], timeout: 15); if let failure { throw failure }
    }
}
