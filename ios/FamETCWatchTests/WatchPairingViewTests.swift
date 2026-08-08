import XCTest
@testable import FamETCWatch

final class WatchPairingViewTests: XCTestCase {
    func testPairingInputNormalizesAndBounds() {
        XCTAssertEqual(WatchPairingInput.normalize(" ab-cd 12!?3456789 "), "ABCD2345")
        XCTAssertTrue(WatchPairingInput.isValid("ABCD2345"))
        XCTAssertFalse(WatchPairingInput.isValid("ABCD234"))
    }
}
