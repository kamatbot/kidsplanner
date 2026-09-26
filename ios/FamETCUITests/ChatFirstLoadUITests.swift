import XCTest

/// Regression test for the chat first-layout race (device bug, builds 21-22):
/// messages that arrive AFTER the chat surface laid out stayed offscreen (or
/// invisible, for onAppear-gated card rows) until the user scrolled.
///
/// The app is launched straight onto the Chat tab with FAM_MOCK_CHAT_DELAY_MS,
/// which makes AppStore inject a mock family + 14 messages ~1.2s after launch —
/// exactly the async-arrival timing of a real cold start. The test then asserts
/// the FINAL message is actually visible in the viewport WITHOUT performing any
/// scroll or tap gesture.
final class ChatFirstLoadUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterLaunch = false
    }

    // Silence the unused-property style warning while keeping intent obvious.
    private var continueAfterLaunch: Bool {
        get { continueAfterFailure }
        set { continueAfterFailure = newValue }
    }

    func testMessagesVisibleWithoutGestureAfterAsyncLoad() throws {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_MOCK_NAVIGATION"] = "1"
        app.launchEnvironment["FAM_SCREEN"] = "chat"
        app.launchEnvironment["FAM_MOCK_CHAT_DELAY_MS"] = "1200"
        app.launch()

        // The final marker message must appear on its own — no swipe, no tap.
        let marker = app.staticTexts["FINAL MARKER — visible without scroll"]
        XCTAssertTrue(marker.waitForExistence(timeout: 10),
                      "final chat message never appeared after async load")
        XCTAssertTrue(marker.isHittable,
                      "final chat message exists but is not visible in the viewport (first-layout race regressed)")

        // The system card (previously opacity-gated behind onAppear) must be
        // visible too, not just present in the hierarchy.
        let card = app.staticTexts["📚 New homework for QA: Card visibility check"]
        XCTAssertTrue(card.exists, "system card row missing from chat")
        XCTAssertTrue(card.isHittable, "system card rendered invisible (onAppear-gated reveal regressed)")
    }

    func testAttachmentPanelReplacesKeyboardAndKeepsDraft() throws {
        let app = launchChat()
        let composer = app.descendants(matching: .any)["chat.composer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 8))
        composer.tap()
        composer.typeText("Save this family moment")
        XCTAssertTrue(app.keyboards.keys["space"].waitForExistence(timeout: 5), "Enable the simulator software keyboard for the height comparison")
        let composerY = composer.frame.minY
        capture(app, "chat-keyboard")

        app.buttons["chat.attachments.toggle"].tap()
        let photos = app.buttons["chat.attachments.photos"]
        XCTAssertTrue(photos.waitForExistence(timeout: 5))
        XCTAssertTrue(photos.isHittable)
        XCTAssertTrue(app.buttons["chat.attachments.files"].isHittable)
        XCTAssertTrue(app.buttons["chat.attachments.gifs"].isHittable)
        XCTAssertTrue(app.buttons["chat.attachments.buzz"].isEnabled)
        XCTAssertFalse(app.keyboards.keys["space"].exists, "The system keys must be replaced, not stacked behind the picker")
        XCTAssertEqual(composer.value as? String, "Save this family moment")
        XCTAssertEqual(composer.frame.minY, composerY, accuracy: 12, "Replacing a docked keyboard must keep the composer at the same height")
        capture(app, "chat-attachment-panel")

        app.buttons["chat.attachments.toggle"].tap()
        XCTAssertTrue(app.keyboards.keys["space"].waitForExistence(timeout: 5))
        XCTAssertFalse(photos.exists)
        XCTAssertEqual(composer.value as? String, "Save this family moment")
        composer.typeText(" together")
        XCTAssertEqual(composer.value as? String, "Save this family moment together")
    }

    func testAttachmentActionsPresentNativePickersAndKeepDraft() throws {
        let app = launchChat()
        let composer = app.descendants(matching: .any)["chat.composer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 8))
        composer.tap()
        composer.typeText("Dinner is ready")

        app.buttons["chat.attachments.toggle"].tap()
        app.buttons["chat.attachments.buzz"].tap()
        let buzz = app.alerts["Send a Buzz?"]
        XCTAssertTrue(buzz.waitForExistence(timeout: 5))
        buzz.buttons["Cancel"].tap()
        XCTAssertEqual(composer.value as? String, "Dinner is ready")

        app.buttons["chat.attachments.toggle"].tap()
        app.buttons["chat.attachments.gifs"].tap()
        XCTAssertTrue(app.navigationBars["GIFs"].waitForExistence(timeout: 5))
        app.buttons["Close"].firstMatch.tap()
        XCTAssertEqual(composer.value as? String, "Dinner is ready")

        app.buttons["chat.attachments.toggle"].tap()
        app.buttons["chat.attachments.photos"].tap()
        let photoCancel = app.buttons["Cancel"].firstMatch
        XCTAssertTrue(photoCancel.waitForExistence(timeout: 5), "The native photo picker must open")
        capture(app, "chat-photo-picker")
        photoCancel.tap()

        app.buttons["chat.attachments.toggle"].tap()
        app.buttons["chat.attachments.files"].tap()
        let fileCancel = app.buttons["Cancel"].firstMatch
        XCTAssertTrue(fileCancel.waitForExistence(timeout: 5), "The native Files picker must open")
        capture(app, "chat-file-picker")
        fileCancel.tap()
        XCTAssertEqual(composer.value as? String, "Dinner is ready")
    }

    func testEmptyDraftDisablesBuzzAndComposerTapRestoresKeyboard() throws {
        let app = launchChat()
        let composer = app.descendants(matching: .any)["chat.composer"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 8))
        app.buttons["chat.attachments.toggle"].tap()
        let buzz = app.buttons["chat.attachments.buzz"]
        XCTAssertTrue(buzz.waitForExistence(timeout: 5))
        XCTAssertFalse(buzz.isEnabled)
        composer.tap()
        XCTAssertTrue(app.keyboards.keys["space"].waitForExistence(timeout: 5))
        composer.typeText("Hi family")
        XCTAssertEqual(composer.value as? String, "Hi family")
    }

    func testAttachmentPanelLargeTextKeepsActionsReachable() throws {
        let app = launchChat(largeText: true)
        app.buttons["chat.attachments.toggle"].tap()
        let panel = app.scrollViews["chat.attachments.panel"]
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["chat.attachments.photos"].isHittable)
        panel.swipeUp()
        let buzz = app.buttons["chat.attachments.buzz"]
        XCTAssertTrue(buzz.isHittable)
        XCTAssertFalse(buzz.isEnabled)
        capture(app, "chat-attachments-large-text")
    }

    private func launchChat(largeText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_MOCK_NAVIGATION"] = "1"
        app.launchEnvironment["FAM_SCREEN"] = "chat"
        app.launchEnvironment["FAM_MOCK_CHAT_DELAY_MS"] = "200"
        if largeText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        app.launch()
        XCTAssertTrue(app.staticTexts["FINAL MARKER — visible without scroll"].waitForExistence(timeout: 8))
        return app
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

}
