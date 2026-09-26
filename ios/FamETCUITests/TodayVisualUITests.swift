import UIKit
import XCTest

/// Family Rings journeys use only the isolated mutable localhost fixture.
final class TodayVisualUITests: XCTestCase {
    private let fixtureURL = URL(string: "http://127.0.0.1:18257")!

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        try resetFixture()
    }

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
        news.tap()
        XCTAssertTrue(app.navigationBars["Interesting News"].waitForExistence(timeout: 8))
        app.navigationBars["Interesting News"].buttons["Close"].tap()
        for id in ["today.daily3.quote", "today.daily3.word", "today.daily3.challenge"] {
            // At accessibility sizes later tiles are lazily created while scrolling.
            reveal(app.descendants(matching: .any)[id].firstMatch, app)
        }
    }

    func testChildHabitTouchUpdatesRingAndStaysScoped() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = launch(.kid)
        let card = wait("today.kidcard.qa-visual-kid-1", app)
        reveal(card, app)
        XCTAssertTrue(card.label.contains("Habits 1 of 2 today"))
        // The card combines VoiceOver elements with named custom actions. This
        // verifies the separate sighted touch target at standard text size. The
        // iPhone and the two-column iPad card share one layout: habits sit right of the ring.
        let point = CGVector(dx: 0.7, dy: 0.65)
        card.coordinate(withNormalizedOffset: point).tap()
        XCTAssertTrue(app.navigationBars["Habits today"].waitForExistence(timeout: 5))
        let habit = app.switches["today.habit.qa-visual-goal-2"]
        XCTAssertTrue(habit.waitForExistence(timeout: 5))
        XCTAssertFalse(app.switches["today.habit.qa-visual-goal-3"].exists)
        let control = habit.switches.firstMatch
        XCTAssertTrue(control.exists)
        control.tap()
        let checked = expectation(for: NSPredicate(format: "value == %@", "1"), evaluatedWith: habit)
        wait(for: [checked], timeout: 8)
        app.navigationBars["Habits today"].buttons["Done"].tap()
        let updated = expectation(for: NSPredicate(format: "label CONTAINS %@", "Habits 2 of 2 today"), evaluatedWith: card)
        wait(for: [updated], timeout: 8)
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

    func testCompactPhonePortraitAndLandscape() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = launch(.parent, scenario: "family-rings-density")
        defer { XCUIDevice.shared.orientation = .portrait }
        waitForHero("6 things need you", app)
        let first = wait("today.kidcard.qa-visual-kid-1", app)
        let second = app.descendants(matching: .any)["today.kidcard.qa-visual-kid-2"].firstMatch
        XCTAssertLessThan(first.frame.height, 335, "A child summary should fit compactly without tall metric stacks")
        XCTAssertLessThan(first.frame.minY, 540, "Three actions should leave room for a child card on the first screen")
        attach(app, "compact-phone-portrait-busy")
        reveal(first, app)
        attach(app, "compact-phone-child-cards")
        XCUIDevice.shared.orientation = .landscapeLeft
        // Rotation shortens the viewport; reveal the lazy grid before querying it.
        app.swipeUp(velocity: .slow)
        let sameRow = expectation(for: NSPredicate { _, _ in
            first.exists && second.exists && abs(first.frame.minY - second.frame.minY) < 2
                && first.frame.maxX <= second.frame.minX
        }, evaluatedWith: app)
        wait(for: [sameRow], timeout: 10)
        for _ in 0..<3 {
            let offset = 12 - first.frame.minY
            if abs(offset) < 4 { break }
            let distance = max(-app.frame.height * 0.35, min(app.frame.height * 0.35, offset))
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: distance)))
        }
        Thread.sleep(forTimeInterval: 2)
        attach(app, "compact-phone-landscape-two-children")
        XCTAssertEqual(first.frame.minY, second.frame.minY, accuracy: 2)
        XCTAssertLessThanOrEqual(first.frame.maxX, second.frame.minX)
        XCTAssertLessThan(second.frame.maxX, app.frame.maxX)
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
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "SYNTHETIC QA — \(name)"; shot.lifetime = .keepAlways; add(shot)
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
