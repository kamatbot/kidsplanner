import XCTest
@testable import FamETC

final class ParentAttentionTests: XCTestCase {
    private let parent = User(id: "p", email: "", role: "parent")
    private let family = Family(id: "f", name: "Family", inviteCode: nil, parentIds: ["p"],
                                kids: [Kid(id: "k", name: "Ryshi", grade: "7", color: "", createdAt: "")], createdAt: "")
    private var today: Date { DateFmt.ymd.date(from: "2026-09-16")! }
    private func homework(_ id: String, due: String = "2026-09-16", kid: String = "k", status: String = "todo") -> HomeworkItem {
        HomeworkItem(id: id, kidId: kid, title: "Science", subject: "Science", dueDate: due,
                     dueTime: nil, status: status, effortMin: nil)
    }
    func testParentBriefIncludesOnlyKnownChildrenAndNearTermUnfinishedWork() {
        let items = ParentAttention.items(user: parent, family: family,
            homework: [homework("today"), homework("tomorrow", due: "2026-09-17"),
                       homework("later", due: "2026-09-18"), homework("done", status: "done"),
                       homework("unknown", kid: "other")], actions: [], events: [], now: today)
        XCTAssertEqual(items.map(\.id), ["homework:today", "homework:tomorrow"])
        XCTAssertTrue(items[0].title.contains("Ryshi"))
        XCTAssertTrue(items[0].detail.contains("Review or offer help"))
    }
    func testNoBriefForKidGuestOrMissingAccount() {
        for user in [nil, User(id: "k-user", email: "", role: "kid", kidId: "k"),
                     User(id: "guest", email: "", role: "parent")] as [User?] {
            XCTAssertTrue(ParentAttention.items(user: user, family: family, homework: [homework("h")],
                                               actions: [], events: [], now: today).isEmpty)
        }
    }
    func testHomeworkActionIsNotRepeatedAndCrossFamilyActionIsExcluded() {
        func action(_ id: String, familyID: String, source: String?) -> FamilyAction {
            FamilyAction(id: id, familyId: familyID, title: "Review Science", notes: nil, status: "open",
                         dueDate: "2026-09-16", dueTime: nil, assigneeType: "family", assigneeId: nil,
                         kidId: "k", sourceType: "homework", sourceId: source, createdBy: nil,
                         createdAt: "", updatedAt: nil, snoozedUntil: nil)
        }
        let items = ParentAttention.items(user: parent, family: family, homework: [homework("h")],
            actions: [action("duplicate", familyID: "f", source: "h"), action("foreign", familyID: "other", source: nil)],
            events: [], now: today)
        XCTAssertEqual(items.map(\.id), ["homework:h"])
    }

    @MainActor
    func testSigningOutClearsBriefSourceAndFreshness() {
        let store = AppStore()
        store.me = parent
        store.family = family
        store.homework = [homework("h")]
        store.attentionUpdatedAt = today
        store.assistanceIdentityVerified = true
        store.signedOut()
        XCTAssertNil(store.me)
        XCTAssertNil(store.family)
        XCTAssertNil(store.attentionUpdatedAt)
        XCTAssertFalse(store.assistanceIdentityVerified)
        XCTAssertTrue(store.homework.isEmpty)
        XCTAssertTrue(store.events.isEmpty)
        XCTAssertTrue(store.familyEvents.isEmpty)
    }
}
