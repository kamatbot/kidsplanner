import XCTest
@testable import FamETC

@MainActor
final class MoodCheckInTests: XCTestCase {
    func testSelectionHelpAndCancelDoNotSend() async {
        let model = MoodCheckInModel()
        var sends = 0
        model.select(.low); model.preview(help: true)
        XCTAssertTrue(model.draft.contains("help"))
        model.clear()
        await model.confirm(identity: "kid", currentIdentity: { "kid" }) { _, _ in sends += 1 }
        XCTAssertEqual(sends, 0); XCTAssertNil(model.energy); XCTAssertEqual(model.draft, "")
    }
    func testRetryPreservesExactMessageAndKey() async {
        let model = MoodCheckInModel()
        var attempts: [(String, String)] = []
        model.select(.okay); model.preview(); model.draft = "Please help with homework."
        await model.confirm(identity: "kid", currentIdentity: { "kid" }) { text, key in
            attempts.append((text, key)); throw URLError(.networkConnectionLost)
        }
        XCTAssertEqual(model.draft, "Please help with homework.")
        XCTAssertTrue(model.attempted); XCTAssertFalse(model.sending)
        XCTAssertTrue(model.status.contains("not confirmed"))
        await model.confirm(identity: "kid", currentIdentity: { "kid" }) { text, key in attempts.append((text, key)) }
        XCTAssertEqual(attempts.count, 2)
        XCTAssertEqual(attempts[0].0, attempts[1].0); XCTAssertEqual(attempts[0].1, attempts[1].1)
        XCTAssertEqual(model.draft, ""); XCTAssertEqual(model.status, "Sent to family chat.")
    }
    func testAccountSwitchPreventsOldDraftSend() async {
        let model = MoodCheckInModel(); var sends = 0
        model.select(.full); model.preview()
        await model.confirm(identity: "old", currentIdentity: { "new" }) { _, _ in sends += 1 }
        XCTAssertEqual(sends, 0); XCTAssertNil(model.energy); XCTAssertEqual(model.draft, "")
    }
    func testDoubleTapAndAccountChangeDuringSend() async {
        let model = MoodCheckInModel(); var identity = "kid"; var sends = 0
        model.select(.low); model.preview()
        await model.confirm(identity: "kid", currentIdentity: { identity }) { _, _ in
            sends += 1
            await model.confirm(identity: "kid", currentIdentity: { identity }) { _, _ in sends += 1 }
            identity = "other"
        }
        XCTAssertEqual(sends, 1); XCTAssertEqual(model.draft, ""); XCTAssertEqual(model.status, "")
    }
}
