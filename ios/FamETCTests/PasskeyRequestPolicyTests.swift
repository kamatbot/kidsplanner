import AuthenticationServices
import Foundation
import XCTest
@testable import FamETC

final class PasskeyRequestPolicyTests: XCTestCase {
    func testRegistrationRequestRequiresUserVerification() {
        let challenge = Data([0x01, 0x02, 0x03])
        let userID = Data([0x04, 0x05, 0x06])

        let request = PasskeyRequestFactory.registration(
            relyingPartyIdentifier: "fametc.com",
            challenge: challenge,
            name: "Parent",
            userID: userID
        )

        XCTAssertEqual(request.relyingPartyIdentifier, "fametc.com")
        XCTAssertEqual(request.challenge, challenge)
        XCTAssertEqual(request.userID, userID)
        XCTAssertEqual(request.userVerificationPreference, .required)
    }

    func testAssertionRequestRequiresUserVerification() {
        let challenge = Data([0x07, 0x08, 0x09])

        let request = PasskeyRequestFactory.assertion(
            relyingPartyIdentifier: "fametc.com",
            challenge: challenge
        )

        XCTAssertEqual(request.relyingPartyIdentifier, "fametc.com")
        XCTAssertEqual(request.challenge, challenge)
        XCTAssertEqual(request.userVerificationPreference, .required)
    }
}
