import XCTest
import UIKit

/// Synthetic localhost-only learning and recovery journeys. Never production.
final class LearningPolishUITests: XCTestCase {
    private var base: URL { URL(string: "http://127.0.0.1:\(UIDevice.current.userInterfaceIdiom == .pad ? 18248 : 18247)")! }

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        _ = try fixture("__qa/reset", method: "POST")
    }

    func testWordAndBrainAnswerRetryThenCompletion() throws {
        let app = launch(failure: true)
        open("Word", in: app)
        capture(app, "word-options")
        tap("word.option.2", in: app)
        tap("word.retrySave", in: app)
        XCTAssertTrue(app.staticTexts["You found the impostor."].waitForExistence(timeout: 8))
        capture(app, "word-feedback")
        app.buttons["Close"].firstMatch.tap()
        open("Brain", in: app)
        tap("brain.option.1", in: app)
        tap("brain.retrySave", in: app)
        tap("brain.next", in: app)
        XCTAssertTrue(app.staticTexts["Brain teaser complete"].waitForExistence(timeout: 8))
        capture(app, "brain-complete")
        let state = try fixture("__qa/state")
        XCTAssertEqual((state["answerPosts"] as? [[String: Any]])?.count, 2, "Retries must apply each answer once")
    }

    func testQuoteDraftSurvivesCloseAndFailedSave() throws {
        let app = launch(failure: true)
        open("Quote", in: app)
        let field = element("quote.reflection", in: app)
        field.tap(); field.typeText("One small step is still progress.")
        app.buttons["Close"].firstMatch.tap()
        open("Quote", in: app)
        XCTAssertEqual(element("quote.reflection", in: app).value as? String, "One small step is still progress.")
        tap("quote.save", in: app)
        XCTAssertTrue(app.staticTexts["Couldn't save reflection"].waitForExistence(timeout: 8))
        XCTAssertEqual(element("quote.reflection", in: app).value as? String, "One small step is still progress.")
        tap("quote.save", in: app)
        XCTAssertTrue(app.staticTexts["Reflection saved"].waitForExistence(timeout: 8))
        capture(app, "quote-saved")
    }

    func testNewsReflectionDarkLargeTextWithRetry() throws {
        let app = launch(failure: true, dark: true, large: true)
        tap("today.daily5.news.science", in: app)
        tap("today.daily5.news", in: app)
        XCTAssertTrue(app.staticTexts["Visual scientists map a coral nursery"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["Start on-device guide"].exists, "Reading help is optional, not a wall before the reflection")
        capture(app, "news-dark-large")
        let field = element("news.reflection", in: app)
        reveal(field, app); field.tap(); field.typeText("Protect the nursery while young coral grows.")
        tap("news.save", in: app)
        XCTAssertTrue(app.staticTexts["Your idea wasn't saved"].waitForExistence(timeout: 8))
        XCTAssertEqual(field.value as? String, "Protect the nursery while young coral grows.")
        tap("news.save", in: app)
        XCTAssertTrue(app.staticTexts["Idea saved"].waitForExistence(timeout: 8))
    }

    func testCrosswordTypingResumeAndClearConfirmation() throws {
        let app = launch()
        if UIDevice.current.userInterfaceIdiom == .pad { XCUIDevice.shared.orientation = .landscapeLeft }
        open("Puzzle", in: app)
        capture(app, "crossword-start")
        // Clear this synthetic puzzle's previous run only, through the actual UI.
        tap("puzzle.clear", in: app)
        app.alerts.buttons["Clear"].tap()
        let first = element("puzzle.cell.0.0", in: app)
        reveal(first, app); first.tap(); first.typeText("PRAGMATIC")
        app.buttons["Close"].firstMatch.tap()
        open("Puzzle", in: app)
        XCTAssertEqual(element("puzzle.cell.0.0", in: app).value as? String, "P")
        tap("puzzle.clue.next", in: app)
        let second = element("puzzle.cell.1.1", in: app)
        second.typeText("IGOR")
        tap("puzzle.check", in: app)
        XCTAssertTrue(app.staticTexts["Puzzle solved"].waitForExistence(timeout: 8))
        capture(app, "crossword-solved")
        tap("puzzle.clear", in: app)
        app.alerts.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["Puzzle solved"].exists)
        let state = try fixture("__qa/state")
        let posts = (state["daily5Posts"] as? [[String: Any]] ?? []).filter { $0["part"] as? String == "puzzle" }
        XCTAssertLessThanOrEqual(posts.filter { $0["status"] as? String == "started" }.count, 3,
                                 "Typing must not send one network request per letter")
    }

    func testFailedChatSendKeepsDraftUntilConfirmed() throws {
        let app = launch(failure: true, screen: "chat")
        let field = element("chat.composer", in: app)
        field.tap(); field.typeText("Please keep this draft.")
        tap("chat.send", in: app)
        XCTAssertTrue(element("chat.send.failure", in: app).exists)
        XCTAssertEqual(field.value as? String, "Please keep this draft.")
        tap("chat.send", in: app)
        let sent = app.staticTexts["Please keep this draft."]
        XCTAssertTrue(sent.waitForExistence(timeout: 8))
        XCTAssertNotEqual(field.value as? String, "Please keep this draft.")
        capture(app, "chat-recovered")
        XCTAssertEqual((try fixture("__qa/state")["chatPosts"] as? [[String: Any]])?.count, 1)
    }

    private func launch(failure: Bool = false, dark: Bool = false, large: Bool = false, screen: String = "today") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = ["FAM_BASE_URL": base.absoluteString, "FAM_ONBOARDED": "1",
            "FAM_THEME": dark ? "dark" : "light", "FAM_SCREEN": screen,
            "FAM_DEV_COOKIE": "fam_sess=kid; fam_qa_scenario=learning-polish\(failure ? "-failure" : "")"]
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", large ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL"]
        app.launch()
        return app
    }

    private func open(_ activity: String, in app: XCUIApplication) {
        let button = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(activity),")).firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 12))
        reveal(button, app); button.tap()
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        let item = app.descendants(matching: .any).matching(identifier: id).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 12), "Missing \(id)")
        return item
    }

    private func tap(_ id: String, in app: XCUIApplication) {
        let item = element(id, in: app)
        reveal(item, app); item.tap()
    }

    private func reveal(_ item: XCUIElement, _ app: XCUIApplication) {
        for _ in 0..<8 where !item.isHittable { app.swipeUp() }
        XCTAssertTrue(item.isHittable, "Not hittable: \(item.identifier)")
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "SYNTHETIC native polish — \(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func fixture(_ path: String, method: String = "GET") throws -> [String: Any] {
        var request = URLRequest(url: base.appendingPathComponent(path)); request.httpMethod = method
        request.timeoutInterval = 10
        let done = expectation(description: path)
        var value: [String: Any] = [:]
        var failure: Error?
        URLSession.shared.dataTask(with: request) { data, _, error in
            failure = error
            if let data { value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:] }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 12)
        if let failure { throw failure }
        return value
    }
}
