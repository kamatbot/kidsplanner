import UIKit
import XCTest

final class IPadTabNavigationUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testAdaptiveNavigationKeepsSelectionAcrossRotation() throws {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_MOCK_NAVIGATION"] = "1"
        app.launch()

        assertOneTap(app, tab: "Homework", screen: "homework")
        assertOneTap(app, tab: "Calendar", screen: "calendar")
        assertOneTap(app, tab: "Chat", screen: "chat")
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        XCTAssertTrue(app.descendants(matching: .any)["screen-chat"].waitForExistence(timeout: 3))
        assertOneTap(app, tab: "Planning", screen: "planning")
        let picker = app.segmentedControls.firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 2))
        picker.buttons["Meals"].tap()
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(picker.buttons["Meals"].isSelected)
        picker.buttons["Trips"].tap()
        assertOneTap(app, tab: "Today", screen: "today")
    }

    private func assertOneTap(
        _ app: XCUIApplication,
        tab: String,
        screen: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let button = app.buttons[tab].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 2), "Missing \(tab) navigation button", file: file, line: line)
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
