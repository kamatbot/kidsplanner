import XCTest
import WatchKit
@testable import FamETCWatch

final class WatchDelegateTests: XCTestCase {
    func testWatchPushCallbacksUseActualWatchDelegateSelectors() {
        let delegate = FamETCWatchExtensionDelegate()
        XCTAssertTrue(delegate.responds(to: #selector(WKApplicationDelegate.didRegisterForRemoteNotifications(withDeviceToken:))))
        XCTAssertTrue(delegate.responds(to: #selector(WKApplicationDelegate.didFailToRegisterForRemoteNotificationsWithError(_:))))
        XCTAssertTrue(delegate.responds(to: #selector(WKApplicationDelegate.didReceiveRemoteNotification(_:fetchCompletionHandler:))))
    }
    func testBearerMetadataRoundTripAndLegacyCredentialStillDecodes() throws {
        let old = try JSONDecoder().decode(WatchCredential.self, from: Data("{\"kind\":\"bearerToken\",\"value\":\"example\"}".utf8))
        XCTAssertNil(old.role)
        let current = WatchCredential(kind: .bearerToken, value: "example", role: "kid", userId: "kid-user", familyId: "family")
        XCTAssertEqual(try JSONDecoder().decode(WatchCredential.self, from: JSONEncoder().encode(current)), current)
    }
}
