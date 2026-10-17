import XCTest
@testable import FamETC

/// Pure parts of the soft layout (docs/design/soft-rings/IOS-BRIEF.md §3):
/// the event activity mapping and the Today week strip.
final class SoftLayoutTests: XCTestCase {
    func testEventArtMatchesSpecificActivitiesBeforeGenericOnes() {
        XCTAssertEqual(EventArt.activity(title: "Football training").key, "football")
        XCTAssertEqual(EventArt.activity(title: "Swim squad training").key, "swimming")
        XCTAssertEqual(EventArt.activity(title: "Piano lesson").key, "music")
        XCTAssertEqual(EventArt.activity(title: "Netball match").key, "basketball")
        XCTAssertEqual(EventArt.activity(title: "PE kit day").key, "sport")
        XCTAssertEqual(EventArt.activity(title: "Year 5 assembly").key, "school")
        XCTAssertEqual(EventArt.activity(title: "Dentist check-up").key, "doctor")
    }

    func testEventArtMatchesWholeWordsUsesTheFeedLabelAndFallsBack() {
        XCTAssertEqual(EventArt.activity(title: "Family brunch").key, "food")
        XCTAssertEqual(EventArt.activity(title: "Grandma visiting").key, EventArt.fallback.key)
        XCTAssertEqual(EventArt.activity(title: "Gala", subtitle: "Swimming").key, "swimming")
        XCTAssertEqual(EventArt.assetName(for: EventArt.activity(title: "Piano")), "EventArt-music")
    }

    func testWeekStripCoversMondayToSundayWithOneDotPerOwner() throws {
        let kids = try JSONDecoder().decode([Kid].self, from: Data("""
        [{"id":"k1","name":"Mia","grade":"5","color":"#0EA58C","createdAt":"2026-01-01"},
         {"id":"k2","name":"Leo","grade":"8","color":"#D99A00","createdAt":"2026-01-01"}]
        """.utf8))
        let events = try JSONDecoder().decode([FamilyEvent].self, from: Data("""
        [{"id":"a","title":"Football training","date":"2026-10-21","time":"16:30","kidId":"k2"},
         {"id":"b","title":"Football match","date":"2026-10-21","time":"18:00","kidId":"k2"},
         {"id":"c","title":"Piano lesson","date":"2026-10-21","time":"17:00","kidId":"k1"},
         {"id":"d","title":"Swim gala","date":"2026-10-24","kidId":"k2"},
         {"id":"e","title":"Family dinner","date":"2026-10-21","time":"19:00"}]
        """.utf8))
        let wednesday = try XCTUnwrap(DateFmt.ymd.date(from: "2026-10-21"))

        let days = WeekStripData.days(containing: wednesday, events: [], familyEvents: events, kids: kids)
        XCTAssertEqual(days.map(\.key), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22",
                                         "2026-10-23", "2026-10-24", "2026-10-25"])
        let wed = try XCTUnwrap(days.first { $0.key == "2026-10-21" })
        XCTAssertEqual(wed.day, "21")
        XCTAssertEqual(wed.eventCount, 4)
        XCTAssertEqual(wed.dots.count, 3, "Leo's two events collapse into one dot")

        let mia = WeekStripData.days(containing: wednesday, events: [], familyEvents: events, kids: kids, kidID: "k1")
        XCTAssertEqual(mia.first { $0.key == "2026-10-21" }?.eventCount, 2, "Mia sees her own and family events")
        XCTAssertEqual(mia.first { $0.key == "2026-10-24" }?.eventCount, 0)
    }
}
