import XCTest
@testable import FamETCWatch

final class WatchTomorrowTests: XCTestCase {
    private func dateAt(hour: Int, minute: Int = 0) -> Date {
        var components = DateComponents()
        components.year = 2026
        components.month = 11
        components.day = 17
        components.hour = hour
        components.minute = minute
        components.second = 0
        return Calendar.current.date(from: components)!
    }

    func testShouldShowTomorrowBoundaryAt19() {
        // At 18:59, should not show
        let before19 = dateAt(hour: 18, minute: 59)
        XCTAssertFalse(WatchTomorrowRule.shouldShowTomorrow(at: before19, hasItems: true))

        // At 19:00, should show
        let at19 = dateAt(hour: 19, minute: 0)
        XCTAssertTrue(WatchTomorrowRule.shouldShowTomorrow(at: at19, hasItems: true))

        // Later in the evening (21:30), should show
        let evening = dateAt(hour: 21, minute: 30)
        XCTAssertTrue(WatchTomorrowRule.shouldShowTomorrow(at: evening, hasItems: true))

        // Morning (08:00), should not show
        let morning = dateAt(hour: 8, minute: 0)
        XCTAssertFalse(WatchTomorrowRule.shouldShowTomorrow(at: morning, hasItems: true))
    }

    func testShouldNotShowWhenNoItems() {
        let evening = dateAt(hour: 20, minute: 0)
        XCTAssertFalse(WatchTomorrowRule.shouldShowTomorrow(at: evening, hasItems: false))
    }

    func testTomorrowLineFormatting() {
        let empty: [WatchTomorrowItem] = []
        XCTAssertNil(WatchTomorrowRule.tomorrowLine(for: empty))

        let single = [WatchTomorrowItem(title: "pack swim bag", time: "08:00")]
        XCTAssertEqual(WatchTomorrowRule.tomorrowLine(for: single), "Tomorrow: pack swim bag")

        let multiple = [
            WatchTomorrowItem(title: "pack swim bag", time: "08:00"),
            WatchTomorrowItem(title: "math worksheet", time: "09:00"),
            WatchTomorrowItem(title: "soccer practice", time: "16:00")
        ]
        XCTAssertEqual(WatchTomorrowRule.tomorrowLine(for: multiple), "Tomorrow: pack swim bag · math worksheet")
    }

    func testWatchContextDecodesOptionalTomorrow() throws {
        // Old payload without tomorrow
        let oldJson = """
        {
            "profile": {
                "role": "kid",
                "userId": "u1",
                "familyId": "f1",
                "name": "Maya"
            },
            "events": []
        }
        """
        let oldDecoded = try JSONDecoder().decode(WatchContext.self, from: Data(oldJson.utf8))
        XCTAssertNil(oldDecoded.tomorrow)

        // New payload with tomorrow
        let newJson = """
        {
            "profile": {
                "role": "kid",
                "userId": "u1",
                "familyId": "f1",
                "name": "Maya"
            },
            "events": [],
            "tomorrow": [
                { "title": "pack swim bag", "time": "08:00" }
            ]
        }
        """
        let newDecoded = try JSONDecoder().decode(WatchContext.self, from: Data(newJson.utf8))
        XCTAssertNotNil(newDecoded.tomorrow)
        XCTAssertEqual(newDecoded.tomorrow?.count, 1)
        XCTAssertEqual(newDecoded.tomorrow?.first?.title, "pack swim bag")
    }
}
