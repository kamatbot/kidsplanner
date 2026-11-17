import XCTest
@testable import FamETC

final class TodayCalmCopyTests: XCTestCase {
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

    func testGreetingTimeBoundaries() {
        let morning = TodayCalmCopy.calmToday(now: dateAt(hour: 11, minute: 59), needsYouCount: 1)
        XCTAssertEqual(morning.greeting, "Good morning")

        let afternoon = TodayCalmCopy.calmToday(now: dateAt(hour: 12, minute: 0), needsYouCount: 1)
        XCTAssertEqual(afternoon.greeting, "Good afternoon")

        let lateAfternoon = TodayCalmCopy.calmToday(now: dateAt(hour: 16, minute: 59), needsYouCount: 1)
        XCTAssertEqual(lateAfternoon.greeting, "Good afternoon")

        let evening = TodayCalmCopy.calmToday(now: dateAt(hour: 17, minute: 0), needsYouCount: 1)
        XCTAssertEqual(evening.greeting, "Good evening")

        let earlyMorning = TodayCalmCopy.calmToday(now: dateAt(hour: 2, minute: 30), needsYouCount: 1)
        XCTAssertEqual(earlyMorning.greeting, "Good morning")
    }

    func testCalmLineBoundariesForEmptyNeedsYou() {
        let before17 = TodayCalmCopy.calmToday(now: dateAt(hour: 16, minute: 59), needsYouCount: 0)
        XCTAssertEqual(before17.calmLine, "Nothing needs you right now.")

        let at17 = TodayCalmCopy.calmToday(now: dateAt(hour: 17, minute: 0), needsYouCount: 0)
        XCTAssertEqual(at17.calmLine, "Nothing needs you. Enjoy dinner.")

        let lateEvening = TodayCalmCopy.calmToday(now: dateAt(hour: 21, minute: 0), needsYouCount: 0)
        XCTAssertEqual(lateEvening.calmLine, "Nothing needs you. Enjoy dinner.")
    }

    func testCalmLineNilWhenNeedsYouNonEmpty() {
        let withOne = TodayCalmCopy.calmToday(now: dateAt(hour: 10, minute: 0), needsYouCount: 1)
        XCTAssertNil(withOne.calmLine)

        let withMany = TodayCalmCopy.calmToday(now: dateAt(hour: 18, minute: 30), needsYouCount: 5)
        XCTAssertNil(withMany.calmLine)
    }

    func testTomorrowLineBoundary() {
        let items = [TomorrowItem(title: "Swimming"), TomorrowItem(title: "Math homework")]

        let before20 = TodayCalmCopy.calmToday(now: dateAt(hour: 19, minute: 59), needsYouCount: 0, tomorrowItems: items)
        XCTAssertNil(before20.tomorrowLine)

        let at20 = TodayCalmCopy.calmToday(now: dateAt(hour: 20, minute: 0), needsYouCount: 0, tomorrowItems: items)
        XCTAssertEqual(at20.tomorrowLine, "Tomorrow: Swimming · Math homework")
    }

    func testTomorrowPreviewCappingAtTwoAndOrderingByTime() {
        let items = [
            TomorrowItem(title: "Dinner party", time: "18:30"),
            TomorrowItem(title: "School drop-off", time: "08:15"),
            TomorrowItem(title: "Piano lesson", time: "15:00")
        ]

        let result = TodayCalmCopy.calmToday(now: dateAt(hour: 20, minute: 30), needsYouCount: 0, tomorrowItems: items)
        XCTAssertEqual(result.tomorrowLine, "Tomorrow: School drop-off · Piano lesson")
    }

    func testTomorrowLineHandlesSingleItemAndEmpty() {
        let single = TodayCalmCopy.calmToday(now: dateAt(hour: 20, minute: 15), needsYouCount: 0, tomorrowItems: [TomorrowItem(title: "Pack swim bag")])
        XCTAssertEqual(single.tomorrowLine, "Tomorrow: Pack swim bag")

        let empty = TodayCalmCopy.calmToday(now: dateAt(hour: 20, minute: 15), needsYouCount: 0, tomorrowItems: [])
        XCTAssertNil(empty.tomorrowLine)

        let missing = TodayCalmCopy.calmToday(now: dateAt(hour: 20, minute: 15), needsYouCount: 0)
        XCTAssertNil(missing.tomorrowLine)
    }
}
