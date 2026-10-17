import Foundation

@main struct CircuitChecks {
    static func main() throws {
        let old = #"{"qid":"bt31","q":"Which?","options":["1","2","3","4"],"answerIndex":1}"#
        let decoded = try JSONDecoder().decode(BrainTeaserQ.self, from: Data(old.utf8))
        precondition(decoded.visual == nil && decoded.category == nil && decoded.difficulty == nil)
        let visual = BrainTeaserVisual(kind: "path", alt: "A complete grid", items: Array(repeating: "wall", count: 25), columns: 5)
        precondition(visual.isRenderable)
        let restored = try JSONDecoder().decode(BrainTeaserVisual.self, from: JSONEncoder().encode(visual))
        precondition(restored.items.count == 25 && restored.columns == 5 && restored.isRenderable)
        precondition(!BrainTeaserVisual(kind: "path", alt: "Grid", items: ["1", "2"], columns: 0).isRenderable)
        precondition(!BrainTeaserVisual(kind: "path", alt: "Grid", items: ["1", "2", "3"], columns: 2).isRenderable)
        let practice = #"{"count":1,"questions":[{"qid":"bt71","q":"Which?","options":["1","2","3","4"],"answerIndex":2,"visual":{"kind":"sequence","alt":"Number tiles","items":["1","2","?"]}}]}"#
        let response = try JSONDecoder().decode(BrainTeaserPracticeResponse.self, from: Data(practice.utf8))
        precondition(response.count == 1 && response.questions[0].visual?.isRenderable == true)
        for seed in 0..<64 {
            let board = CircuitTrail.make(seed: seed)
            precondition(board.tiles.count == 16 && board.path.first == 0 && board.path.last == 15)
            precondition(Set(board.path).count == board.path.count)
            precondition(!board.trace().solved)
            precondition(board.tiles.map(\.turns) == CircuitTrail.make(seed: seed).tiles.map(\.turns))
            for i in 1..<board.path.count {
                let a = board.path[i - 1], b = board.path[i]
                precondition(abs(a / 4 - b / 4) + abs(a % 4 - b % 4) == 1)
            }
            var solved = board
            for i in solved.path { solved.tiles[i].turns = solved.tiles[i].solution }
            precondition(solved.trace().solved)
            precondition(Set(solved.path).isSubset(of: solved.trace().powered))
            for i in solved.tiles.indices {
                let ports = solved.tiles[i].ports()
                for _ in 0..<4 { solved.rotate(i) }
                precondition(solved.tiles[i].ports() == ports)
            }
            precondition(solved.trace().solved)
            while solved.tiles[15].ports().contains(1) { solved.rotate(15) }
            precondition(!solved.trace().solved)
            var hinted = board
            var hints = 0
            while !hinted.trace().solved && hints < 16 {
                precondition(hinted.hint() != nil)
                hints += 1
            }
            precondition(hinted.trace().solved && hinted.hint() == nil)
            let turns = hinted.tiles.map(\.turns)
            hinted.rotate(-1); hinted.rotate(16)
            precondition(hinted.tiles.map(\.turns) == turns)
        }
        precondition(CircuitTrail.neighbor(3, 1) == nil)
        precondition(CircuitTrail.neighbor(4, 3) == nil)
        precondition(CircuitTrail.neighbor(0, 0) == nil)
        precondition(CircuitTrail.neighbor(15, 2) == nil)
        precondition(CircuitTrail.neighbor(0, 1) == 1)
        var broken = CircuitTrail.make()
        broken.tiles[0] = .init(curved: false, turns: 1, solution: 1)
        broken.tiles[1] = .init(curved: true, turns: 0, solution: 0)
        precondition(broken.trace().powered == Set([0]))
        precondition(!CircuitTrail(tiles: [], path: []).trace().solved)
        print("64 boards verified")
    }
}
