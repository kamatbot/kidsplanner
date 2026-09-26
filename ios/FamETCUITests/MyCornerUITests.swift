import XCTest

/// Run with the local synthetic My Corner server; uses real auth/routes/storage.
final class MyCornerUITests: XCTestCase {
    private let base = "http://127.0.0.1:18369"
    private func sessions() throws -> [String: String] {
        let wait = expectation(description: "Local sessions")
        var result: Result<[String: String], Error>!
        URLSession.shared.dataTask(with: URL(string: base + "/qa/my-corner-session")!) { data, _, error in
            result = Result { if let error { throw error }; return try JSONDecoder().decode([String: String].self, from: data!) }
            wait.fulfill()
        }.resume()
        waitForExpectations(timeout: 5)
        return try result.get()
    }
    private func failNext(_ operation: String) {
        let wait = expectation(description: "Set synthetic failure")
        var request = URLRequest(url: URL(string: base + "/qa/my-corner-failure")!)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try! JSONSerialization.data(withJSONObject: ["operation": operation])
        URLSession.shared.dataTask(with: request) { _, _, _ in wait.fulfill() }.resume()
        waitForExpectations(timeout: 5)
    }
    private func launch(_ cookie: String, large: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = ["FAM_BASE_URL": base, "FAM_ONBOARDED": "1", "FAM_SCREEN": "today", "FAM_DEV_COOKIE": cookie, "FAM_THEME": large ? "dark" : "light"]
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", large ? "UICTContentSizeCategoryAccessibilityXXXL" : "UICTContentSizeCategoryL"]
        app.launch(); return app
    }
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<9 { if element.exists && element.isHittable { return }; app.swipeUp() }
    }
    private func messages(_ cookie: String) throws -> [[String: Any]] {
        let done = expectation(description: "Real synthetic family chat")
        var result: Result<[[String: Any]], Error>!
        var request = URLRequest(url: URL(string: base + "/api/chat/messages")!)
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        URLSession.shared.dataTask(with: request) { data, _, error in
            result = Result {
                if let error { throw error }
                let body = try JSONSerialization.jsonObject(with: data!) as! [String: Any]
                return body["messages"] as? [[String: Any]] ?? []
            }
            done.fulfill()
        }.resume()
        waitForExpectations(timeout: 5)
        return try result.get()
    }
    private func open(_ app: XCUIApplication, retryLoad: Bool = false) {
        let koko = app.buttons["today.studyPal.open"]
        XCTAssertTrue(koko.waitForExistence(timeout: 15)); reveal(koko, in: app); koko.tap()
        let entry = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "My Corner.")).firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 5)); entry.tap()
        if retryLoad { XCTAssertTrue(app.buttons["Retry loading"].waitForExistence(timeout: 8)); app.buttons["Retry loading"].tap() }
        XCTAssertTrue(app.buttons["corner-save"].waitForExistence(timeout: 10))
    }
    private func closeCornerAndPanel(_ app: XCUIApplication) {
        app.navigationBars["My Corner"].buttons["Close"].tap()
        let panelClose = app.navigationBars["Koko"].buttons["Close"]
        XCTAssertTrue(panelClose.waitForExistence(timeout: 5))
        panelClose.tap()
    }
    func testExpandedCollectionCanSaveAndReopenNewSticker() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = launch(try sessions()["child"]!)
        open(app)
        if app.buttons["Add sticker"].exists { app.buttons["Add sticker"].tap() }
        let sticker = app.buttons["Add paper plane"]
        let collection = app.scrollViews["corner.collection"]
        XCTAssertTrue(collection.waitForExistence(timeout: 5))
        for _ in 0..<12 where !sticker.isHittable { collection.swipeUp() }
        XCTAssertTrue(sticker.isHittable)
        sticker.tap()
        let save = app.buttons["corner-save"]; reveal(save, in: app); save.tap()
        XCTAssertTrue(app.staticTexts["Saved."].waitForExistence(timeout: 8))
        closeCornerAndPanel(app); open(app)
        XCTAssertTrue(app.buttons["Select paper plane"].waitForExistence(timeout: 5))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "expanded-sticker-collection"; shot.lifetime = .keepAlways; add(shot)
    }

    func testTouchPlacementAndRemoval() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = launch(try sessions()["child"]!)
        open(app)
        if app.buttons["Add sticker"].exists { app.buttons["Add sticker"].tap() }
        let star = app.buttons["Add small star"]
        reveal(star, in: app); star.tap()
        reveal(app.buttons["Up"], in: app); app.buttons["Up"].tap()
        reveal(app.buttons["Remove sticker"], in: app); app.buttons["Remove sticker"].tap()
        let save = app.buttons["corner-save"]; reveal(save, in: app); save.tap()
        XCTAssertTrue(app.staticTexts["Saved."].waitForExistence(timeout: 8))
        closeCornerAndPanel(app); open(app)
        XCTAssertFalse(app.buttons["Select small star"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "my-corner-touch-removal-reopen"; shot.lifetime = .keepAlways; add(shot)
    }
    func testNativeTodayEditorSaveReopenAndAccountSwitch() throws {
        continueAfterFailure = false
        let cookies = try sessions()
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = launch(cookies["child"]!)
        // Combined acceptance: all three features on the same real child Today.
        let pal = app.buttons["today.studyPal.toggle"]
        XCTAssertTrue(pal.waitForExistence(timeout: 15)); reveal(pal, in: app)
        if pal.label == "Show Koko" { pal.tap() }
        pal.tap(); XCTAssertEqual(pal.label, "Show Koko"); pal.tap()
        let kokoOpen = app.buttons["today.studyPal.open"]
        reveal(kokoOpen, in: app); kokoOpen.tap()
        let mood = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Energy check-in.")).firstMatch
        XCTAssertTrue(mood.waitForExistence(timeout: 5)); mood.tap()
        XCTAssertTrue(app.buttons["Low"].waitForExistence(timeout: 5)); app.buttons["Low"].tap()
        let preview = app.buttons["Preview sharing"]; reveal(preview, in: app); preview.tap()
        let before = try messages(cookies["parent"]!).count
        app.buttons["Cancel"].tap()
        XCTAssertEqual(try messages(cookies["parent"]!).count, before)
        app.buttons["Close"].tap()
        reveal(kokoOpen, in: app); kokoOpen.tap()
        let secondMood = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Energy check-in.")).firstMatch
        XCTAssertTrue(secondMood.waitForExistence(timeout: 5)); secondMood.tap(); app.buttons["Okay"].tap()
        reveal(app.buttons["Preview sharing"], in: app); app.buttons["Preview sharing"].tap()
        reveal(app.buttons["Send to family"], in: app); app.buttons["Send to family"].tap()
        XCTAssertTrue(app.staticTexts["Sent to family chat."].waitForExistence(timeout: 8))
        let shared = try messages(cookies["parent"]!)
        XCTAssertEqual(shared.count, before + 1)
        XCTAssertEqual(shared.last?["text"] as? String, "My energy is okay today.")
        app.buttons["Cancel"].tap()
        app.navigationBars["Koko"].buttons["Close"].tap()
        let todayShot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        todayShot.name = "combined-child-today-ipad-landscape"; todayShot.lifetime = .keepAlways; add(todayShot)
        failNext("load"); open(app, retryLoad: true)
        if app.buttons["Add sticker"].exists { app.buttons["Add sticker"].tap() }
        let mango = app.buttons["Add mango sticky rice"]
        XCTAssertTrue(mango.waitForExistence(timeout: 5)); mango.tap()
        reveal(app.buttons["Right"], in: app); app.buttons["Right"].tap()
        reveal(app.buttons["Rotate 15°"], in: app); app.buttons["Rotate 15°"].tap()
        let field = app.textFields["corner-note"]
        let multiline = app.textViews["corner-note"]
        let note = field.exists ? field : multiline
        reveal(note, in: app); note.tap()
        note.typeText("Native corner note")
        app.buttons["Done editing"].tap()
        app.swipeUp()
        let save = app.buttons["corner-save"]; reveal(save, in: app); failNext("save"); save.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Your draft is preserved.")).firstMatch.waitForExistence(timeout: 8))
        save.tap()
        XCTAssertTrue(app.staticTexts["Saved."].waitForExistence(timeout: 8))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "my-corner-native-saved"; shot.lifetime = .keepAlways; add(shot)
        XCUIDevice.shared.orientation = .portrait
        let portrait = XCTAttachment(screenshot: app.screenshot()); portrait.name = "my-corner-native-portrait"; portrait.lifetime = .keepAlways; add(portrait)
        closeCornerAndPanel(app); open(app)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Native corner note")).firstMatch.waitForExistence(timeout: 5))
        closeCornerAndPanel(app)
        XCUIDevice.shared.orientation = .landscapeLeft
        let signOut = app.buttons["Sign out"]; XCTAssertTrue(signOut.waitForExistence(timeout: 5)); signOut.tap()
        XCTAssertTrue(app.buttons["I’m a parent"].exists || app.buttons["I'm a parent"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Native corner note")).firstMatch.exists)
        app.terminate()
        // Do not inject a new cookie: a genuine local logout must stay logged out.
        app.launchEnvironment.removeValue(forKey: "FAM_DEV_COOKIE")
        app.launchEnvironment.removeValue(forKey: "FAM_ONBOARDED")
        app.launch()
        XCTAssertTrue(app.buttons["I’m a parent"].exists || app.buttons["I'm a parent"].waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["today.studyPal.open"].exists)
        app.terminate()
        let other = launch(cookies["sibling"]!, large: true); open(other)
        XCTAssertFalse(other.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Native corner note")).firstMatch.exists)
        let largeShot = XCTAttachment(screenshot: other.screenshot()); largeShot.name = "my-corner-native-dark-large-empty"; largeShot.lifetime = .keepAlways; add(largeShot)
        other.terminate()
        let parent = launch(cookies["parent"]!)
        XCTAssertTrue(parent.cells["Today"].waitForExistence(timeout: 15))
        XCTAssertFalse(parent.buttons["today.studyPal.open"].exists)
        XCTAssertFalse(parent.buttons["today.studyPal.toggle"].exists)
        let parentShot = XCTAttachment(screenshot: parent.screenshot()); parentShot.name = "my-corner-parent-no-entry"; parentShot.lifetime = .keepAlways; add(parentShot)
    }
}
