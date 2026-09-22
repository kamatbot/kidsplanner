import XCTest
@testable import FamETC

@MainActor
final class NativePolishPrivacyTests: XCTestCase {
    func testFastCrosswordInputUsesLogicalCursorInsteadOfPreviousResponder() {
        let cursor = DailyPuzzleCrosswordInput.cursor("c-0-1", fallbackRow: 0, fallbackCol: 0)
        XCTAssertEqual(cursor.row, 0)
        XCTAssertEqual(cursor.col, 1)
        let fallback = DailyPuzzleCrosswordInput.cursor(nil, fallbackRow: 2, fallbackCol: 3)
        XCTAssertEqual(fallback.row, 2)
        XCTAssertEqual(fallback.col, 3)
    }
    private var parent: User { User(id: "parent-a", email: "", name: "Parent", role: "parent") }
    private var note: Note {
        Note(id: "private-note", authorType: "parent", authorId: "parent-a", date: "2026-09-22",
             body: "Parent-only synthetic reflection", source: "quote", ref: nil)
    }

    func testSwitchingToChildClearsPreviousNotesImmediately() {
        let store = AppStore()
        store.me = parent
        store.notes = [note]
        store.me = User(id: "child-a", email: "", role: "kid", kidId: "kid-a")
        XCTAssertTrue(store.notes.isEmpty)
    }

    func testSigningOutClearsNotesBeforeAnotherLoad() {
        let store = AppStore()
        store.me = parent
        store.notes = [note]
        store.signedOut()
        XCTAssertTrue(store.notes.isEmpty)
    }

    func testSameAccountRefreshPreservesNotes() {
        let store = AppStore()
        store.me = parent
        store.notes = [note]
        store.me = parent
        XCTAssertEqual(store.notes.map(\.id), ["private-note"])
    }

    func testFamilyChangeClearsPreviousNotes() {
        let store = AppStore()
        store.me = parent
        store.family = Family(id: "family-a", name: "A", inviteCode: nil, parentIds: [parent.id], kids: [], createdAt: "")
        store.notes = [note]
        store.family = Family(id: "family-b", name: "B", inviteCode: nil, parentIds: [parent.id], kids: [], createdAt: "")
        XCTAssertTrue(store.notes.isEmpty)
    }
}
