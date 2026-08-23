import CryptoKit
import Foundation

struct DailyPuzzleProgressIdentity: Hashable {
    let date: String
    let type: String
    let fingerprint: String

    init(puzzle: DailyPuzzleResponse) {
        date = puzzle.date
        type = puzzle.type ?? Self.inferredType(for: puzzle)
        fingerprint = Self.fingerprint(for: puzzle)
    }

    var storageKey: String {
        "fametc.dailyPuzzleProgress.v1.\(Self.keyPart(date)).\(Self.keyPart(type)).\(fingerprint)"
    }

    private static func inferredType(for puzzle: DailyPuzzleResponse) -> String {
        if puzzle.crossword != nil { return "crossword" }
        if puzzle.sudoku != nil { return "sudoku" }
        return "unknown"
    }

    private static func fingerprint(for puzzle: DailyPuzzleResponse) -> String {
        let material: String
        if let crossword = puzzle.crossword {
            let entries = crossword.entries
                .sorted { $0.id < $1.id }
                .map { entry in
                    "\(entry.number)|\(entry.direction)|\(entry.row)|\(entry.col)|\(entry.answer.count)|\(entry.clue)"
                }
                .joined(separator: "\n")
            material = "crossword|\(crossword.rows)|\(crossword.cols)|\(entries)"
        } else if let sudoku = puzzle.sudoku {
            // The given grid identifies the puzzle without retaining its solution.
            material = "sudoku|\(sudoku.size)|\(sudoku.puzzle)"
        } else {
            material = "unknown"
        }

        return SHA256.hash(data: Data(material.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private static func keyPart(_ value: String) -> String {
        value.unicodeScalars.map { scalar in
            let isASCIIAlphaNumeric = (scalar.value >= 48 && scalar.value <= 57)
                || (scalar.value >= 65 && scalar.value <= 90)
                || (scalar.value >= 97 && scalar.value <= 122)
            return isASCIIAlphaNumeric || scalar == "-" || scalar == "_" ? String(scalar) : "_"
        }.joined()
    }
}

struct DailyPuzzleProgressStore {
    private static let payloadVersion = 1

    static func allowedKeys(for puzzle: DailyPuzzleResponse) -> Set<String> {
        if let crossword = puzzle.crossword {
            return Set(crossword.entries.flatMap { entry in
                DailyPuzzleCrosswordInput.cells(for: entry).filter { row, col in
                    (0..<crossword.rows).contains(row) && (0..<crossword.cols).contains(col)
                }.map { DailyPuzzleCrosswordInput.cellKey(row: $0.row, col: $0.col) }
            })
        }
        if let sudoku = puzzle.sudoku {
            return Set((0..<min(81, sudoku.size * sudoku.size)).filter {
                character(sudoku.puzzle, at: $0) == "0"
            }.map { "s-\($0)" })
        }
        return []
    }

    static func load(
        for identity: DailyPuzzleProgressIdentity,
        allowedKeys: Set<String>,
        defaults: UserDefaults = .standard
    ) -> [String: String] {
        guard let data = defaults.data(forKey: identity.storageKey),
              let payload = try? JSONDecoder().decode(Payload.self, from: data),
              payload.version == payloadVersion,
              payload.answers.keys.allSatisfy({ allowedKeys.contains($0) }),
              payload.answers.allSatisfy({ isValidValue($0.value, for: $0.key) }) else {
            return [:]
        }
        return payload.answers
    }

    static func save(
        _ answers: [String: String],
        for identity: DailyPuzzleProgressIdentity,
        allowedKeys: Set<String>,
        defaults: UserDefaults = .standard
    ) {
        let sanitized = answers.reduce(into: [String: String]()) { result, item in
            guard allowedKeys.contains(item.key), let value = normalizedValue(item.value, for: item.key) else { return }
            result[item.key] = value
        }
        guard !sanitized.isEmpty,
              let data = try? JSONEncoder().encode(Payload(version: payloadVersion, answers: sanitized)) else {
            defaults.removeObject(forKey: identity.storageKey)
            return
        }
        defaults.set(data, forKey: identity.storageKey)
    }

    static func clear(
        for identity: DailyPuzzleProgressIdentity,
        defaults: UserDefaults = .standard
    ) {
        defaults.removeObject(forKey: identity.storageKey)
    }

    private struct Payload: Codable {
        let version: Int
        let answers: [String: String]
    }

    private static func normalizedValue(_ value: String, for key: String) -> String? {
        let characters = value.uppercased().filter { character in
            key.hasPrefix("s-")
                ? ("1"..."9").contains(String(character))
                : character.isLetter
        }
        guard characters.count == 1 else { return nil }
        return String(characters)
    }

    private static func isValidValue(_ value: String, for key: String) -> Bool {
        normalizedValue(value, for: key) == value
    }

    private static func character(_ text: String, at index: Int) -> String {
        guard index >= 0, index < text.count else { return "" }
        return String(text[text.index(text.startIndex, offsetBy: index)])
    }
}

struct DailyPuzzleCrosswordInput {
    static func cellKey(row: Int, col: Int) -> String {
        "c-\(row)-\(col)"
    }

    static func cells(for entry: CrosswordEntry) -> [(row: Int, col: Int)] {
        let rowStep = entry.direction == "down" ? 1 : 0
        let colStep = entry.direction == "down" ? 0 : 1
        return Array(entry.answer).indices.map { index in
            (entry.row + rowStep * index, entry.col + colStep * index)
        }
    }

    static func distribute(
        _ input: String,
        into answers: inout [String: String],
        entry: CrosswordEntry,
        selectedCellIndex: Int
    ) -> String? {
        let letters = input.uppercased().filter { $0.isLetter }
        let cells = cells(for: entry)
        guard !letters.isEmpty, cells.indices.contains(selectedCellIndex) else { return nil }

        var lastIndex: Int?
        for (offset, letter) in letters.enumerated() {
            let cellIndex = selectedCellIndex + offset
            guard cells.indices.contains(cellIndex) else { break }
            let cell = cells[cellIndex]
            answers[cellKey(row: cell.row, col: cell.col)] = String(letter)
            lastIndex = cellIndex
        }
        guard let lastIndex else { return nil }
        let lastCell = cells[lastIndex]
        return cellKey(row: lastCell.row, col: lastCell.col)
    }

    static func deleteBackward(
        from answers: inout [String: String],
        entry: CrosswordEntry,
        selectedCellIndex: Int
    ) -> String? {
        let entryCells = cells(for: entry)
        guard entryCells.indices.contains(selectedCellIndex) else { return nil }

        let selectedCell = entryCells[selectedCellIndex]
        let selectedKey = cellKey(row: selectedCell.row, col: selectedCell.col)
        let targetIndex: Int?
        if answers[selectedKey]?.isEmpty == false {
            targetIndex = selectedCellIndex
        } else {
            targetIndex = stride(from: selectedCellIndex - 1, through: 0, by: -1).first { index in
                let cell = entryCells[index]
                return answers[cellKey(row: cell.row, col: cell.col)]?.isEmpty == false
            }
        }

        guard let targetIndex else { return selectedKey }
        let target = entryCells[targetIndex]
        let targetKey = cellKey(row: target.row, col: target.col)
        answers.removeValue(forKey: targetKey)
        return targetKey
    }

}
