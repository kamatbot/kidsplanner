import XCTest
@testable import FamETC

/// Smoke tests for the non-domain plumbing: Config's base URL and the client
/// header contract the server's iOS free-tier gate relies on.
final class LogicTests: XCTestCase {

    func testBaseURLHasFamETCHost() {
        let url = Config.baseURL
        XCTAssertNotNil(url)
        XCTAssertTrue(url.host == "www.fametc.com" || url.host == "fametc.com", "unexpected host: \(url.host ?? "nil")")
        XCTAssertEqual(url.scheme, "https")
    }

    func testAllowedHostsIncludeApexAndWWW() {
        XCTAssertTrue(Config.isAllowed(host: "www.fametc.com"))
        XCTAssertTrue(Config.isAllowed(host: "fametc.com"))
        XCTAssertFalse(Config.isAllowed(host: "evil.com"))
    }

    func testClientHeadersUseFamETCPrefix() {
        let headers = Config.clientHeaders
        XCTAssertEqual(headers["X-FamETC-Client"], "ios")
    }

    func testBridgeNameIsFam() {
        XCTAssertEqual(Config.bridgeName, "fam")
    }
}
