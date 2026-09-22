import XCTest
@testable import FamETC

final class FamilyAssistTests: XCTestCase {
    func testSchoolNoticeWithUnknownDateDoesNotDefaultToToday() {
        let draft = SchoolNoticeExtractor.draft(from: "Year 6 museum visit\nBring: hat and water")

        XCTAssertEqual(draft.title, "Year 6 museum visit")
        XCTAssertNil(draft.date)
        XCTAssertEqual(draft.thingsToBring, "hat and water")
        XCTAssertFalse(draft.canSave)
    }

    func testTimeOnlyNoticeDoesNotCreateATodayDate() throws {
        let draft = SchoolNoticeExtractor.draft(from: "Music rehearsal\nTime: 3:30 PM")

        XCTAssertNil(draft.date)
        XCTAssertEqual(Calendar.current.component(.hour, from: try XCTUnwrap(draft.time)), 15)
        XCTAssertEqual(Calendar.current.component(.minute, from: try XCTUnwrap(draft.time)), 30)
    }

    func testDateWithoutYearRemainsUnresolved() {
        let draft = SchoolNoticeExtractor.draft(from: "Sports day\nDate: September 21")
        XCTAssertNil(draft.date)
    }

    func testConflictingFullDatesRemainUnresolved() {
        let draft = SchoolNoticeExtractor.draft(
            from: "Camp briefing\nSeptember 21, 2026\nUpdated: September 22, 2026"
        )
        XCTAssertNil(draft.date)
    }

    func testConflictingTimesRemainUnresolved() {
        let draft = SchoolNoticeExtractor.draft(from: "Meet at 3:30 PM or 4:00 PM")
        XCTAssertNil(draft.time)
    }

    func testTwelveHourTimeDoesNotAlsoMatchMinuteSuffix() throws {
        let draft = SchoolNoticeExtractor.draft(from: "Meet at 3:05 PM")
        let time = try XCTUnwrap(draft.time)
        XCTAssertEqual(Calendar.current.component(.hour, from: time), 15)
        XCTAssertEqual(Calendar.current.component(.minute, from: time), 5)
    }

    func testSchoolNoticeReviewRequiresTitleAndDate() {
        var draft = SchoolNoticeDraft()
        draft.date = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertFalse(draft.canSave)

        draft.title = "  Sports day  "
        XCTAssertTrue(draft.canSave)
    }

    func testThingsToBringArePreservedInCanonicalEventNotes() {
        var draft = SchoolNoticeDraft()
        draft.notes = "Meet by the primary office."
        draft.thingsToBring = "Hat, water bottle"

        XCTAssertEqual(draft.combinedNotes, "Meet by the primary office.\n\nThings to bring: Hat, water bottle")
    }

    func testHomeworkStartingPlanIsBoundedAndDoesNotCompleteWork() {
        let assignment = homework(
            title: "Volcano poster",
            subject: "Science",
            notes: "Compare shield and composite volcanoes. Include two labelled diagrams."
        )

        let plan = HomeworkStartPlan.make(for: assignment)

        XCTAssertEqual(plan.steps.count, 3)
        XCTAssertLessThanOrEqual(plan.hints.count, 4)
        XCTAssertTrue(plan.steps.allSatisfy { !$0.isEmpty })
        XCTAssertFalse(plan.steps.joined(separator: " ").localizedCaseInsensitiveContains("assignment is complete"))
    }

    func testFamilyHelpRequestNamesTheStuckStepAndAsksForNoAnswer() {
        var assignment = homework(title: "Fractions worksheet")
        assignment.checklist = [HomeworkChecklistItem(text: "Try question 1", done: false)]

        let message = HomeworkStartPlan.familyHelpMessage(for: assignment)

        XCTAssertTrue(message.contains("Fractions worksheet"))
        XCTAssertTrue(message.contains("Try question 1"))
        XCTAssertTrue(message.localizedCaseInsensitiveContains("without giving me the answer"))
    }

    private func homework(title: String, subject: String? = nil, notes: String? = nil) -> HomeworkItem {
        HomeworkItem(id: "hw-1", kidId: "kid-1", title: title, subject: subject,
                     dueDate: "2026-09-22", dueTime: nil, status: "todo", effortMin: 30,
                     notes: notes, checklist: nil)
    }
}
