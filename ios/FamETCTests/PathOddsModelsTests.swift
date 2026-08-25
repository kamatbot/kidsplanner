import XCTest
@testable import FamETC

final class PathOddsModelsTests: XCTestCase {
    func testDecodesDailyQuestProjectionAndDerivesProgressCopy() throws {
        let json = """
        {
          "linked": true,
          "snapshot": {
            "schemaVersion": "1.0",
            "moduleId": "sat.daily-quest",
            "subject": "pws_test",
            "learnerStateVersion": 17,
            "generatedAt": "2026-08-25T03:00:00.000Z",
            "staleAfter": "2026-08-25T03:05:00.000Z",
            "state": {
              "readiness": "in-progress",
              "localDate": "2026-08-25",
              "estimatedMinutes": 15,
              "answered": 4,
              "total": 11,
              "xpAvailable": 120,
              "xpEarned": 40,
              "currentStreak": 6
            },
            "action": { "kind": "launch", "route": "sat.quest" }
          },
          "childView": false
        }
        """
        let response = try JSONDecoder().decode(PathOddsTodayResponse.self, from: Data(json.utf8))
        XCTAssertTrue(response.linked)
        XCTAssertEqual(response.snapshot?.state.title, "Continue today's SAT Quest")
        XCTAssertEqual(response.snapshot?.state.actionTitle, "Continue quest")
        XCTAssertEqual(response.snapshot?.state.progress ?? 0, 4.0 / 11.0, accuracy: 0.0001)
        XCTAssertEqual(response.snapshot?.action?.route, "sat.quest")
    }

    func testCompletedQuestAlwaysReportsFullProgress() throws {
        let state = PathOddsQuestState(
            readiness: "completed",
            localDate: "2026-08-25",
            estimatedMinutes: 15,
            answered: 10,
            total: 11,
            xpAvailable: 120,
            xpEarned: 100,
            currentStreak: 7,
            focusLabel: nil,
            completedAt: "2026-08-25T04:00:00.000Z"
        )
        XCTAssertEqual(state.progress, 1)
        XCTAssertEqual(state.title, "SAT Quest complete")
        XCTAssertEqual(state.actionTitle, "View progress")
    }
}
