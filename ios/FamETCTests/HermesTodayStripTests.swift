import XCTest
@testable import FamETC

/// Contract §8 selector (docs/HERMES-THREADS-CONTRACT.md): the Today Hermes
/// strip shows at most 2 open hermes-nudge cards, newest first — an
/// "actionable" one (a real button, not just `open`/`done`) for 18h, a
/// status-only one for 2h. `TodayHermesStrip.items(from:now:)` is pure so
/// these fixed-clock assertions don't depend on wall time.
@MainActor
final class HermesTodayStripTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)   // fixed reference instant
    private let iso = ISO8601DateFormatter()

    private func at(hoursAgo: Double) -> String {
        iso.string(from: now.addingTimeInterval(-hoursAgo * 3600))
    }

    /// Builds an eligible-shape `hermes-nudge` message: agent-sent, open, not
    /// deleted — callers vary only the fields the test is about.
    private func nudge(_ id: String,
                       hoursAgo: Double,
                       status: String = "open",
                       actions: [HermesNudgeAction] = [],
                       deleted: Bool = false,
                       senderType: String = "agent",
                       cardType: String = "hermes-nudge") -> ChatMessage {
        let card = ChatCard(type: cardType, id: "nudge-\(id)", title: nil,
                             kind: "day-end", lines: nil, actions: actions,
                             state: HermesNudgeState(status: status))
        return ChatMessage(id: id, familyId: "f1", senderType: senderType, senderId: "hermes",
                            postedByUserId: nil, text: "text-\(id)", card: card, media: nil,
                            createdAt: at(hoursAgo: hoursAgo), deleted: deleted, deletedBy: nil,
                            flagged: false, flagReason: nil, flaggedBy: nil)
    }

    private let actionable = [HermesNudgeAction(id: "later", label: "In 30 min", style: "secondary")]
    private let openOnly = [HermesNudgeAction(id: "open-homework", label: "Open homework", style: "primary", open: "homework")]
    private let doneOnly = [HermesNudgeAction(id: "later", label: "In 30 min", style: "secondary", done: true, doneLabel: "Snoozed ✓")]

    // MARK: Actionable — 18h window

    func testActionableWithinEighteenHoursIsShown() {
        let m = nudge("m1", hoursAgo: 17, actions: actionable)
        XCTAssertEqual(TodayHermesStrip.items(from: [m], now: now).map(\.id), ["m1"])
    }

    func testActionableOlderThanEighteenHoursIsHidden() {
        let m = nudge("m1", hoursAgo: 19, actions: actionable)
        XCTAssertEqual(TodayHermesStrip.items(from: [m], now: now), [])
    }

    // MARK: Status-only — 2h window

    func testStatusOnlyWithinTwoHoursIsShown() {
        let m = nudge("m1", hoursAgo: 1, actions: [])
        XCTAssertEqual(TodayHermesStrip.items(from: [m], now: now).map(\.id), ["m1"])
    }

    func testStatusOnlyOlderThanTwoHoursIsHidden() {
        let m = nudge("m1", hoursAgo: 3, actions: [])
        XCTAssertEqual(TodayHermesStrip.items(from: [m], now: now), [])
    }

    // MARK: Resolved / snoozed / deleted always hidden

    func testResolvedDoneStatusIsHidden() {
        let m = nudge("m1", hoursAgo: 0.1, status: "done", actions: actionable)
        XCTAssertEqual(TodayHermesStrip.items(from: [m], now: now), [])
    }

    func testSnoozedStatusIsHidden() {
        let m = nudge("m1", hoursAgo: 0.1, status: "snoozed", actions: actionable)
        XCTAssertEqual(TodayHermesStrip.items(from: [m], now: now), [])
    }

    func testDeletedIsHidden() {
        let m = nudge("m1", hoursAgo: 0.1, actions: actionable, deleted: true)
        XCTAssertEqual(TodayHermesStrip.items(from: [m], now: now), [])
    }

    // MARK: `open` and `done` actions don't count as actionable

    func testOpenOnlyActionIsNotActionable() {
        // Only an `open` action: falls back to the 2h status-only window, so a
        // 10h-old post (well inside 18h) must still be hidden.
        let m = nudge("m1", hoursAgo: 10, actions: openOnly)
        XCTAssertEqual(TodayHermesStrip.items(from: [m], now: now), [], "an open-only card is not actionable")
    }

    func testDoneActionIsNotActionable() {
        let m = nudge("m1", hoursAgo: 10, actions: doneOnly)
        XCTAssertEqual(TodayHermesStrip.items(from: [m], now: now), [], "an all-done card is not actionable")
    }

    // MARK: Max 2, newest first

    func testMaxTwoNewestFirst() {
        let oldest = nudge("m1", hoursAgo: 3, actions: actionable)
        let middle = nudge("m2", hoursAgo: 2, actions: actionable)
        let newest = nudge("m3", hoursAgo: 1, actions: actionable)
        XCTAssertEqual(TodayHermesStrip.items(from: [oldest, middle, newest], now: now).map(\.id), ["m3", "m2"])
    }
}
