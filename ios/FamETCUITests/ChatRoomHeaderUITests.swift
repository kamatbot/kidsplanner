import XCTest

final class ChatRoomHeaderUITests: XCTestCase {
    func testSeparateRoomsExposeAndClearOnlyTheirOwnUnreadCount() {
        checkRooms(largeText: false)
    }

    func testRoomTabsRemainReachableWithLargeText() {
        checkRooms(largeText: true)
    }

    private func checkRooms(largeText: Bool) {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchEnvironment = ["FAM_ONBOARDED": "1", "FAM_MOCK_NAVIGATION": "1",
                                 "FAM_SCREEN": "chat", "FAM_MOCK_CHAT_DELAY_MS": "200",
                                 "FAM_MOCK_CHAT_ROOMS": "1"]
        if largeText {
            app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        app.launch()
        let family = app.buttons["chat.room.family"]
        let hermes = app.buttons["chat.room.hermes"]
        let trip = app.buttons["chat.room.trip:qa"]
        XCTAssertTrue(hermes.waitForExistence(timeout: 10))
        XCTAssertEqual(hermes.value as? String, "2 unread messages")
        XCTAssertEqual(trip.value as? String, "1 unread message")
        XCTAssertTrue(family.isSelected)
        capture("room-tabs-before-reading")

        tap(hermes, in: app)
        XCTAssertTrue(app.staticTexts["Private Hermes message 2"].waitForExistence(timeout: 5))
        XCTAssertTrue(hermes.isSelected)
        XCTAssertEqual(hermes.value as? String, "No unread messages")
        XCTAssertEqual(trip.value as? String, "1 unread message", "Reading Hermes must not clear a trip")
        tap(trip, in: app)
        XCTAssertTrue(app.staticTexts["Trip message 1"].waitForExistence(timeout: 5))
        XCTAssertTrue(trip.isSelected)
        XCTAssertEqual(trip.value as? String, "No unread messages")
        capture(largeText ? "room-tabs-large-text" : "room-tabs-trip")
        let strip = app.scrollViews["chat.rooms"]
        for _ in 0..<6 where !family.isHittable { strip.swipeRight() }
        family.tap()
        XCTAssertTrue(family.isSelected)
        XCTAssertTrue(app.staticTexts["FINAL MARKER — visible without scroll"].waitForExistence(timeout: 5))
    }

    private func tap(_ button: XCUIElement, in app: XCUIApplication) {
        let strip = app.scrollViews["chat.rooms"]
        for _ in 0..<6 where !button.isHittable { strip.swipeLeft() }
        XCTAssertTrue(button.isHittable)
        XCTAssertGreaterThanOrEqual(button.frame.height, 44)
        button.tap()
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
