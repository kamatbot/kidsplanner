import UIKit
import XCTest

/// Focused end-to-end checks for the family-assistance UI against the local,
/// synthetic `ios-family-assistance-server.js` fixture. These tests exercise
/// the real RootView and APIClient; they do not cover production services,
/// on-device model hardware, OCR quality, Siri invocation, or WidgetKit.
final class FamilyAssistanceUITests: XCTestCase {
    private let fixtureURL = URL(string: "http://127.0.0.1:18247")!

    override func setUpWithError() throws {
        continueAfterFailure = false
        try resetFixture()
    }

    func testNoticeWithUnknownDateKeepsAddDisabled() throws {
        let app = launch(role: .parent)
        openSchoolNotice(in: app)
        chooseTextNotice(in: app, text: "Synthetic museum visit\nBring: hat and water")
        app.buttons["Extract for review"].tap()

        waitForExtraction(in: app)

        XCTAssertTrue(app.staticTexts["Date required. The notice did not include a date."].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["Add"].isEnabled, "An unresolved date must never default to today")
        attachScreenshot(of: app, name: "synthetic-notice-unknown-date")
    }

    func testReviewedNoticePostsSupportedCalendarShape() throws {
        let app = launch(role: .parent)
        openSchoolNotice(in: app)
        chooseTextNotice(in: app, text: "Synthetic Science Night\nDate: 23 September 2027\nTime: 6:30 PM\nBring: goggles")
        app.buttons["Extract for review"].tap()

        waitForExtraction(in: app)

        let title = app.textFields["Event title"]
        XCTAssertTrue(title.waitForExistence(timeout: 8))
        XCTAssertEqual(title.value as? String, "Synthetic Science Night")
        XCTAssertTrue(app.buttons["Add"].isEnabled)
        attachScreenshot(of: app, name: "synthetic-notice-reviewed")

        app.buttons["Add"].tap()
        XCTAssertTrue(app.alerts["Added to the family plan"].waitForExistence(timeout: 8))

        let posts = try fixtureState()["eventPosts"] as? [[String: Any]] ?? []
        XCTAssertEqual(posts.count, 1)
        let body = try XCTUnwrap(posts.first)
        XCTAssertEqual(body["title"] as? String, "Synthetic Science Night")
        XCTAssertEqual(body["date"] as? String, "2027-09-23")
        XCTAssertEqual(body["time"] as? String, "18:30")
        XCTAssertEqual(body["category"] as? String, "school")
        XCTAssertTrue((body["notes"] as? String)?.contains("Things to bring: goggles") == true)
        XCTAssertNil(body["sourceType"], "School notices use the existing manual-event contract")
        XCTAssertNil(body["sourceId"])
    }

    func testNoticeServerErrorAllowsExplicitRetryWithoutAutomaticDuplicate() throws {
        let app = launch(role: .parent, scenario: "event-error")
        enterValidNotice(in: app)
        app.buttons["Add"].tap()

        XCTAssertTrue(app.alerts["Could not continue"].waitForExistence(timeout: 8))
        XCTAssertEqual(try eventPostCount(), 1)
        app.alerts.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["Add"].isEnabled, "A confirmed server rejection may be retried explicitly")
        XCTAssertEqual(try eventPostCount(), 1, "Dismissing an error must not resubmit")
    }

    func testUncertainNoticeSubmissionRequiresCalendarCheckAndCannotResubmit() throws {
        let app = launch(role: .parent, scenario: "event-drop")
        enterValidNotice(in: app)
        app.buttons["Add"].tap()

        XCTAssertTrue(app.alerts["Check Calendar"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "do not add a duplicate")).firstMatch.exists)
        XCTAssertEqual(try eventPostCount(), 1)
        app.alerts.buttons["Close"].tap()
        XCTAssertFalse(app.buttons["Add"].exists, "An uncertain submission closes instead of offering a blind retry")
        XCTAssertEqual(try eventPostCount(), 1)
    }

    func testParentAttentionBriefKeepsHomeworkReadOnly() throws {
        let app = launch(role: .parent)
        let attention = app.descendants(matching: .any)["today.priority.review"].firstMatch
        XCTAssertTrue(attention.waitForExistence(timeout: 10))
        attachScreenshot(of: app, name: "synthetic-parent-attention-card")
        attention.tap()

        XCTAssertTrue(app.navigationBars["Your family brief"].waitForExistence(timeout: 5))
        // The Today summary remains mounted behind the sheet with the same
        // text. Select the brief's row button, not that hidden summary label.
        let assignment = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH %@", "Homework for Maya QA: Synthetic volcano poster,"
        )).firstMatch
        XCTAssertTrue(assignment.waitForExistence(timeout: 5))
        assignment.tap()
        XCTAssertTrue(app.staticTexts["The student updates their own progress. You can review the assignment together."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Mark as done"].exists)
        attachScreenshot(of: app, name: "synthetic-parent-homework-read-only")
    }

    func testChildHelpRequestNeedsConfirmationAndNeverAutoSends() throws {
        let app = launch(role: .kid, screen: "homework")
        let assignment = app.staticTexts["Synthetic volcano poster"]
        XCTAssertTrue(assignment.waitForExistence(timeout: 10))

        var help = app.staticTexts["Help me start"]
        if !help.exists {
            assignment.tap()
            help = app.staticTexts["Help me start"]
        }
        XCTAssertTrue(help.waitForExistence(timeout: 5))
        help.tap()
        XCTAssertTrue(app.navigationBars["Help Me Start"].waitForExistence(timeout: 5))
        XCTAssertEqual(try chatPostCount(), 0)

        app.buttons["Ask family for help"].tap()
        XCTAssertTrue(app.sheets["Send this to family chat?"].waitForExistence(timeout: 5)
            || app.staticTexts["Send this to family chat?"].waitForExistence(timeout: 1))
        XCTAssertEqual(try chatPostCount(), 0, "Opening the exact-message confirmation must not send")
        attachScreenshot(of: app, name: "synthetic-child-help-confirmation")

        app.buttons["Send help request"].tap()
        XCTAssertTrue(app.alerts["Request sent"].waitForExistence(timeout: 8))
        XCTAssertEqual(try chatPostCount(), 1)
    }

    func testReadingCompanionOffersHonestNonAIFallback() throws {
        let app = launch(role: .kid)
        let story = app.staticTexts["Synthetic scientists map a coral nursery"]
        XCTAssertTrue(story.waitForExistence(timeout: 10))
        // Tap the actual row control: static text can be present in the
        // accessibility tree without a hit target of its own on Duo.
        let choice = app.buttons["today.daily5.news.science"]
        XCTAssertTrue(choice.waitForExistence(timeout: 5))
        choice.tap()
        let read = app.buttons["today.daily5.news"]
        if !read.isHittable { app.swipeUp() }
        read.tap()
        let help = app.descendants(matching: .any)["news.readingHelp"].firstMatch
        XCTAssertTrue(help.waitForExistence(timeout: 5))
        help.tap()
        XCTAssertTrue(app.staticTexts["Reading companion"].waitForExistence(timeout: 5))
        let fallback = app.buttons["Use a simple guide without AI"]
        XCTAssertTrue(fallback.waitForExistence(timeout: 5))
        fallback.tap()
        XCTAssertTrue(app.staticTexts["Simple guide — no AI used"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["In plain language"].exists)
        XCTAssertTrue(app.staticTexts["Talk about it"].exists)
        attachScreenshot(of: app, name: "synthetic-reading-non-ai-fallback")
    }

    // MARK: - Launch and navigation

    private enum Role: String { case parent, kid }

    @discardableResult
    private func launch(role: Role, scenario: String = "success", screen: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = fixtureURL.absoluteString
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_THEME"] = "light"
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=\(role.rawValue); fam_qa_scenario=\(scenario)"
        if let screen { app.launchEnvironment["FAM_SCREEN"] = screen }
        app.launch()
        return app
    }

    private func openSchoolNotice(in app: XCUIApplication) {
        let button = app.buttons["today.notice.scan"]
        reveal(button, in: app)
        XCTAssertEqual(button.label, "Turn a school notice into a plan")
        XCTAssertTrue(button.isHittable)
        button.tap()
        XCTAssertTrue(app.navigationBars["Review School Notice"].waitForExistence(timeout: 5))
    }

    private func chooseTextNotice(in app: XCUIApplication, text: String) {
        let textSegment = app.segmentedControls.buttons["Text"]
        XCTAssertTrue(textSegment.waitForExistence(timeout: 5))
        textSegment.tap()
        let source = app.descendants(matching: .any)["Paste or type the notice"]
        XCTAssertTrue(source.waitForExistence(timeout: 5))
        source.tap()
        source.typeText(text)
    }

    private func enterValidNotice(in app: XCUIApplication) {
        openSchoolNotice(in: app)
        chooseTextNotice(in: app, text: "Synthetic Science Night\nDate: 23 September 2027\nTime: 6:30 PM\nBring: goggles")
        app.buttons["Extract for review"].tap()
        waitForExtraction(in: app)
        XCTAssertTrue(app.buttons["Add"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["Add"].isEnabled)
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<8 where !element.isHittable { app.swipeUp() }
    }

    private func waitForExtraction(in app: XCUIApplication) {
        // Add and the empty review fields exist before asynchronous extraction.
        // Synchronize on its completion disclosure, not their mere existence.
        let disclosure = app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "prepared this draft. Check every field"
        )).firstMatch
        XCTAssertTrue(disclosure.waitForExistence(timeout: 30), "Notice extraction did not finish")
    }

    // MARK: - Fixture assertions

    private func resetFixture() throws {
        var request = URLRequest(url: fixtureURL.appendingPathComponent("__qa/reset"))
        request.httpMethod = "POST"
        _ = try requestJSON(request)
    }

    private func fixtureState() throws -> [String: Any] {
        try requestJSON(URLRequest(url: fixtureURL.appendingPathComponent("__qa/state")))
    }

    private func requestJSON(_ request: URLRequest) throws -> [String: Any] {
        let done = expectation(description: "Local synthetic fixture responds")
        var result: Result<[String: Any], Error>?
        var boundedRequest = request
        boundedRequest.timeoutInterval = 10
        URLSession.shared.dataTask(with: boundedRequest) { data, response, error in
            defer { done.fulfill() }
            if let error { result = .failure(error); return }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data else {
                result = .failure(NSError(domain: "FamilyAssistanceUITests", code: 1,
                                          userInfo: [NSLocalizedDescriptionKey: "Synthetic fixture did not return HTTP 2xx."]))
                return
            }
            do {
                let value = try JSONSerialization.jsonObject(with: data)
                guard let object = value as? [String: Any] else {
                    throw NSError(domain: "FamilyAssistanceUITests", code: 2,
                                  userInfo: [NSLocalizedDescriptionKey: "Synthetic fixture returned a non-object JSON response."])
                }
                result = .success(object)
            } catch { result = .failure(error) }
        }.resume()
        wait(for: [done], timeout: 15)
        return try XCTUnwrap(result, "Start tests/fixtures/ios-family-assistance-server.js on port 18247 first.").get()
    }

    private func eventPostCount() throws -> Int {
        (try fixtureState()["eventPosts"] as? [[String: Any]])?.count ?? 0
    }

    private func chatPostCount() throws -> Int {
        (try fixtureState()["chatPosts"] as? [[String: Any]])?.count ?? 0
    }

    private func attachScreenshot(of app: XCUIApplication, name: String) {
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "iPad-iOS27" : "iPhone-iOS27"
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "SYNTHETIC QA — \(device) — \(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
