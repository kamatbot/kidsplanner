import XCTest
import UIKit

final class StudyPalUITests: XCTestCase {
    func testChildVisibilityPersistsAndParentHasNoPal() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = ["FAM_BASE_URL": "http://127.0.0.1:18257", "FAM_ONBOARDED": "1", "FAM_THEME": "dark", "FAM_SCREEN": "today", "FAM_DEV_COOKIE": "fam_sess=kid; fam_qa_scenario=family-rings"]
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let toggle = app.buttons["today.studyPal.toggle"]
        XCTAssertTrue(app.descendants(matching: .any)["today.hero.summary"].firstMatch.waitForExistence(timeout: 20))
        for _ in 0..<12 where !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.isHittable)
        if toggle.label == "Show Koko" { toggle.tap() }
        screenshot(app, "koko-visible-dark-large-text")
        toggle.tap()
        XCTAssertEqual(toggle.label, "Show Koko")
        app.terminate(); app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["today.hero.summary"].firstMatch.waitForExistence(timeout: 20))
        for _ in 0..<12 where !toggle.isHittable { app.swipeUp() }
        XCTAssertEqual(toggle.label, "Show Koko")
        toggle.tap()
        XCTAssertEqual(toggle.label, "Hide Koko")
        app.terminate()
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=parent; fam_qa_scenario=family-rings"
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["today.hero.summary"].firstMatch.waitForExistence(timeout: 20))
        XCTAssertFalse(toggle.exists)
        XCTAssertFalse(app.buttons["today.studyPal.open"].exists)
    }
    func testLightLayoutAndHomeworkNavigation() {
        continueAfterFailure = false
        if UIDevice.current.userInterfaceIdiom == .pad { XCUIDevice.shared.orientation = .landscapeLeft }
        let app = XCUIApplication()
        app.launchEnvironment = ["FAM_BASE_URL": "http://127.0.0.1:18257", "FAM_ONBOARDED": "1", "FAM_THEME": "light", "FAM_SCREEN": "today", "FAM_DEV_COOKIE": "fam_sess=kid; fam_qa_scenario=family-rings"]
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["today.hero.summary"].firstMatch.waitForExistence(timeout: 20))
        let toggle = app.buttons["today.studyPal.toggle"]
        for _ in 0..<8 where !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.isHittable)
        if toggle.label == "Show Koko" { toggle.tap() }
        XCTAssertGreaterThanOrEqual(toggle.frame.height, 44)
        screenshot(app, "koko-light-layout")
        if UIDevice.current.userInterfaceIdiom == .pad {
            XCUIDevice.shared.orientation = .portrait
            screenshot(app, "koko-light-portrait")
            XCUIDevice.shared.orientation = .landscapeLeft
        }
        let openStudy = app.buttons["today.studyPal.open"]
        for _ in 0..<8 where !openStudy.isHittable { app.swipeUp() }
        XCTAssertTrue(openStudy.isHittable)
        openStudy.tap()
        let homework = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Next homework.")).firstMatch
        XCTAssertTrue(homework.waitForExistence(timeout: 5))
        screenshot(app, "koko-study-panel")
        homework.tap()
        XCTAssertTrue(app.staticTexts["Visual coral field notes"].waitForExistence(timeout: 10))
        XCUIDevice.shared.orientation = .portrait
    }
    private func screenshot(_ app: XCUIApplication, _ name: String) {
        // The iPad simulator can return a composited transition frame just
        // after rotation even though accessibility queries have settled.
        Thread.sleep(forTimeInterval: 2)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
