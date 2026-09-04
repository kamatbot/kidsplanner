import XCTest
@testable import FamETC

/// Smoke tests for the non-domain plumbing: Config's base URL and the client
/// header contract the server's iOS free-tier gate relies on.
final class LogicTests: XCTestCase {

    override func setUp() {
        super.setUp()
        _ = NotificationHandler.shared.consumePendingChatRoomId()
    }

    func testBaseURLHasFamETCHost() {
        let url = Config.baseURL
        XCTAssertNotNil(url)
        XCTAssertTrue(url.host == "www.fametc.com" || url.host == "fametc.com", "unexpected host: \(url.host ?? "nil")")
        XCTAssertEqual(url.scheme, "https")
    }

    func testAllowedHostsIncludeApexAndWWW() {
        XCTAssertTrue(Config.isAllowed(host: "www.fametc.com"))
        XCTAssertTrue(Config.isAllowed(host: "fametc.com"))
        XCTAssertFalse(Config.isAllowed(host: "evil.com"))
    }

    func testClientHeadersUseFamETCPrefix() {
        let headers = Config.clientHeaders
        XCTAssertEqual(headers["X-FamETC-Client"], "ios")
    }

    func testBridgeNameIsFam() {
        XCTAssertEqual(Config.bridgeName, "fam")
    }

    func testChatTextDetectsSafeLinksAndPreservesMessageText() {
        let text = "Details: https://example.com/trip?q=1 and family@example.com"
        let attributed = ChatLinkText.attributed(text)
        let links = attributed.runs.compactMap(\.link)

        XCTAssertEqual(String(attributed.characters), text)
        XCTAssertEqual(links.map(\.absoluteString), [
            "https://example.com/trip?q=1",
            "mailto:family@example.com",
        ])
    }

    func testChatTextDoesNotCreateLinksForUnsafeSchemes() {
        let attributed = ChatLinkText.attributed("javascript:alert(1) is not a link")
        XCTAssertTrue(attributed.runs.compactMap(\.link).isEmpty)
    }

    func testFamilyChatNotificationQueuesFamilyRoomForColdLaunch() {
        NotificationHandler.shared.handle(userInfo: [
            "famType": "chat_message",
            "familyId": "fam_1",
        ])

        XCTAssertEqual(NotificationHandler.shared.consumePendingChatRoomId(), familyRoomId)
        XCTAssertNil(NotificationHandler.shared.consumePendingChatRoomId(), "route must be one-shot")
    }

    func testTripChatNotificationQueuesExactTripRoomForColdLaunch() {
        NotificationHandler.shared.handle(userInfo: [
            "famType": "trip_chat_message",
            "tripId": "trip_42",
        ])

        XCTAssertEqual(NotificationHandler.shared.consumePendingChatRoomId(), "trip:trip_42")
        XCTAssertNil(NotificationHandler.shared.consumePendingChatRoomId(), "route must be one-shot")
    }

    func testFamilyBuzzNotificationQueuesFamilyRoomForColdLaunch() {
        NotificationHandler.shared.handle(userInfo: [
            "famType": "chat_buzz",
            "familyId": "fam_buzz",
        ])

        XCTAssertEqual(NotificationHandler.shared.consumePendingChatRoomId(), familyRoomId)
        XCTAssertNil(NotificationHandler.shared.consumePendingChatRoomId(), "route must be one-shot")
    }

    func testTripBuzzNotificationQueuesExactTripRoomForColdLaunch() {
        NotificationHandler.shared.handle(userInfo: [
            "famType": "trip_chat_buzz",
            "tripId": "trip_buzz_42",
        ])

        XCTAssertEqual(NotificationHandler.shared.consumePendingChatRoomId(), "trip:trip_buzz_42")
        XCTAssertNil(NotificationHandler.shared.consumePendingChatRoomId(), "route must be one-shot")
    }

    func testParentCalendarAudiencesKeepTimetablesOutOfParentsAndIsolateChildren() {
        let data = calendarFixture()

        let parents = CalendarDisplayData.resolve(
            audience: .parents,
            isParent: true,
            events: data.events,
            familyEvents: data.familyEvents,
            homework: data.homework,
            kidScope: nil
        )
        XCTAssertEqual(Set(parents.events.map(\.id)), Set(["shared-feed", "ryshi-feed", "arya-feed"]))
        XCTAssertEqual(Set(parents.familyEvents.map(\.id)), Set(["shared-family", "ryshi-regular"]))
        XCTAssertEqual(Set(parents.homework.map(\.id)), Set(["shared-homework", "ryshi-homework", "arya-homework"]))

        let ryshi = CalendarDisplayData.resolve(
            audience: .kid("ryshi"),
            isParent: true,
            events: data.events,
            familyEvents: data.familyEvents,
            homework: data.homework,
            kidScope: nil
        )
        XCTAssertEqual(Set(ryshi.events.map(\.id)), Set(["shared-feed", "ryshi-feed", "ryshi-timetable-feed"]))
        XCTAssertEqual(Set(ryshi.familyEvents.map(\.id)), Set(["shared-family", "ryshi-regular", "ryshi-timetable"]))
        XCTAssertEqual(Set(ryshi.homework.map(\.id)), Set(["shared-homework", "ryshi-homework"]))
    }

    func testTimetableAudienceContainsOnlyCanonicalImportedLessons() {
        let data = calendarFixture()
        let timetable = CalendarDisplayData.resolve(
            audience: .timetable,
            isParent: true,
            events: data.events,
            familyEvents: data.familyEvents,
            homework: data.homework,
            kidScope: nil
        )

        XCTAssertEqual(Set(timetable.events.map(\.id)), Set(["ryshi-timetable-feed", "arya-timetable-feed"]))
        XCTAssertEqual(Set(timetable.familyEvents.map(\.id)), Set(["ryshi-timetable", "arya-timetable"]))
        XCTAssertTrue(timetable.homework.isEmpty)
    }

    func testTimetableAgendaKeepsEarlierLessonsFromTheCurrentWeekVisible() {
        let earlierLesson = familyEvent(id: "earlier-timetable", kidID: "arya", timetable: true)
        let sections = Agenda.upcomingSections(
            events: [],
            familyEvents: [earlierLesson],
            homework: [],
            days: 45,
            startingAt: "2026-08-10"
        )

        XCTAssertEqual(sections.map(\.day), ["2026-08-13"])
        XCTAssertEqual(sections.flatMap(\.items).map(\.title), ["earlier-timetable"])
    }

    func testLandscapeMonthGridFitsRowsAboveFloatingTabBar() {
        XCTAssertEqual(
            MonthCalendarView.compactCellHeight(availableHeight: 560, weekCount: 6),
            62
        )
        XCTAssertEqual(
            MonthCalendarView.compactCellHeight(availableHeight: 420, weekCount: 6),
            52
        )
        XCTAssertEqual(
            MonthCalendarView.compactCellHeight(availableHeight: 720, weekCount: 5),
            72
        )
    }

    func testKidSessionIgnoresParentAudienceAndKeepsSharedPlusOwnScope() {
        let data = calendarFixture()
        let visible = CalendarDisplayData.resolve(
            audience: .timetable,
            isParent: false,
            events: data.events,
            familyEvents: data.familyEvents,
            homework: data.homework.filter { $0.kidId == "arya" },
            kidScope: "arya"
        )

        XCTAssertEqual(Set(visible.events.map(\.id)), Set(["shared-feed", "arya-feed", "arya-timetable-feed"]))
        XCTAssertEqual(Set(visible.familyEvents.map(\.id)), Set(["shared-family", "arya-timetable"]))
        XCTAssertEqual(visible.homework.map(\.id), ["arya-homework"])
    }

    func testKidCalendarVisibilityFailsClosedWithoutKidScope() {
        let data = calendarFixture()
        let visible = CalendarDisplayData.resolve(
            audience: .parents,
            isParent: false,
            events: data.events,
            familyEvents: data.familyEvents,
            homework: data.homework,
            kidScope: nil
        )

        XCTAssertTrue(visible.events.isEmpty)
        XCTAssertTrue(visible.familyEvents.isEmpty)
        XCTAssertTrue(visible.homework.isEmpty)
    }

    func testReminderDefaultsAndPerOccurrenceOverrides() {
        let timetable = reminderEvent(id: "timetable", date: "2026-08-14", timetable: true, occurrenceDate: "2026-08-14")
        let eca = reminderEvent(id: "eca", date: "2026-08-14", sourceType: "eca")
        let ordinary = reminderEvent(id: "ordinary", date: "2026-08-14")
        let overrides = [
            NotificationScheduler.reminderPreferenceKey(for: timetable): true,
            NotificationScheduler.reminderPreferenceKey(for: ordinary): false,
        ]

        XCTAssertFalse(NotificationScheduler.reminderEnabled(for: timetable, overrides: [:]))
        XCTAssertTrue(NotificationScheduler.reminderEnabled(for: timetable, overrides: overrides))
        XCTAssertTrue(NotificationScheduler.reminderEnabled(for: eca, overrides: [:]))
        XCTAssertTrue(NotificationScheduler.reminderEnabled(for: ordinary, overrides: [:]))
        XCTAssertFalse(NotificationScheduler.reminderEnabled(for: ordinary, overrides: overrides))
        XCTAssertEqual(
            NotificationScheduler.reminderEligibleEvents([timetable, eca, ordinary], overrides: overrides).map(\.id),
            ["timetable", "eca"]
        )

        let nextOccurrence = reminderEvent(id: "timetable", date: "2026-08-15", timetable: true, occurrenceDate: "2026-08-15")
        XCTAssertNotEqual(
            NotificationScheduler.reminderPreferenceKey(for: timetable),
            NotificationScheduler.reminderPreferenceKey(for: nextOccurrence)
        )

        XCTAssertTrue(NotificationScheduler.homeworkReminderEligible(homeworkItem(id: "hw", kidID: "arya")))
        var done = homeworkItem(id: "done", kidID: "arya")
        done.status = "done"
        XCTAssertFalse(NotificationScheduler.homeworkReminderEligible(done))
    }

    func testReminderPreferencePersistsPerOccurrenceInUserDefaults() {
        let defaults = UserDefaults(suiteName: "FamETCTests.Reminders")!
        defaults.removePersistentDomain(forName: "FamETCTests.Reminders")
        defer { defaults.removePersistentDomain(forName: "FamETCTests.Reminders") }
        let event = reminderEvent(id: "timetable", date: "2026-08-14", timetable: true, occurrenceDate: "2026-08-14")

        XCTAssertFalse(NotificationScheduler.reminderEnabled(for: event, defaults: defaults))
        NotificationScheduler.setReminderEnabled(true, for: event, defaults: defaults)
        XCTAssertTrue(NotificationScheduler.reminderEnabled(for: event, defaults: defaults))
    }

    private func calendarFixture() -> (
        events: [CalendarEvent],
        familyEvents: [FamilyEvent],
        homework: [HomeworkItem]
    ) {
        let events = [
            calendarEvent(id: "shared-feed", kidID: nil),
            calendarEvent(id: "ryshi-feed", kidID: "ryshi"),
            calendarEvent(id: "arya-feed", kidID: "arya"),
            calendarEvent(id: "ryshi-timetable-feed", kidID: "ryshi", timetable: true),
            calendarEvent(id: "arya-timetable-feed", kidID: "arya", timetable: true),
        ]
        let familyEvents = [
            familyEvent(id: "shared-family", kidID: nil),
            familyEvent(id: "ryshi-regular", kidID: "ryshi"),
            familyEvent(id: "ryshi-timetable", kidID: "ryshi", timetable: true),
            familyEvent(id: "arya-timetable", kidID: "arya", timetable: true),
        ]
        let homework = [
            homeworkItem(id: "shared-homework", kidID: nil),
            homeworkItem(id: "ryshi-homework", kidID: "ryshi"),
            homeworkItem(id: "arya-homework", kidID: "arya"),
        ]
        return (events, familyEvents, homework)
    }

    private func calendarEvent(id: String, kidID: String?, timetable: Bool = false) -> CalendarEvent {
        CalendarEvent(
            uid: id,
            feedId: timetable ? "sta-child-timetable" : nil,
            title: id,
            start: "2026-08-13",
            end: nil,
            allDay: true,
            location: nil,
            feedLabel: "School",
            kidId: kidID,
            isDeadline: false,
            type: "event"
        )
    }

    private func familyEvent(id: String, kidID: String?, timetable: Bool = false) -> FamilyEvent {
        FamilyEvent(
            id: id,
            title: id,
            date: "2026-08-13",
            time: "09:00",
            endTime: nil,
            endDate: nil,
            notes: timetable ? "Timetable" : nil,
            category: timetable ? "school" : nil,
            kidId: kidID,
            repeatRule: "none",
            repeatUntil: nil,
            seriesId: nil,
            recurring: nil,
            occurrenceDate: nil,
            canEdit: false
        )
    }

    private func homeworkItem(id: String, kidID: String?) -> HomeworkItem {
        HomeworkItem(
            id: id,
            kidId: kidID,
            title: id,
            subject: nil,
            dueDate: "2026-08-13",
            dueTime: nil,
            status: "todo",
            effortMin: nil
        )
    }

    private func reminderEvent(
        id: String,
        date: String,
        timetable: Bool = false,
        sourceType: String? = nil,
        occurrenceDate: String? = nil
    ) -> FamilyEvent {
        FamilyEvent(
            id: id,
            title: id,
            date: date,
            time: "09:00",
            endTime: nil,
            endDate: nil,
            notes: timetable ? "Timetable" : nil,
            category: timetable ? "school" : nil,
            kidId: "arya",
            repeatRule: "none",
            repeatUntil: nil,
            seriesId: nil,
            recurring: occurrenceDate != nil,
            occurrenceDate: occurrenceDate,
            canEdit: false,
            sourceType: sourceType
        )
    }
}
