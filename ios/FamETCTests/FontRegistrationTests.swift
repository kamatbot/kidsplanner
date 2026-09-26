import XCTest
import UIKit
@testable import FamETC

final class FontRegistrationTests: XCTestCase {
    func testBundledGeistRegistersWithThemePostScriptName() {
        XCTAssertNotNil(UIFont(name: Theme.fontName, size: 16))
        XCTAssertTrue(UIFont.fontNames(forFamilyName: "Geist").contains(Theme.fontName))
    }
}
