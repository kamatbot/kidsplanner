import XCTest
@testable import FamETCWatch

final class WatchComplicationTests: XCTestCase {
    func testSnapshotClampsCountsAndRoundTrips() throws {
        let snapshot = FamETCWatchComplicationSnapshot(
            urgentCount: -1,
            homeworkCount: 2,
            shoppingCount: 3,
            focusActive: true,
            focusEndsAt: Date(timeIntervalSince1970: 1_000)
        )
        XCTAssertEqual(snapshot.urgentCount, 0)
        XCTAssertEqual(snapshot.homeworkCount, 2)
        XCTAssertEqual(snapshot.shoppingCount, 3)
        XCTAssertTrue(snapshot.focusActive)
        XCTAssertEqual(snapshot.focusEndsAt, Date(timeIntervalSince1970: 1_000))
        let decoded = try JSONDecoder().decode(
            FamETCWatchComplicationSnapshot.self,
            from: JSONEncoder().encode(snapshot)
        )
        XCTAssertEqual(decoded, snapshot)
    }

    func testOriginalAggregateJSONDecodesWithInactiveFocusDefaults() throws {
        let data = Data("{\"urgentCount\":2,\"homeworkCount\":1,\"shoppingCount\":4,\"updatedAt\":null}".utf8)
        let snapshot = try JSONDecoder().decode(FamETCWatchComplicationSnapshot.self, from: data)

        XCTAssertEqual(snapshot.urgentCount, 2)
        XCTAssertEqual(snapshot.homeworkCount, 1)
        XCTAssertEqual(snapshot.shoppingCount, 4)
        XCTAssertFalse(snapshot.focusActive)
        XCTAssertNil(snapshot.focusEndsAt)
    }

    func testAppGroupStoreKeepsOnlyTheLatestAggregate() {
        let suiteName = "fametc.watch.complication.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let snapshot = FamETCWatchComplicationSnapshot(urgentCount: 2, homeworkCount: 1, shoppingCount: 4)
        WatchComplicationSnapshotStore.save(snapshot, defaults: defaults)
        XCTAssertEqual(WatchComplicationSnapshotStore.load(defaults: defaults), snapshot)
    }
}
