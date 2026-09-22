import XCTest
@testable import FamETC

final class FamilyAssistanceSnapshotTests: XCTestCase {
    private enum Failure: Error { case unavailable }

    func testBuilderRequiresCurrentParentMembership() {
        let kidUser = User(id: "u-kid", email: "", name: "A", role: "kid", kidId: "k1")
        XCTAssertNil(FamilyAssistanceSnapshotBuilder.build(input: input(user: kidUser)))

        let outsider = User(id: "u-other", email: "x@example.com", name: "Other", role: "parent")
        XCTAssertNil(FamilyAssistanceSnapshotBuilder.build(input: input(user: outsider)))
    }

    func testSnapshotUsesRealRowsAndMarksFailedSourcesUnavailable() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-16T02:00:00Z"))
        let event = CalendarEvent(uid: "e1", title: "  Swim   practice  ",
            start: "2026-09-16T09:30:00Z", end: nil, allDay: false, location: "Private",
            feedLabel: "School", kidId: "k1", isDeadline: false, type: "event")
        let homework = HomeworkItem(id: "h1", kidId: "k1", title: "Math review",
            subject: "Math", dueDate: "2026-09-16", dueTime: nil, status: "todo",
            effortMin: 20, notes: "Private teacher note")
        var value = input()
        value = FamilyAssistanceBuildInput(user: value.user, family: value.family,
            schoolEvents: .success([event]), familyEvents: .failure(Failure.unavailable),
            homework: .success([homework]),
            dailyFive: ["k1": .success(FamilyChildInsightSnapshot(
                dailyFive: FamilyDailyFiveProgress(completed: 2, started: 1, total: 5),
                expectedHomeTime: "4:30 PM"))])

        let snapshot = try XCTUnwrap(FamilyAssistanceSnapshotBuilder.build(input: value, now: now,
            calendar: Calendar(identifier: .gregorian)))
        let child = try XCTUnwrap(snapshot.children.first)
        XCTAssertFalse(child.calendarAvailable)
        XCTAssertNil(child.nextActivity)
        XCTAssertTrue(child.todayActivities.isEmpty)
        XCTAssertTrue(child.homeworkAvailable)
        XCTAssertEqual(child.todayHomework.map(\.title), ["Math review"])
        XCTAssertEqual(child.dailyFive?.completed, 2)
        XCTAssertEqual(child.expectedHomeTime, "4:30 PM")

        let json = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)
        XCTAssertFalse(json.contains("Private teacher note"))
        XCTAssertFalse(json.contains("Private"))
        XCTAssertFalse(json.contains("INVITE"))
        XCTAssertFalse(json.contains("example.com"))
    }

    func testUnknownDataNeverBecomesAnEmptyCompleteDay() throws {
        let value = FamilyAssistanceBuildInput(user: parent, family: family,
            schoolEvents: .failure(Failure.unavailable), familyEvents: .failure(Failure.unavailable),
            homework: .failure(Failure.unavailable), dailyFive: [:])
        let child = try XCTUnwrap(FamilyAssistanceSnapshotBuilder.build(input: value)?.children.first)
        XCTAssertFalse(child.calendarAvailable)
        XCTAssertFalse(child.homeworkAvailable)
        XCTAssertFalse(child.dailyFiveAvailable)
        XCTAssertNil(child.nextActivity)
        XCTAssertTrue(child.todayHomework.isEmpty)
    }

    func testProtectedFileStoreRoundTripsClearsAndExpires() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("family-assistance-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("snapshot")
        let now = Date(timeIntervalSince1970: 1_000)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let snapshot = FamilyAssistanceSnapshot(accountID: "u-parent", familyID: "f1",
            generatedAt: now, expiresAt: now.addingTimeInterval(FamilyAssistanceSnapshot.maximumAge),
            dayKey: "1970-01-01", timeZoneIdentifier: calendar.timeZone.identifier,
            children: [])

        FamilyAssistanceSnapshotStore.save(snapshot, url: url)
        XCTAssertEqual(FamilyAssistanceSnapshotStore.load(url: url), snapshot)
        XCTAssertTrue(snapshot.isFresh(at: now.addingTimeInterval(60), calendar: calendar))
        XCTAssertFalse(snapshot.isFresh(at: now.addingTimeInterval(FamilyAssistanceSnapshot.maximumAge + 1), calendar: calendar))
        FamilyAssistanceSnapshotStore.clear(url: url)
        XCTAssertNil(FamilyAssistanceSnapshotStore.load(url: url))
    }

    func testSnapshotExpiresAtDayAndTimeZoneBoundary() throws {
        var bangkok = Calendar(identifier: .gregorian)
        bangkok.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Bangkok"))
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-16T16:50:00Z")) // 23:50 local
        let snapshot = try XCTUnwrap(FamilyAssistanceSnapshotBuilder.build(input: input(), now: now, calendar: bangkok))
        XCTAssertEqual(snapshot.dayKey, "2026-09-16")
        XCTAssertEqual(snapshot.expiresAt, try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-16T17:00:00Z")))
        XCTAssertFalse(snapshot.isFresh(at: snapshot.expiresAt, calendar: bangkok))

        var utc = bangkok
        utc.timeZone = TimeZone(secondsFromGMT: 0)!
        XCTAssertFalse(snapshot.isFresh(at: now, calendar: utc))
    }

    func testTimestampUsesFamilyLocalDayAndAcceptsFractionalISO() throws {
        var bangkok = Calendar(identifier: .gregorian)
        bangkok.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Bangkok"))
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-16T16:00:00Z"))
        let event = CalendarEvent(uid: "late", title: "Late activity",
            start: "2026-09-16T18:30:00.123Z", end: nil, allDay: false,
            location: nil, feedLabel: nil, kidId: "k1", isDeadline: false, type: "event")
        let base = input()
        let value = FamilyAssistanceBuildInput(user: base.user, family: base.family,
            schoolEvents: .success([event]), familyEvents: .success([]), homework: .success([]), dailyFive: [:])
        let child = try XCTUnwrap(FamilyAssistanceSnapshotBuilder.build(input: value, now: now, calendar: bangkok)?.children.first)
        XCTAssertEqual(child.nextActivity?.dateKey, "2026-09-17")
        XCTAssertEqual(child.tomorrowActivities.first?.title, "Late activity")
    }

    func testDailyThreeCountsOnlyItsPartsAndSelectsTheScheduledChallenge() throws {
        for (date, expected) in [("2026-09-22", "completed"), ("2026-09-23", "started")] {
            let json = "{\"daily5\":{\"date\":\"\(date)\",\"parts\":{\"news\":{\"status\":\"completed\"},\"word\":{\"status\":\"started\"},\"puzzle\":{\"status\":\"started\"},\"bt\":{\"status\":\"completed\"}}}}"
            let progress = try DailyFiveSnapshotDecoder.decode(Data(json.utf8), expectedDate: date)
            XCTAssertEqual(progress.daily3Completed, 1)
            XCTAssertEqual(progress.scheduledChallengeStatus, expected)
        }
    }

    func testDailyFiveRejectsUnknownStatusKeyDateAndMissingParts() throws {
        let valid = Data(#"{"daily5":{"date":"2026-09-16","parts":{"word":{"status":"completed"},"bt":{"status":"started"}}}}"#.utf8)
        let progress = try DailyFiveSnapshotDecoder.decode(valid, expectedDate: "2026-09-16")
        XCTAssertEqual(progress.completed, 1)
        XCTAssertEqual(progress.started, 1)
        XCTAssertEqual(progress.total, 5)

        let unknownKey = Data(#"{"daily5":{"date":"2026-09-16","parts":{"mystery":{"status":"completed"}}}}"#.utf8)
        XCTAssertThrowsError(try DailyFiveSnapshotDecoder.decode(unknownKey, expectedDate: "2026-09-16"))
        let unknownStatus = Data(#"{"daily5":{"date":"2026-09-16","parts":{"word":{"status":"done"}}}}"#.utf8)
        XCTAssertThrowsError(try DailyFiveSnapshotDecoder.decode(unknownStatus, expectedDate: "2026-09-16"))
        let missingParts = Data(#"{"daily5":{"date":"2026-09-16"}}"#.utf8)
        XCTAssertThrowsError(try DailyFiveSnapshotDecoder.decode(missingParts, expectedDate: "2026-09-16"))
        XCTAssertThrowsError(try DailyFiveSnapshotDecoder.decode(valid, expectedDate: "2026-09-17"))
    }

    func testInsightsUseOnlyExplicitTodayHomePlan() throws {
        let planned = Data(#"{"homePlan":{"date":"2026-09-16","homeTime":"16:30"},"daily5":{"date":"2026-09-16","parts":{}}}"#.utf8)
        let insight = try DailyFiveSnapshotDecoder.decodeInsights(planned, expectedDate: "2026-09-16")
        XCTAssertNotNil(insight.expectedHomeTime)

        let wrongDay = Data(#"{"homePlan":{"date":"2026-09-17","homeTime":"16:30"},"daily5":{"date":"2026-09-16","parts":{}}}"#.utf8)
        XCTAssertThrowsError(try DailyFiveSnapshotDecoder.decodeInsights(wrongDay, expectedDate: "2026-09-16"))
        let malformed = Data(#"{"homePlan":{"date":"2026-09-16","homeTime":"after activities"},"daily5":{"date":"2026-09-16","parts":{}}}"#.utf8)
        XCTAssertThrowsError(try DailyFiveSnapshotDecoder.decodeInsights(malformed, expectedDate: "2026-09-16"))
    }

    func testSiriAuthorizationRejectsChildRemovedFromLiveFamily() throws {
        let snapshot = try XCTUnwrap(FamilyAssistanceSnapshotBuilder.build(input: input()))
        var liveFamily = family
        liveFamily.kids = []
        XCTAssertFalse(SiriFamilyAuthorization.isAuthorized(user: parent, families: [liveFamily],
            snapshot: snapshot, childID: "k1"))
        XCTAssertTrue(SiriFamilyAuthorization.isAuthorized(user: parent, families: [family],
            snapshot: snapshot, childID: "k1"))
    }

    func testFourthItemIsCountedRatherThanSilentlyPresentedAsCompleteList() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-16T01:00:00Z"))
        let events = (1...4).map { index in
            CalendarEvent(uid: "e\(index)", title: "Activity \(index)",
                start: "2026-09-16T1\(index):00:00Z", end: nil, allDay: false,
                location: nil, feedLabel: nil, kidId: "k1", isDeadline: false, type: "event")
        }
        let base = input()
        let value = FamilyAssistanceBuildInput(user: base.user, family: base.family,
            schoolEvents: .success(events), familyEvents: .success([]), homework: .success([]), dailyFive: [:])
        let child = try XCTUnwrap(FamilyAssistanceSnapshotBuilder.build(input: value, now: now, calendar: calendar)?.children.first)
        XCTAssertEqual(child.todayActivities.count, 3)
        XCTAssertEqual(child.todayActivityCount, 4)
    }

    func testOverdueHomeworkIsNotLabeledDueToday() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-16T01:00:00Z"))
        let overdue = HomeworkItem(id: "late", kidId: "k1", title: "History notes",
            subject: nil, dueDate: "2026-09-15", dueTime: nil, status: "todo", effortMin: nil)
        let base = input()
        let value = FamilyAssistanceBuildInput(user: base.user, family: base.family,
            schoolEvents: .success([]), familyEvents: .success([]), homework: .success([overdue]), dailyFive: [:])
        let snapshot = try XCTUnwrap(FamilyAssistanceSnapshotBuilder.build(input: value, now: now, calendar: calendar))
        let child = try XCTUnwrap(snapshot.children.first)
        XCTAssertEqual(FamilyAssistancePresentation.homeworkText(child, dayKey: snapshot.dayKey),
            "History notes · overdue")
    }

    func testDueTodayHomeworkPrecedesLargeOverdueBacklog() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-16T01:00:00Z"))
        let overdue = (11...14).map { day in
            HomeworkItem(id: "late-\(day)", kidId: "k1", title: "Overdue \(day)",
                subject: nil, dueDate: "2026-09-\(day)", dueTime: nil, status: "todo", effortMin: nil)
        }
        let today = HomeworkItem(id: "today", kidId: "k1", title: "Due today",
            subject: nil, dueDate: "2026-09-16", dueTime: "09:00", status: "todo", effortMin: nil)
        let base = input()
        let value = FamilyAssistanceBuildInput(user: base.user, family: base.family,
            schoolEvents: .success([]), familyEvents: .success([]),
            homework: .success(overdue + [today]), dailyFive: [:])
        let child = try XCTUnwrap(FamilyAssistanceSnapshotBuilder.build(input: value,
            now: now, calendar: calendar)?.children.first)

        XCTAssertEqual(child.todayHomeworkCount, 5)
        XCTAssertEqual(child.todayHomework.count, 3)
        XCTAssertEqual(child.todayHomework.first?.id, "homework:today")
        XCTAssertEqual(child.todayHomework.dropFirst().map(\.dateKey), ["2026-09-14", "2026-09-13"])
    }

    private var parent: User {
        User(id: "u-parent", email: "parent@example.com", name: "Parent", role: "parent")
    }

    private var family: Family {
        Family(id: "f1", name: "Family", inviteCode: "INVITE", parentIds: ["u-parent"],
            kids: [Kid(id: "k1", name: "Mina", grade: "6", color: "#6F43D6",
                createdAt: "2026-01-01T00:00:00Z")], createdAt: "2026-01-01T00:00:00Z")
    }

    private func input(user: User? = nil) -> FamilyAssistanceBuildInput {
        FamilyAssistanceBuildInput(user: user ?? parent, family: family,
            schoolEvents: .success([]), familyEvents: .success([]), homework: .success([]),
            dailyFive: [:])
    }
}
