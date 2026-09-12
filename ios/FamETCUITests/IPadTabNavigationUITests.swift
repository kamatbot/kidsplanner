import UIKit
import XCTest

final class IPadTabNavigationUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testEveryRailDestinationRespondsToOneTap() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else {
            throw XCTSkip("The compact rail is an iPad-only navigation surface.")
        }

        let app = XCUIApplication()
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_MOCK_NAVIGATION"] = "1"
        app.launch()

        assertOneTap(app, tab: "homework", screen: "homework")
        assertOneTap(app, tab: "calendar", screen: "calendar")
        assertOneTap(app, tab: "chat", screen: "chat")
        assertOneTap(app, tab: "trips", screen: "planning")
        assertOneTap(app, tab: "meals", screen: "planning")
        assertOneTap(app, tab: "today", screen: "today")
    }

    private func assertOneTap(
        _ app: XCUIApplication,
        tab: String,
        screen: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let button = app.buttons["ipad-tab-\(tab)"]
        XCTAssertTrue(button.waitForExistence(timeout: 2), "Missing \(tab) rail button", file: file, line: line)
        button.tap()

        let destination = app.descendants(matching: .any)["screen-\(screen)"]
        XCTAssertTrue(
            destination.waitForExistence(timeout: 2),
            "\(tab) did not open after one tap",
            file: file,
            line: line
        )
        XCTAssertTrue(button.isSelected, "\(tab) did not become selected", file: file, line: line)
    }
}
