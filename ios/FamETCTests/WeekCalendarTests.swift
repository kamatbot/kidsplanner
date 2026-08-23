import XCTest
@testable import FamETC

final class WeekCalendarTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    func testWeekStartsOnLocalMondayAndContainsSevenDates() {
        let date = calendar.date(from: DateComponents(year: 2026, month: 8, day: 26, hour: 15))!
        let monday = WeekCalendarMath.monday(containing: date, calendar: calendar)
        let dates = WeekCalendarMath.weekDates(startingAt: monday, calendar: calendar)

        XCTAssertEqual(calendar.component(.weekday, from: monday), 2)
        XCTAssertEqual(calendar.dateComponents([.year, .month, .day], from: monday),
                       DateComponents(year: 2026, month: 8, day: 24))
        XCTAssertEqual(dates.count, 7)
        XCTAssertEqual(calendar.component(.day, from: dates.last!), 30)
    }

    func testContainerLandscapeAlwaysResolvesToWeekWhilePortraitRetainsChoice() {
        XCTAssertTrue(CalendarMode.isLandscape(width: 1194, height: 834))
        XCTAssertFalse(CalendarMode.isLandscape(width: 834, height: 1194))
        XCTAssertEqual(CalendarMode.month.resolved(isLandscape: CalendarMode.isLandscape(width: 1194, height: 834)), .week)
        XCTAssertEqual(CalendarMode.month.resolved(isLandscape: CalendarMode.isLandscape(width: 834, height: 1194)), .month)
        XCTAssertEqual(CalendarMode.week.resolved(isLandscape: false), .week)
    }

    func testWeekTimelineInitialHourIsEightAM() {
        XCTAssertEqual(WeekCalendarMath.initialHour, 8)
    }

    func testMinuteOffsetRoundTripsAndSnapsToHalfHour() {
        let hourHeight: CGFloat = 60
        let minute = WeekCalendarMath.minute(for: 10.27 * hourHeight, hourHeight: hourHeight)

        XCTAssertEqual(minute, 630)
        XCTAssertEqual(WeekCalendarMath.offset(for: minute, hourHeight: hourHeight), 630)
        XCTAssertEqual(WeekCalendarMath.timeString(for: minute), "10:30")
    }

    func testOverlappingEventsGetDeterministicSideBySideColumns() {
        let placements = WeekCalendarMath.placements(for: [
            WeekTimedInterval(id: "a", startMinute: 9 * 60, endMinute: 11 * 60),
            WeekTimedInterval(id: "b", startMinute: 10 * 60, endMinute: 12 * 60),
            WeekTimedInterval(id: "c", startMinute: 11 * 60, endMinute: 12 * 60),
            WeekTimedInterval(id: "d", startMinute: 13 * 60, endMinute: 14 * 60),
        ])

        XCTAssertEqual(placements["a"], WeekEventPlacement(column: 0, columnCount: 2))
        XCTAssertEqual(placements["b"], WeekEventPlacement(column: 1, columnCount: 2))
        XCTAssertEqual(placements["c"], WeekEventPlacement(column: 0, columnCount: 2))
        XCTAssertEqual(placements["d"], WeekEventPlacement(column: 0, columnCount: 1))
    }

    func testSelectedSlotUsesDisplayedDateAndSnappedLocalTime() {
        let wednesday = calendar.date(from: DateComponents(year: 2026, month: 8, day: 26, hour: 0))!
        let slot = WeekCalendarMath.selectedSlot(
            date: wednesday,
            offset: 16.08 * 60,
            hourHeight: 60,
            calendar: calendar
        )

        XCTAssertEqual(slot.minute, 960)
        XCTAssertEqual(calendar.dateComponents([.year, .month, .day, .hour, .minute], from: slot.date),
                       DateComponents(year: 2026, month: 8, day: 26, hour: 16, minute: 0))
        XCTAssertEqual(WeekCalendarMath.timeString(for: slot.minute), "16:00")
    }
}
