import XCTest

final class StudentOrganizationUITests: XCTestCase {
    private let base = "http://127.0.0.1:18465"
    private func fixture() throws -> [String: Any] {
        let done = expectation(description: "Real local organizer fixture")
        var result: Result<[String: Any], Error>?
        URLSession.shared.dataTask(with: URL(string: base + "/__qa/student")!) { data, _, error in
            defer { done.fulfill() }
            if let error { result = .failure(error); return }
            result = Result { try JSONSerialization.jsonObject(with: data!) as! [String: Any] }
        }.resume()
        wait(for: [done], timeout: 10)
        return try XCTUnwrap(result).get()
    }
    private func launch(parent: Bool = false, largeText: Bool = false) throws -> XCUIApplication {
        continueAfterFailure = false
        let data = try fixture()
        let app = XCUIApplication()
        app.launchEnvironment = ["FAM_BASE_URL": base, "FAM_ONBOARDED": "1", "FAM_THEME": "light", "FAM_SCREEN": "today",
                                 "FAM_DEV_COOKIE": try XCTUnwrap(data[parent ? "parentCookie" : "childCookie"] as? String)]
        if largeText { app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        let entry = app.buttons["studentSupport.entry"]
        XCTAssertTrue(entry.waitForExistence(timeout: 25))
        for _ in 0..<12 where !entry.isHittable { app.swipeUp() }
        XCTAssertTrue(entry.isHittable)
        entry.tap()
        if !parent { XCTAssertTrue(app.staticTexts["QA Calculator"].waitForExistence(timeout: 15)) }
        return app
    }
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        let list = app.collectionViews.allElementsBoundByIndex.last!
        for _ in 0..<20 {
            let exists = element.exists
            let frame = exists ? element.frame : .zero
            if exists && element.isHittable && frame.minY > list.frame.minY + 72 && frame.maxY < list.frame.maxY - 8 { return }
            let down = exists && frame.minY < list.frame.minY + 72
            list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.35 : 0.7))
                .press(forDuration: 0.05, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.6 : 0.45)))
        }
        XCTFail("Could not reveal \(element.identifier) inside the presented list")
    }
    func testChildPackingAndHandInUseRealServerInPortraitAndLandscape() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = try launch()
        XCTAssertTrue(app.buttons["studentSupport.nowAction"].exists)
        let packing = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "studentSupport.pack.")).firstMatch
        reveal(packing, in: app)
        XCTAssertTrue(packing.isHittable); packing.tap()
        let packed = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "packed")).firstMatch
        XCTAssertTrue(packed.waitForExistence(timeout: 5))
        capture(app, "organizer-packing-menu")
        packed.tap()
        let checked = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Status: packed"), object: packing)
        XCTAssertEqual(XCTWaiter.wait(for: [checked], timeout: 10), .completed)
        let updated = try fixture()["support"] as! [String: Any]
        let items = (updated["packing"] as! [String: Any])["items"] as! [[String: Any]]
        XCTAssertEqual(items.first?["status"] as? String, "packed")
        capture(app, "organizer-ipad-portrait-packed")
        let assignment = app.buttons["studentSupport.homework." + (try XCTUnwrap(fixture()["homeworkId"] as? String))]
        reveal(assignment, in: app)
        XCTAssertTrue(assignment.isHittable); assignment.tap()
        let handIn = app.buttons["studentSupport.handIn"]
        reveal(handIn, in: app)
        XCTAssertTrue(handIn.isHittable); handIn.tap()
        XCTAssertTrue(app.staticTexts["Hand-in: reported"].waitForExistence(timeout: 10))
        let state = try fixture()
        XCTAssertEqual((state["homework"] as? [String: Any])?["status"] as? String, "todo")
        XCUIDevice.shared.orientation = .landscapeLeft
        capture(app, "organizer-ipad-landscape-hand-in")
        app.terminate()
    }
    func testParentSetupAndLargeTextRemainReachable() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = try launch(parent: true, largeText: true)
        let setup = app.buttons["Set up agreed routines and materials"]
        XCTAssertTrue(setup.waitForExistence(timeout: 15)); setup.tap()
        XCTAssertTrue(app.switches["studentSupport.enable"].waitForExistence(timeout: 10))
        capture(app, "organizer-parent-large-text-setup")
        let add = app.buttons["studentSupport.addMaterial"]
        reveal(add, in: app)
        XCTAssertTrue(add.isHittable); add.tap()
        let rule = app.buttons["New material"]
        reveal(rule, in: app)
        XCTAssertTrue(rule.isHittable); rule.tap()
        let title = app.textFields["studentSupport.ruleTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 10)); title.tap(); title.typeText("QA Water bottle")
        capture(app, "organizer-parent-material-editor")
        app.navigationBars["Material rule"].buttons.element(boundBy: 0).tap()
        let save = app.buttons["studentSupport.setupSave"]
        reveal(save, in: app)
        XCTAssertTrue(save.isHittable); save.tap()
        XCTAssertTrue(save.waitForNonExistence(timeout: 10))
        let saved = try fixture()["support"] as! [String: Any]
        XCTAssertTrue((saved["materialRules"] as! [[String: Any]]).contains { $0["title"] as? String == "QA Water bottle" })
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
    }
}
