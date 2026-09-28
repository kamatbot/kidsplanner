import XCTest
@testable import FamETC

/// docs/SCREEN-TIME-UX.md §5 + the device-side false-positive fixes: never-go-backwards
/// policy acceptance, per-store shield reasons, the install-key encoder and the
/// time-zone-aware pause signature. Keychain and AuthorizationCenter are not exercised here.
final class ScreenTimeFalsePositiveTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var enforcer: ScreenTimeEnforcer!

    override func setUp() {
        super.setUp()
        suiteName = "fam-st-tests-\(UUID())"
        defaults = UserDefaults(suiteName: suiteName)!
        enforcer = ScreenTimeEnforcer(defaults: defaults)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        enforcer = nil
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    private func policy(version: Int) -> ScreenTimePolicy {
        ScreenTimePolicy(version: version, enabled: true, updatedAt: nil, pauseUntil: nil, limits: [], downtime: [])
    }

    // MARK: shouldAccept

    func testShouldAcceptWithNoStoredPolicy() {
        XCTAssertTrue(enforcer.shouldAccept(policy(version: 1), kidId: nil))
        XCTAssertTrue(enforcer.shouldAccept(policy(version: 1), kidId: "k1"))
    }

    func testShouldAcceptRejectsOlderVersionSameKid() {
        enforcer.storedKidId = "k1"
        enforcer.storedPolicy = policy(version: 5)
        XCTAssertFalse(enforcer.shouldAccept(policy(version: 4), kidId: "k1"))
        XCTAssertFalse(enforcer.shouldAccept(policy(version: 4), kidId: nil))
    }

    func testShouldAcceptEqualVersionSameKid() {
        // Every parent change bumps the version, so an equal version (e.g. a selection
        // upload's echo of the same policy) must still be accepted.
        enforcer.storedKidId = "k1"
        enforcer.storedPolicy = policy(version: 5)
        XCTAssertTrue(enforcer.shouldAccept(policy(version: 5), kidId: "k1"))
    }

    func testShouldAcceptNewerVersionSameKid() {
        enforcer.storedKidId = "k1"
        enforcer.storedPolicy = policy(version: 5)
        XCTAssertTrue(enforcer.shouldAccept(policy(version: 6), kidId: "k1"))
    }

    func testShouldAcceptDifferentKidRegardlessOfVersion() {
        // A parent moved the device to another kid: their policy versions are unrelated,
        // so the new kid's policy is always accepted even with a "lower" version number.
        enforcer.storedKidId = "k1"
        enforcer.storedPolicy = policy(version: 99)
        XCTAssertTrue(enforcer.shouldAccept(policy(version: 1), kidId: "k2"))
    }

    // MARK: Per-store shield reasons

    func testPerStoreShieldReasonsFromTwoInstancesBothPresent() {
        // The app and the monitor extension each hold their own ScreenTimeEnforcer
        // instance over the same App Group suite.
        let second = ScreenTimeEnforcer(defaults: defaults)
        enforcer.shieldAll(.pause, reason: "Paused by a parent")
        second.shieldAll(.limit("total"), reason: "Daily screen time is up")
        XCTAssertEqual(enforcer.shieldReasons["pause"], "Paused by a parent")
        XCTAssertEqual(enforcer.shieldReasons["limit.total"], "Daily screen time is up")
        XCTAssertEqual(second.shieldReasons["pause"], "Paused by a parent")
        XCTAssertEqual(second.shieldReasons["limit.total"], "Daily screen time is up")
    }

    func testClearingOneStoreKeepsTheOther() {
        enforcer.shieldAll(.pause, reason: "Paused by a parent")
        enforcer.shieldAll(.downtime, reason: "Downtime")
        enforcer.clear(.pause)
        XCTAssertNil(enforcer.shieldReasons["pause"])
        XCTAssertEqual(enforcer.shieldReasons["downtime"], "Downtime")
    }

    func testLegacyShieldReasonsDictIsMigratedAndRemoved() {
        defaults.set(["pause": "Paused by a parent", "limit.total": "Daily screen time is up"], forKey: "fam_st_shieldReasons")
        let reasons = enforcer.shieldReasons
        XCTAssertEqual(reasons["pause"], "Paused by a parent")
        XCTAssertEqual(reasons["limit.total"], "Daily screen time is up")
        XCTAssertNil(defaults.dictionary(forKey: "fam_st_shieldReasons"))
        // Migrated entries now live under their own per-store keys.
        XCTAssertEqual(defaults.string(forKey: "fam_st_shieldReason.pause"), "Paused by a parent")
    }

    // MARK: Install-key encoder (pure — no Keychain)

    func testInstallKeyEncoderProducesBase64URLWithoutPadding() {
        let bytes = (0..<32).map { UInt8(($0 * 7) % 256) }
        let key = ScreenTimeInstallKey.encode(Data(bytes))
        XCTAssertEqual(key.count, 43)
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        XCTAssertTrue(key.unicodeScalars.allSatisfy(allowed.contains))
        XCTAssertFalse(key.contains("+"))
        XCTAssertFalse(key.contains("/"))
        XCTAssertFalse(key.contains("="))
    }

    func testInstallKeyEncoderIsDeterministic() {
        let data = Data((0..<32).map { UInt8($0) })
        XCTAssertEqual(ScreenTimeInstallKey.encode(data), ScreenTimeInstallKey.encode(data))
    }

    // MARK: Pause signature — time zone

    func testPauseSignatureIncludesTimeZoneIdentifier() {
        let ny = TimeZone(identifier: "America/New_York")!
        let tokyo = TimeZone(identifier: "Asia/Tokyo")!
        let a = ScreenTimeEnforcer.pauseSignature(pauseUntil: "2026-09-28T20:00:00Z", timeZone: ny)
        let b = ScreenTimeEnforcer.pauseSignature(pauseUntil: "2026-09-28T20:00:00Z", timeZone: tokyo)
        XCTAssertNotEqual(a, b)
        XCTAssertTrue(a.contains("America/New_York"))
        XCTAssertTrue(b.contains("Asia/Tokyo"))
        // Same pauseUntil + same time zone → same signature (idempotent re-apply).
        XCTAssertEqual(a, ScreenTimeEnforcer.pauseSignature(pauseUntil: "2026-09-28T20:00:00Z", timeZone: ny))
    }
}
