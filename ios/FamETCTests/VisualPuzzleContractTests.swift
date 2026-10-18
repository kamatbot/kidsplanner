import XCTest
@testable import FamETC

final class VisualPuzzleContractTests: XCTestCase {
    func testLegacyQuestionDecodesWithoutOptionalVisualFields() throws {
        let json = #"{"qid":"bt31","q":"Which order?","options":["A","B","C","D"],"answerIndex":1}"#
        let question = try JSONDecoder().decode(BrainTeaserQ.self, from: Data(json.utf8))
        XCTAssertNil(question.visual)
        XCTAssertNil(question.category)
        XCTAssertNil(question.difficulty)
        XCTAssertEqual(question.answerIndex, 1)
    }

    func testVisualQuestionRetainsFullFiveByFiveGrid() throws {
        let visual = BrainTeaserVisual(kind: "path", alt: "A complete grid", items: Array(repeating: "wall", count: 25), columns: 5)
        let question = BrainTeaserQ(qid: "bt131", q: "Find a route.", options: ["6", "5", "7", "9"], answerIndex: 0,
                                   visual: visual, category: "path", difficulty: "medium")
        let decoded = try JSONDecoder().decode(BrainTeaserQ.self, from: JSONEncoder().encode(question))
        XCTAssertEqual(decoded.visual?.items.count, 25)
        XCTAssertEqual(decoded.visual?.columns, 5)
        XCTAssertEqual(decoded.visual?.isRenderable, true)
        XCTAssertEqual(decoded.options[decoded.answerIndex], "6")
    }

    func testMalformedVisualFallsBackToQuestionText() {
        XCTAssertFalse(BrainTeaserVisual(kind: "unknown", alt: "", items: ["1", "2"]).isRenderable)
        XCTAssertFalse(BrainTeaserVisual(kind: "path", alt: "", items: ["1", "2"], columns: 0).isRenderable)
        XCTAssertFalse(BrainTeaserVisual(kind: "path", alt: "", items: Array(repeating: "1", count: 26), columns: 2).isRenderable)
        XCTAssertFalse(BrainTeaserVisual(kind: "path", alt: "", items: ["1", "2", "3"], columns: 2).isRenderable)
    }

    func testPracticeHasNoDateOrProgressRequirement() throws {
        let json = #"{"count":1,"questions":[{"qid":"bt71","q":"Which tile?","options":["1","2","3","4"],"answerIndex":2,"visual":{"kind":"sequence","alt":"Number tiles","items":["1","2","?"]}}]}"#
        let response = try JSONDecoder().decode(BrainTeaserPracticeResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.count, 1)
        XCTAssertTrue(try XCTUnwrap(response.questions.first?.visual).isRenderable)
    }
}
