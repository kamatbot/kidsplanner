import XCTest
@testable import FamETC

/// The first requests after a launch or app update retry quietly on these errors.
final class NetworkRetryTests: XCTestCase {
    func testOnlyTransientNetworkErrorsAreRetried() {
        for code in [URLError.Code.networkConnectionLost, .timedOut, .cannotConnectToHost, .notConnectedToInternet] {
            XCTAssertTrue(APIClient.isTransient(URLError(code)), "\(code)")
        }
        XCTAssertFalse(APIClient.isTransient(URLError(.badURL)))
        XCTAssertFalse(APIClient.isTransient(URLError(.cancelled)))
        XCTAssertFalse(APIClient.isTransient(APIError.unauthenticated))
    }

    /// A cancelled load keeps what's on screen instead of showing an error.
    func testCancellationIsNotAFailure() {
        XCTAssertTrue(CancellationError().isCancellation)
        XCTAssertTrue(URLError(.cancelled).isCancellation)
        XCTAssertTrue(APIError.transport(URLError(.cancelled)).isCancellation)
        XCTAssertFalse(APIError.transport(URLError(.timedOut)).isCancellation)
        XCTAssertFalse(APIError.unauthenticated.isCancellation)
    }
}
