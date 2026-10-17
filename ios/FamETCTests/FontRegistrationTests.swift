import XCTest
import UIKit
@testable import FamETC

final class FontRegistrationTests: XCTestCase {
    func testBundledGeistRegistersWithThemePostScriptName() {
        XCTAssertNotNil(UIFont(name: Theme.fontName, size: 16))
        XCTAssertTrue(UIFont.fontNames(forFamilyName: "Geist").contains(Theme.fontName))
    }

    /// The soft layout's display face must load as Playfair Display, never a
    /// system serif fallback (docs/design/soft-rings/IOS-BRIEF.md §1).
    func testBundledPlayfairDisplayRegistersWithThemePostScriptName() {
        XCTAssertNotNil(UIFont(name: Theme.displayFontName, size: 22))
        XCTAssertTrue(UIFont.fontNames(forFamilyName: "Playfair Display").contains(Theme.displayFontName))
    }
}
