import XCTest
import WatchKit
@testable import FamETCWatch

final class WatchDelegateTests: XCTestCase {
    func testBackgroundNotificationsUseSupportedPlistKey() {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String], ["remote-notification"])
        XCTAssertNil(Bundle.main.object(forInfoDictionaryKey: "WKBackgroundModes"))
    }

    func testSignedWatchCanSaveReplaceAndClearItsDeviceCredential() throws {
        let keychain = KeychainWatchCredentialStore(service: "com.fametc.watch.tests", account: UUID().uuidString)
        defer { try? keychain.clear() }
        XCTAssertNil(try keychain.credential())
        let kid = WatchCredential(kind: .bearerToken, value: "synthetic-kid", role: "kid", userId: "kid", familyId: "family")
        try keychain.save(kid)
        XCTAssertEqual(try keychain.credential(), kid)
        let parent = WatchCredential(kind: .bearerToken, value: "synthetic-parent", role: "parent", userId: "parent", familyId: "family")
        try keychain.save(parent)
        XCTAssertEqual(try keychain.credential(), parent)
        try keychain.clear()
        XCTAssertNil(try keychain.credential())
    }

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
