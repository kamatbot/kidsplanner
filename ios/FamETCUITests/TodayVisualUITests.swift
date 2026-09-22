import UIKit
import XCTest

/// Focused visual-regression journeys for the native Today redesign. The
/// `today-visual` cookie selects only the synthetic fixture dataset; no test
/// here reaches production services or writes production data.
final class TodayVisualUITests: XCTestCase {
    private let fixtureURL = URL(string: "http://127.0.0.1:18247")!

    override func setUpWithError() throws {
        continueAfterFailure = false
        try resetFixture()
    }

    func testParentFirstScreenOpensReadOnlyFamilyBrief() throws {
        let app = launch(role: .parent)
        let priority = waitForID("today.priority.review", in: app)
        XCTAssertTrue(app.staticTexts["2 children"].waitForExistence(timeout: 5),
                      "The visual fixture should expose both child profiles to a parent")
        let event = app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@", "Visual family dinner"
        )).firstMatch
        XCTAssertTrue(event.waitForExistence(timeout: 5),
                      "The visual fixture should expose an actual event dated today")
        let progress = app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@", "Daily 5 1/5"
        )).firstMatch
        XCTAssertTrue(progress.waitForExistence(timeout: 12), "Parent progress must come from the actual child insights response")

        // Capture the actual first screen before opening the priority route.
        attachScreenshot(of: app, name: "today-visual-parent-first-screen")
        reveal(priority, in: app)
        priority.tap()

        XCTAssertTrue(app.navigationBars["Your family brief"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["A brief from your saved homework, family actions and calendar. Open an item to check the details."].waitForExistence(timeout: 5))

        let assignment = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH %@", "Homework for Maya Visual: Visual coral field notes"
        )).firstMatch
        XCTAssertTrue(assignment.waitForExistence(timeout: 5), "The Today brief did not show the synthetic priority homework")
        reveal(assignment, in: app)
        assignment.tap()

        XCTAssertTrue(app.staticTexts["The student updates their own progress. You can review the assignment together."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Mark as done"].exists, "A parent brief must remain read-only for student-owned homework")
        attachScreenshot(of: app, name: "today-visual-parent-read-only-brief")
    }

    func testParentNoticeScanKeepsLabelAndOpensReview() throws {
        let app = launch(role: .parent)
        let scan = waitForID("today.notice.scan", in: app)

        reveal(scan, in: app)
        XCTAssertEqual(scan.label, "Turn a school notice into a plan")
        scan.tap()
        XCTAssertTrue(app.navigationBars["Review School Notice"].waitForExistence(timeout: 8))
    }

    func testSecondaryDisclosureChangesStateAndRevealsTodayContext() throws {
        let app = launch(role: .parent, theme: "dark")
        let toggle = waitForID("today.secondary.toggle", in: app)
        reveal(toggle, in: app)

        let action = app.staticTexts["Pack the visual activity bag"]
        XCTAssertFalse(action.exists,
                       "The synthetic family action must remain behind the collapsed secondary tools section")

        let before = try XCTUnwrap(toggle.value as? String, "The secondary disclosure needs an accessibility value")
        toggle.tap()
        let after = try XCTUnwrap(toggle.value as? String, "The secondary disclosure lost its accessibility value after tapping")
        XCTAssertNotEqual(before, after, "The secondary disclosure did not report a state transition")
        XCTAssertTrue(app.staticTexts["Family actions"].waitForExistence(timeout: 5),
                      "Expanding the secondary Today section did not reveal the family-tools content")
        XCTAssertTrue(action.waitForExistence(timeout: 5),
                      "Expanding the secondary Today section did not reveal the synthetic family action")
        attachScreenshot(of: app, name: "today-visual-parent-secondary-dark")
    }

    func testKidCompactDailyFiveNewsFlowWithDarkLargeText() throws {
        let app = launch(role: .kid, theme: "dark", largeText: true)
        attachScreenshot(of: app, name: "today-visual-kid-first-screen-dark-large")

        let choice = waitForID("today.daily5.news.science", in: app)
        reveal(choice, in: app, maxSwipes: 10)
        choice.tap()
        let news = waitForID("today.daily5.news", in: app)
        reveal(news, in: app, maxSwipes: 10)
        news.tap()

        XCTAssertTrue(app.navigationBars["Interesting News"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Visual scientists map a coral nursery"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Researchers observed how young coral settles and grows in a protected nursery."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["What could help the coral nursery thrive?"].waitForExistence(timeout: 5))

        let reflection = app.descendants(matching: .any)["Write what you think…"].firstMatch
        XCTAssertTrue(reflection.waitForExistence(timeout: 5), "The complete news activity did not expose its reflection field")
        reveal(reflection, in: app, maxSwipes: 10)
        reflection.tap()
        reflection.typeText("A protected nursery gives young coral time to grow.")

        let save = app.buttons["Save response"]
        reveal(save, in: app, maxSwipes: 10)
        XCTAssertTrue(save.isEnabled, "The news response action should enable after a meaningful reflection")
        save.tap()
        XCTAssertTrue(app.staticTexts["Idea saved"].waitForExistence(timeout: 8))
        attachScreenshot(of: app, name: "today-visual-kid-daily5-news-dark-large")
    }

    // MARK: - Launch and fixture helpers

    private enum Role: String { case parent, kid }

    @discardableResult
    private func launch(role: Role, theme: String = "light", largeText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = fixtureURL.absoluteString
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_THEME"] = theme
        app.launchEnvironment["FAM_SCREEN"] = "today"
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=\(role.rawValue); fam_qa_scenario=today-visual"
        if largeText {
            // UIKit's documented UI-test launch override for an accessibility
            // content-size category; the visual check remains on the compact
            // Today route while exercising text wrapping and bounded scrolling.
            app.launchArguments += [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityXXXL",
            ]
        } else {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        }
        app.launch()
        return app
    }

    private func waitForID(_ id: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any)[id].firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 12), "Missing Today UI contract identifier: \(id)")
        return element
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication, maxSwipes: Int = 8) {
        for _ in 0..<maxSwipes where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable, "Today control is not hittable after bounded scrolling: \(element.identifier)")
    }

    private func attachScreenshot(of app: XCUIApplication, name: String) {
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "iPad-iOS27" : "iPhone-iOS27"
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "SYNTHETIC QA — \(device) — \(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func resetFixture() throws {
        var request = URLRequest(url: fixtureURL.appendingPathComponent("__qa/reset"))
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        let done = expectation(description: "Today visual fixture responds")
        var error: Error?
        URLSession.shared.dataTask(with: request) { _, response, requestError in
            defer { done.fulfill() }
            if let requestError { error = requestError; return }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                error = NSError(domain: "TodayVisualUITests", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Start tests/fixtures/ios-family-assistance-server.js on port 18247 first.",
                ])
                return
            }
        }.resume()
        wait(for: [done], timeout: 15)
        if let error { throw error }
    }
}
