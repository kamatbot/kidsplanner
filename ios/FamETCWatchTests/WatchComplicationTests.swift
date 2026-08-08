import XCTest
@testable import FamETCWatch

final class WatchComplicationTests: XCTestCase {
    func testSnapshotClampsCountsAndRoundTrips() throws {
        let snapshot = FamETCWatchComplicationSnapshot(urgentCount: -1, homeworkCount: 2, shoppingCount: 3)
        XCTAssertEqual(snapshot.urgentCount, 0)
        XCTAssertEqual(snapshot.homeworkCount, 2)
        XCTAssertEqual(snapshot.shoppingCount, 3)
        let decoded = try JSONDecoder().decode(
            FamETCWatchComplicationSnapshot.self,
            from: JSONEncoder().encode(snapshot)
        )
        XCTAssertEqual(decoded, snapshot)
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
