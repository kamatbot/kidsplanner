import Foundation

/// Pure, transient circuit rules. Directions: north=0, east=1, south=2, west=3.
/// A connection requires reciprocal ports; success requires both outside ports.
struct CircuitTrail {
    struct Tile {
        let curved: Bool
        var turns: Int
        let solution: Int

        func ports(at turn: Int? = nil) -> Set<Int> {
            Set((curved ? [0, 1] : [0, 2]).map { ($0 + (turn ?? turns)) % 4 })
        }
    }
    struct Trace {
        var powered: Set<Int>
        var solved: Bool
    }
    var tiles: [Tile]
    let path: [Int]

    static func neighbor(_ index: Int, _ direction: Int) -> Int? {
        guard (0..<16).contains(index), (0..<4).contains(direction) else { return nil }
        let row = index / 4 + [-1, 0, 1, 0][direction]
        let col = index % 4 + [0, 1, 0, -1][direction]
        return (0..<4).contains(row) && (0..<4).contains(col) ? row * 4 + col : nil
    }

    func trace() -> Trace {
        guard tiles.count == 16, tiles[0].ports().contains(3) else {
            return Trace(powered: [], solved: false)
        }
        var powered: Set<Int> = [], queue = [0]
        while let index = queue.popLast() {
            guard powered.insert(index).inserted else { continue }
            for port in tiles[index].ports() {
                if let next = Self.neighbor(index, port), tiles[next].ports().contains((port + 2) % 4), !powered.contains(next) {
                    queue.append(next)
                }
            }
        }
        return Trace(powered: powered, solved: powered.contains(15) && tiles[15].ports().contains(1))
    }

    mutating func rotate(_ index: Int) {
        guard tiles.indices.contains(index) else { return }
        tiles[index].turns += 1 // continuous angles make every tap turn clockwise
    }

    mutating func hint() -> Int? {
        guard !trace().solved else { return nil }
        guard let index = path.first(where: { tiles[$0].ports() != tiles[$0].ports(at: tiles[$0].solution) }) else { return nil }
        while tiles[index].ports() != tiles[index].ports(at: tiles[index].solution) { rotate(index) }
        return index
    }

    static func make(seed: Int = 1) -> CircuitTrail {
        // Four authored paths, each adjacent, non-repeating and independently
        // checked. The seed also changes starting rotations and spare tiles.
        let paths = [
            [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15],
            [0, 4, 8, 12, 13, 9, 5, 1, 2, 6, 10, 14, 15],
            [0, 1, 5, 4, 8, 12, 13, 14, 10, 6, 2, 3, 7, 11, 15],
            [0, 4, 5, 1, 2, 3, 7, 6, 10, 9, 8, 12, 13, 14, 15],
        ]
        var random = UInt64(truncatingIfNeeded: seed)
        func next() -> Int {
            random = random &* 6364136223846793005 &+ 1442695040888963407
            return Int((random >> 32) & 0x7fffffff)
        }
        let path = paths[Int(UInt(bitPattern: seed) % UInt(paths.count))]
        var tiles = (0..<16).map { _ in Tile(curved: next() % 2 == 0, turns: next() % 4, solution: 0) }
        for (position, index) in path.enumerated() {
            let from = position == 0 ? 3 : (0..<4).first { neighbor(index, $0) == path[position - 1] }!
            let to = position == path.count - 1 ? 1 : (0..<4).first { neighbor(index, $0) == path[position + 1] }!
            let curved = (from + 2) % 4 != to
            let solution = (0..<4).first { Tile(curved: curved, turns: $0, solution: 0).ports() == Set([from, to]) }!
            tiles[index] = Tile(curved: curved, turns: tiles[index].turns, solution: solution)
        }
        var board = CircuitTrail(tiles: tiles, path: path)
        while board.trace().solved { board.rotate(0) }
        return board
    }
}
