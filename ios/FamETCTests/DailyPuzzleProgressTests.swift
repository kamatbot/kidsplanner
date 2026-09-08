import XCTest
@testable import FamETC

final class DailyPuzzleProgressTests: XCTestCase {
    @MainActor
    func testFinishedReportAllowsRetryButPreservesNewerEventWithSameStatus() {
        let failed = Daily5Reporter.Event(transition: "completed|false")
        var queued = ["puzzle": failed]
        Daily5Reporter.clearFinished(failed, part: "puzzle", in: &queued)
        XCTAssertNil(queued["puzzle"])

        let reset = Daily5Reporter.Event(transition: "started|true")
        queued["puzzle"] = reset
        Daily5Reporter.clearFinished(failed, part: "puzzle", in: &queued)
        XCTAssertEqual(queued["puzzle"], reset)
        let completedAgain = Daily5Reporter.Event(transition: "completed|false")
        queued["puzzle"] = completedAgain
        Daily5Reporter.clearFinished(failed, part: "puzzle", in: &queued)
        XCTAssertEqual(queued["puzzle"], completedAgain)
        Daily5Reporter.clearFinished(completedAgain, part: "puzzle", in: &queued)
        XCTAssertNil(queued["puzzle"])
    }

    @MainActor
    func testSuccessfulResetDoesNotSuppressLaterResetAfterAnotherDeviceCompletes() {
        let firstReset = Daily5Reporter.Event(transition: "started|true")
        var queued = ["puzzle": firstReset]
        XCTAssertEqual(queued["puzzle"]?.transition, "started|true")
        Daily5Reporter.clearFinished(firstReset, part: "puzzle", in: &queued)
        XCTAssertNil(queued["puzzle"])
        let secondReset = Daily5Reporter.Event(transition: "started|true")
        queued["puzzle"] = secondReset
        Daily5Reporter.clearFinished(firstReset, part: "puzzle", in: &queued)
        XCTAssertEqual(queued["puzzle"], secondReset)
    }

    @MainActor
    func testReporterRequiresChildIdentityAndCapturesOriginalSession() {
        let store = AppStore()
        let cookie = HTTPCookie(properties: [.domain: "fametc.com", .path: "/",
            .name: "fam_sess", .value: "test-original-session", .secure: "TRUE"])!
        store.me = User(id: "parent", email: "", role: "parent")
        XCTAssertNil(Daily5Reporter.capture(store, cookies: [cookie]))
        store.me = User(id: "child", email: "", role: "kid")
        XCTAssertNil(Daily5Reporter.capture(store, cookies: [cookie]))
        store.me = User(id: "child", email: "", role: "kid", kidId: "kid-1")
        XCTAssertNil(Daily5Reporter.capture(store, cookies: []))
        let scope = Daily5Reporter.capture(store, cookies: [cookie])
        store.me = User(id: "sibling", email: "", role: "kid", kidId: "kid-2")
        XCTAssertEqual(scope?.userID, "child")
        XCTAssertEqual(scope?.cookie, "fam_sess=test-original-session")
        XCTAssertEqual(scope?.date, Agenda.todayKey())
    }

    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: "FamETCTests.DailyPuzzleProgress")!
        defaults.removePersistentDomain(forName: "FamETCTests.DailyPuzzleProgress")
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: "FamETCTests.DailyPuzzleProgress")
        defaults = nil
        super.tearDown()
    }

    func testIdentityIsStableAndIsolatedByDateTypeAndPuzzleFingerprint() {
        let first = crossword(date: "2026-08-22", clue: "A fruit")
        let same = crossword(date: "2026-08-22", clue: "A fruit")
        let differentDate = crossword(date: "2026-08-23", clue: "A fruit")
        let differentType = sudoku(date: "2026-08-22")
        let differentPuzzle = crossword(date: "2026-08-22", clue: "A color")

        XCTAssertEqual(DailyPuzzleProgressIdentity(puzzle: first).storageKey, DailyPuzzleProgressIdentity(puzzle: same).storageKey)
        XCTAssertNotEqual(DailyPuzzleProgressIdentity(puzzle: first).storageKey, DailyPuzzleProgressIdentity(puzzle: differentDate).storageKey)
        XCTAssertNotEqual(DailyPuzzleProgressIdentity(puzzle: first).storageKey, DailyPuzzleProgressIdentity(puzzle: differentType).storageKey)
        XCTAssertNotEqual(DailyPuzzleProgressIdentity(puzzle: first).storageKey, DailyPuzzleProgressIdentity(puzzle: differentPuzzle).storageKey)
    }

    func testMalformedStoredPayloadFailsClosed() {
        let puzzle = crossword()
        let identity = DailyPuzzleProgressIdentity(puzzle: puzzle)
        let keys = DailyPuzzleProgressStore.allowedKeys(for: puzzle)
        defaults.set(Data(#"{"version":1,"answers":{"c-0-0":"AB"}}"#.utf8), forKey: identity.storageKey)

        XCTAssertTrue(DailyPuzzleProgressStore.load(for: identity, allowedKeys: keys, defaults: defaults).isEmpty)
    }

    func testAccountsAndLegacyUnscopedProgressStayIsolated() {
        let puzzle = crossword()
        let keys = DailyPuzzleProgressStore.allowedKeys(for: puzzle)
        let first = DailyPuzzleProgressIdentity(puzzle: puzzle, userID: "kid/one")
        let sibling = DailyPuzzleProgressIdentity(puzzle: puzzle, userID: "kid_one")
        let unscoped = DailyPuzzleProgressIdentity(puzzle: puzzle)
        XCTAssertNotEqual(first.storageKey, sibling.storageKey)
        DailyPuzzleProgressStore.save(["c-0-0": "P"], for: first, allowedKeys: keys, defaults: defaults)
        DailyPuzzleProgressStore.save(["c-0-1": "E"], for: unscoped, allowedKeys: keys, defaults: defaults)
        XCTAssertTrue(DailyPuzzleProgressStore.load(for: sibling, allowedKeys: keys, defaults: defaults).isEmpty)
        XCTAssertEqual(DailyPuzzleProgressStore.load(for: first, allowedKeys: keys, defaults: defaults), ["c-0-0": "P"])
    }

    func testOnlySuccessfulNonemptyCheckAwardsSolvedAndClearOrEditResets() {
        let puzzle = crossword()
        let identity = DailyPuzzleProgressIdentity(puzzle: puzzle, userID: "kid-1")
        DailyPuzzleProgressStore.recordCheck(correct: 0, required: 0, for: identity, defaults: defaults)
        XCTAssertFalse(DailyPuzzleProgressStore.isSolved(for: identity, defaults: defaults))
        DailyPuzzleProgressStore.recordCheck(correct: 3, required: 4, for: identity, defaults: defaults)
        XCTAssertFalse(DailyPuzzleProgressStore.isSolved(for: identity, defaults: defaults))
        DailyPuzzleProgressStore.recordCheck(correct: 4, required: 4, for: identity, defaults: defaults)
        XCTAssertTrue(DailyPuzzleProgressStore.isSolved(for: identity, defaults: defaults))
        DailyPuzzleProgressStore.save(["c-0-0": "P"], for: identity, allowedKeys: DailyPuzzleProgressStore.allowedKeys(for: puzzle), defaults: defaults)
        XCTAssertFalse(DailyPuzzleProgressStore.isSolved(for: identity, defaults: defaults))
        DailyPuzzleProgressStore.recordCheck(correct: 4, required: 4, for: identity, defaults: defaults)
        DailyPuzzleProgressStore.clear(for: identity, defaults: defaults)
        XCTAssertFalse(DailyPuzzleProgressStore.isSolved(for: identity, defaults: defaults))
        XCTAssertNotEqual(DailyNewsSelection.ideaKey(userID: "kid-1", day: "2026-09-07"), DailyNewsSelection.ideaKey(userID: "kid-2", day: "2026-09-07"))
        XCTAssertNotEqual(DailyNewsSelection.ideaKey(userID: "kid-1", day: "2026-09-07"), DailyNewsSelection.ideaKey(userID: "kid-1", day: "2026-09-08"))
    }

    func testNewsSelectsNewestSafeRecentItemsAndRejectsStaleFutureOrInvalid() {
        let now = ISO8601DateFormatter().date(from: "2026-09-07T12:00:00Z")!
        func story(_ id: String, date: String, url: String = "https://example.org/story") -> RecentNewsItem {
            RecentNewsItem(id: id, cat: "science", headline: id, summary: "Summary", url: url, publishedAt: date, source: "Publisher", question: "What do you think?")
        }
        let items = [
            story("older", date: "2026-09-05T12:00:00Z"),
            story("stale", date: "2026-08-20T12:00:00Z"),
            story("future", date: "2026-09-07T14:00:00Z"),
            story("invalid", date: "invalid"),
            story("unsafe", date: "2026-09-07T12:00:00Z", url: "http://example.org/story"),
            story("credentials", date: "2026-09-07T12:00:00Z", url: "https://user:password@example.org/story"),
            story("newest", date: "2026-09-07T11:00:00.000Z")
        ]
        XCTAssertEqual(DailyNewsSelection.recent(items, now: now).map(\.id), ["newest", "older"])
        XCTAssertTrue(DailyNewsSelection.recent([], now: now).isEmpty)
        XCTAssertTrue(DailyNewsSelection.recent([items[1], items[2], items[3], items[4]], now: now).isEmpty)
    }

    func testNewsChoicesPreserveServerSelectionAndLeaveMissingCategoriesEmpty() {
        let now = ISO8601DateFormatter().date(from: "2026-09-07T12:00:00Z")!
        let selected = RecentNewsItem(id: "selected", cat: "science", headline: "Selected", summary: "Summary",
            url: "https://example.org/selected", publishedAt: "2026-09-06T12:00:00Z", source: "Publisher", question: "Why?")
        var newer = selected
        newer = RecentNewsItem(id: "newer", cat: "science", headline: "Newer", summary: newer.summary,
            url: "https://example.org/newer", publishedAt: "2026-09-07T11:00:00Z", source: newer.source, question: newer.question)
        let response = RecentNewsResponse(items: [newer, selected], maxAgeDays: 14,
            choices: [DailyNewsChoice(category: "science", label: "Science", article: selected)], editionDate: "2026-09-07")
        let choices = DailyNewsSelection.choices(response, day: "2026-09-07", now: now)
        XCTAssertEqual(choices.map(\.category), ["regional", "science", "culture"])
        XCTAssertNil(choices[0].article)
        XCTAssertEqual(choices[1].article?.id, "selected")
        XCTAssertNil(choices[2].article)
        XCTAssertTrue(DailyNewsSelection.choices(response, day: "2026-09-08", now: now).allSatisfy { $0.article == nil })
        XCTAssertTrue(DailyNewsSelection.choices(RecentNewsResponse(items: [selected], maxAgeDays: 14),
            day: "2026-09-07", now: now).allSatisfy { $0.article == nil })
        XCTAssertEqual(DailyNewsSelection.choices(nil, day: "2026-09-07", now: now).count, 3)
    }

    func testRestoreAndClearProgress() {
        let puzzle = crossword()
        let identity = DailyPuzzleProgressIdentity(puzzle: puzzle)
        let keys = DailyPuzzleProgressStore.allowedKeys(for: puzzle)
        DailyPuzzleProgressStore.save(["c-0-0": "a", "not-a-cell": "Z"], for: identity, allowedKeys: keys, defaults: defaults)

        XCTAssertEqual(DailyPuzzleProgressStore.load(for: identity, allowedKeys: keys, defaults: defaults), ["c-0-0": "A"])
        DailyPuzzleProgressStore.clear(for: identity, defaults: defaults)
        XCTAssertTrue(DailyPuzzleProgressStore.load(for: identity, allowedKeys: keys, defaults: defaults).isEmpty)

        let sudokuPuzzle = sudoku(date: "2026-08-20")
        let sudokuIdentity = DailyPuzzleProgressIdentity(puzzle: sudokuPuzzle)
        let sudokuKeys = DailyPuzzleProgressStore.allowedKeys(for: sudokuPuzzle)
        DailyPuzzleProgressStore.save(["s-0": "7"], for: sudokuIdentity, allowedKeys: sudokuKeys, defaults: defaults)
        XCTAssertEqual(DailyPuzzleProgressStore.load(for: sudokuIdentity, allowedKeys: sudokuKeys, defaults: defaults), ["s-0": "7"])
    }

    func testDistributesWholeWordAndPreservesIntersectionCells() {
        let across = CrosswordEntry(number: 1, direction: "across", clue: "Fruit", answer: "PEAR", row: 0, col: 0)
        let down = CrosswordEntry(number: 2, direction: "down", clue: "Animal", answer: "EEL", row: 0, col: 1)
        var answers = [String: String]()

        let acrossEnd = DailyPuzzleCrosswordInput.distribute("pears", into: &answers, entry: across, selectedCellIndex: 0)
        XCTAssertEqual(acrossEnd, "c-0-3")
        XCTAssertEqual(answers, ["c-0-0": "P", "c-0-1": "E", "c-0-2": "A", "c-0-3": "R"])

        _ = DailyPuzzleCrosswordInput.distribute("eel", into: &answers, entry: down, selectedCellIndex: 0)
        XCTAssertEqual(answers["c-0-1"], "E")
        XCTAssertEqual(answers["c-1-1"], "E")
        XCTAssertEqual(answers["c-2-1"], "L")
    }

    func testBackspaceRepeatedlyClearsPreviousCrosswordLetters() {
        let entry = CrosswordEntry(number: 1, direction: "across", clue: "Fruit", answer: "PEAR", row: 0, col: 0)
        var answers = ["c-0-0": "P", "c-0-1": "E", "c-0-2": "A"]

        var focus = DailyPuzzleCrosswordInput.deleteBackward(
            from: &answers,
            entry: entry,
            selectedCellIndex: 3
        )
        XCTAssertEqual(focus, "c-0-2")
        XCTAssertNil(answers["c-0-2"])

        focus = DailyPuzzleCrosswordInput.deleteBackward(
            from: &answers,
            entry: entry,
            selectedCellIndex: 2
        )
        XCTAssertEqual(focus, "c-0-1")
        XCTAssertNil(answers["c-0-1"])

        focus = DailyPuzzleCrosswordInput.deleteBackward(
            from: &answers,
            entry: entry,
            selectedCellIndex: 1
        )
        XCTAssertEqual(focus, "c-0-0")
        XCTAssertTrue(answers.isEmpty)
    }

    private func crossword(date: String = "2026-08-22", clue: String = "A fruit") -> DailyPuzzleResponse {
        DailyPuzzleResponse(
            date: date,
            available: true,
            type: "crossword",
            title: "Weekend Crossword",
            instructions: nil,
            crossword: CrosswordPuzzle(
                rows: 1,
                cols: 4,
                solution: ["PEAR"],
                entries: [CrosswordEntry(number: 1, direction: "across", clue: clue, answer: "PEAR", row: 0, col: 0)]
            ),
            sudoku: nil
        )
    }

    private func sudoku(date: String) -> DailyPuzzleResponse {
        DailyPuzzleResponse(
            date: date,
            available: true,
            type: "sudoku",
            title: "Wednesday Sudoku",
            instructions: nil,
            crossword: nil,
            sudoku: SudokuPuzzle(puzzle: String(repeating: "0", count: 81), solution: String(repeating: "1", count: 81), size: 9, difficulty: "Easy")
        )
    }
}
