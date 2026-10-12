import XCTest
@testable import FamETC

final class FamilyAccountEntryTests: XCTestCase {
    func testParentsSeeFamilyAndAccountKidsSeeSignOut() {
        XCTAssertEqual(FamilyAccountEntryKind(isParent: true), .familyAndAccount)
        XCTAssertEqual(FamilyAccountEntryKind(isParent: true).title, "Family & account")
        XCTAssertEqual(FamilyAccountEntryKind(isParent: false), .signOut)
        XCTAssertEqual(FamilyAccountEntryKind(isParent: false).title, "Sign out")
    }

    func testParentInviteDecodes() throws {
        let json = #"{"code":"ABCD2345","expiresAt":"2026-10-14T10:00:00.000Z"}"#
        let invite = try JSONDecoder().decode(ParentInvite.self, from: Data(json.utf8))
        XCTAssertEqual(invite.code, "ABCD2345")
        XCTAssertEqual(invite.expiresAt, "2026-10-14T10:00:00.000Z")
    }
}
