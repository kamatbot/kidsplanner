import XCTest

/// Opt in by setting FAM_COMPANION_UI_FIXTURE_URL in the test runner environment
/// to an isolated loopback fixture using real companion routes and synthetic accounts.
/// Ordinary XCTest discovery skips these acceptance flows when no fixture is configured.
final class KidCompanionUITests: XCTestCase {
    private var base: String { ProcessInfo.processInfo.environment["FAM_COMPANION_UI_FIXTURE_URL"] ?? "" }

    override func setUpWithError() throws {
        try super.setUpWithError()
        try XCTSkipIf(base.isEmpty, "Requires an explicit FAM_COMPANION_UI_FIXTURE_URL loopback fixture.")
        let url = try XCTUnwrap(URL(string: base))
        try XCTSkipUnless(url.scheme == "http" && ["127.0.0.1", "localhost", "::1"].contains(url.host ?? ""),
                          "Synthetic acceptance tests must use a local fixture.")
    }
    @discardableResult private func fixture(_ patch: [String: Any]? = nil) throws -> [String: Any] {
        var request = URLRequest(url: URL(string: base + "/__qa/fixture")!)
        if let patch {
            request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: patch)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let done = expectation(description: "Local companion fixture")
        var result: Result<[String: Any], Error>?
        URLSession.shared.dataTask(with: request) { data, _, error in
            defer { done.fulfill() }
            result = Result {
                if let error { throw error }
                return try JSONSerialization.jsonObject(with: data!) as! [String: Any]
            }
        }.resume()
        wait(for: [done], timeout: 8)
        return try XCTUnwrap(result).get()
    }
    private func launch(parent: Bool = false, largeText: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = ["FAM_BASE_URL": base, "FAM_ONBOARDED": "1", "FAM_THEME": "light", "FAM_SCREEN": "chat",
                                 "FAM_DEV_COOKIE": "qa_role=\(parent ? "parent" : "kid")"]
        if largeText { app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        let hermes = app.buttons["chat.room.hermes"]
        XCTAssertTrue(hermes.waitForExistence(timeout: 20)); hermes.tap()
        let entry = app.buttons["companion.open"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10)); entry.tap()
        return app
    }
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        let list = app.collectionViews.allElementsBoundByIndex.last!
        for _ in 0..<16 {
            if element.exists && element.isHittable && element.frame.minY > list.frame.minY + 30 && element.frame.maxY < list.frame.maxY - 8 { return }
            let down = element.exists && element.frame.minY < list.frame.minY + 30
            list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.3 : 0.75))
                .press(forDuration: 0.05, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.65 : 0.35)))
        }
        XCTFail("Could not reveal \(element.identifier)")
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testChildCustomizationRecoversFromLoadAndSaveFailure() throws {
        XCUIDevice.shared.orientation = .portrait
        try fixture(["reset": true]); try fixture(["failLoad": true])
        let app = launch()
        let retry = app.buttons["companion.retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 10)); capture(app, "companion-load-error")
        try fixture(["failLoad": false]); retry.tap()
        let name = app.textFields["companion.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["companion.paused"].exists)
        XCTAssertFalse(app.switches["companion.enable"].exists)
        reveal(name, in: app); name.tap(); name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3) + "Nova")
        app.keyboards.buttons["Done"].tap()
        let owl = app.buttons["companion.avatar.owl"]; reveal(owl, in: app); owl.tap()
        let color = app.buttons["companion.color"]; reveal(color, in: app); color.tap(); app.buttons["Mint"].tap()
        let personality = app.buttons["companion.personality"]; reveal(personality, in: app); personality.tap(); app.buttons["Calm"].tap()
        let reminders = app.switches["companion.reminders"]; reveal(reminders, in: app)
        reminders.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        XCTAssertEqual(reminders.value as? String, "0")
        let save = app.buttons["companion.save"]; reveal(save, in: app)
        try fixture(["failSave": true]); save.tap()
        XCTAssertTrue(app.staticTexts["companion.error"].waitForExistence(timeout: 10)); capture(app, "companion-save-error-keeps-draft")
        try fixture(["failSave": false]); save.tap()
        XCTAssertTrue(app.staticTexts["companion.saved"].waitForExistence(timeout: 10))
        let profile = try XCTUnwrap(try fixture()["profile"] as? [String: Any])
        XCTAssertEqual(profile["name"] as? String, "Nova")
        XCTAssertEqual(profile["avatar"] as? String, "owl")
        XCTAssertEqual(profile["color"] as? String, "mint")
        XCTAssertEqual(profile["personality"] as? String, "calm")
        XCTAssertEqual(profile["reminders"] as? Bool, false)
        XCTAssertEqual(profile["enabled"] as? Bool, false)
        capture(app, "companion-child-saved")
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Nova"].waitForExistence(timeout: 5))
        app.terminate()
    }

    func testParentConsentAndAgeControlsAtLargeText() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        try fixture(["reset": true])
        let kidID = try XCTUnwrap(try fixture()["kidID"] as? String)
        let app = launch(parent: true, largeText: true)
        let child = app.buttons["companion.child.\(kidID)"]
        XCTAssertTrue(app.collectionViews.firstMatch.waitForExistence(timeout: 10)); reveal(child, in: app)
        capture(app, "companion-parent-children-large-text"); child.tap()
        let enable = app.switches["companion.enable"]
        XCTAssertTrue(enable.waitForExistence(timeout: 5)); reveal(enable, in: app)
        enable.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        let age = app.buttons["companion.ageBand"]; reveal(age, in: app); age.tap(); app.buttons["Ages 9–12"].tap()
        let save = app.buttons["companion.policySave"]; reveal(save, in: app); capture(app, "companion-parent-consent-large-text"); save.tap()
        XCTAssertTrue(app.staticTexts["companion.saved"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields["companion.name"].exists)
        let profile = try XCTUnwrap(try fixture()["profile"] as? [String: Any])
        XCTAssertEqual(profile["enabled"] as? Bool, true)
        XCTAssertEqual(profile["ageBand"] as? String, "9-12")
        XCTAssertEqual(profile["name"] as? String, "Pip")
        capture(app, "companion-parent-enabled-large-text")
        app.terminate(); XCUIDevice.shared.orientation = .portrait
    }

    func testEnabledChildChatStaysPrivateAndShowsTutorReply() throws {
        XCUIDevice.shared.orientation = .portrait
        try fixture(["reset": true]); try fixture(["enabled": true])
        let before = try fixture()["privateMessages"] as? Int ?? 0
        let app = launch()
        XCTAssertTrue(app.textFields["companion.name"].waitForExistence(timeout: 10))
        app.buttons["Done"].firstMatch.tap()
        let composer = app.descendants(matching: .any)["chat.composer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5)); XCTAssertTrue(composer.isEnabled)
        composer.tap(); composer.typeText("Can I have a hint to get started?")
        app.buttons["chat.send"].tap()
        let reply = app.staticTexts["Let’s start with one hint. What have you tried so far?"]
        XCTAssertTrue(reply.waitForExistence(timeout: 10)); capture(app, "companion-private-tutor-reply")
        let state = try fixture()
        XCTAssertEqual(state["privateMessages"] as? Int, before + 2)
        XCTAssertEqual(state["familyMessages"] as? Int, 0)
        XCTAssertEqual(state["parentMessages"] as? Int, 0)
        app.terminate()
    }
}
