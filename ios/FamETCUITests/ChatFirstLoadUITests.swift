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
}
