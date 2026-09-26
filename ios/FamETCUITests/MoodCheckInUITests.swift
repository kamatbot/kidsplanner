import XCTest
import UIKit

final class MoodCheckInUITests: XCTestCase {
    private let base = URL(string: "http://127.0.0.1:18257")!
    func testChildPreviewCancelAndExplicitRetry() throws {
        continueAfterFailure = false
        var reset = URLRequest(url: base.appendingPathComponent("__qa/reset")); reset.httpMethod = "POST"
        _ = try request(reset)
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = base.absoluteString
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_THEME"] = "dark"
        app.launchEnvironment["FAM_SCREEN"] = "today"
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=kid; fam_qa_scenario=learning-polish-failure"
        app.launchEnvironment["FAM_RESET_ENERGY"] = "1"
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        if UIDevice.current.userInterfaceIdiom == .pad { XCUIDevice.shared.orientation = .landscapeLeft }
        app.launch()
        openEnergy(in: app)
        XCTAssertTrue(app.buttons["Low"].waitForExistence(timeout: 5))
        app.buttons["Low"].tap()
        tap("Ask for help…", in: app)
        var state = try request(URLRequest(url: base.appendingPathComponent("__qa/state")))
        XCTAssertEqual((state["chatPosts"] as? [Any])?.count, 0)
        XCTAssertEqual((state["notePosts"] as? [Any])?.count, 0)
        app.buttons["Cancel"].tap()
        app.navigationBars["Koko"].buttons["Close"].tap()
        openEnergy(in: app)
        XCTAssertFalse(app.textFields["Message preview — edit before sending"].exists)
        tap("Okay", in: app); tap("Preview sharing", in: app)
        let send = app.buttons["Send to family"]
        for _ in 0..<5 where !send.isHittable { app.descendants(matching: .any)["study.energy.form"].firstMatch.swipeUp() }
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Mood preview large text dark"; shot.lifetime = .keepAlways; add(shot)
        send.tap()
        let retry = app.buttons["Retry send to family"]
        XCTAssertTrue(retry.waitForExistence(timeout: 8))
        retry.tap()
        let success = app.staticTexts["Sent to family chat."]
        for _ in 0..<8 where !success.isHittable { app.descendants(matching: .any)["study.energy.form"].firstMatch.swipeUp() }
        XCTAssertTrue(success.waitForExistence(timeout: 8))
        state = try request(URLRequest(url: base.appendingPathComponent("__qa/state")))
        let posts = try XCTUnwrap(state["chatPosts"] as? [[String: Any]])
        XCTAssertEqual(posts.count, 1)
        XCTAssertEqual(posts.first?["text"] as? String, "My energy is okay today.")
        XCTAssertEqual((state["notePosts"] as? [Any])?.count, 0)
        app.buttons["Cancel"].tap()
        // Answered today: the check-in steps aside in the Koko panel.
        XCTAssertTrue(app.navigationBars["Koko"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Energy check-in.")).firstMatch.waitForNonExistence(timeout: 5))
    }
    func testPortraitChildThenParentEnergyPreviewRemainsExplicit() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = base.absoluteString
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_SCREEN"] = "today"
        app.launchEnvironment["FAM_THEME"] = "light"
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=kid; fam_qa_scenario=today-visual"
        app.launchEnvironment["FAM_RESET_ENERGY"] = "1"
        app.launch()
        openEnergy(in: app)
        tap("Full", in: app); tap("Preview sharing", in: app)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Mood portrait light child"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["Cancel"].tap()
        app.terminate()
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=parent; fam_qa_scenario=today-visual"
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["today.hero.summary"].firstMatch.waitForExistence(timeout: 15))
        openEnergy(in: app)
        tap("Full", in: app); tap("Preview sharing", in: app)
        XCTAssertTrue(app.buttons["Send to family"].exists)
        app.buttons["Cancel"].tap()
        let parentShot = XCTAttachment(screenshot: app.screenshot()); parentShot.name = "Parent Koko energy preview"; parentShot.lifetime = .keepAlways; add(parentShot)
        app.terminate()
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=kid; fam_qa_scenario=today-visual"
        app.launch()
        openEnergy(in: app)
        XCTAssertFalse(app.textFields["Message preview — edit before sending"].exists)
        XCTAssertFalse(app.buttons["Send to family"].exists)
        app.buttons["Cancel"].tap()
    }
    private func tap(_ label: String, in app: XCUIApplication) {
        let button = app.buttons[label]
        for _ in 0..<8 where !button.isHittable { app.descendants(matching: .any)["study.energy.form"].firstMatch.swipeUp() }
        XCTAssertTrue(button.isHittable, "Control remains reachable at accessibility text size: " + label)
        button.tap()
    }
    private func openEnergy(in app: XCUIApplication) {
        let toggle = app.buttons["today.studyPal.toggle"]
        for _ in 0..<12 where !toggle.isHittable { app.swipeUp() }
        if toggle.label == "Show Koko" { toggle.tap() }
        let koko = app.buttons["today.studyPal.open"]
        for _ in 0..<8 where !koko.isHittable { app.swipeUp() }
        XCTAssertTrue(koko.isHittable)
        koko.tap()
        let energy = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Energy check-in.")).firstMatch
        XCTAssertTrue(energy.waitForExistence(timeout: 5))
        energy.tap()
    }
    private func request(_ request: URLRequest) throws -> [String: Any] {
        let done = expectation(description: "Local fixture")
        var output: Result<[String: Any], Error>?
        URLSession.shared.dataTask(with: request) { data, _, error in
            defer { done.fulfill() }
            if let error { output = .failure(error); return }
            output = Result { try JSONSerialization.jsonObject(with: data ?? Data()) as? [String: Any] ?? [:] }
        }.resume()
        wait(for: [done], timeout: 5)
        return try XCTUnwrap(output).get()
    }
}
