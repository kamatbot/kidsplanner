import Foundation

struct HomeworkStartPlan: Equatable {
    let steps: [String]
    let hints: [String]

    static func make(for item: HomeworkItem) -> HomeworkStartPlan {
        let title = clean(item.title, fallback: "this assignment")
        let subject = item.subject.flatMap { value -> String? in
            let cleaned = clean(value, fallback: "")
            return cleaned.isEmpty ? nil : cleaned
        }
        let instructions = item.notes.flatMap { firstUsefulSentence(in: $0) }

        var steps = [
            "Open the assignment and restate what “\(title)” is asking in your own words.",
            instructions.map { "Find this instruction and underline the action words: “\($0)”" }
                ?? "Find the instruction or question and underline its action words.",
            "Work on only the first small part for 10 minutes, then pause and check what changed."
        ]
        if let remaining = item.firstIncompleteChecklistItem?.text, !remaining.isEmpty {
            steps[2] = "Start with your next planned step: \(String(remaining.prefix(160)))"
        }

        var hints = [
            "What would a finished version need to show?",
            "Which word, example, or rule from class could help you begin?"
        ]
        if let subject { hints.append("For \(subject), what is the smallest part you can check on your own?") }
        hints.append("If you are still stuck after 10 minutes, ask your family about the exact step—not for the answer.")

        return HomeworkStartPlan(steps: Array(steps.prefix(4)), hints: Array(hints.prefix(4)))
    }

    static func familyHelpMessage(for item: HomeworkItem) -> String {
        let title = clean(item.title, fallback: "my assignment")
        let next = item.firstIncompleteChecklistItem?.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let next, !next.isEmpty {
            return "I’d like help getting started with “\(title)”. I’m stuck on this step: \(String(next.prefix(160))). Please help me understand how to begin, without giving me the answer."
        }
        return "I’d like help getting started with “\(title)”. Please help me understand the first step, without giving me the answer."
    }

    private static func clean(_ value: String, fallback: String) -> String {
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return String((cleaned.isEmpty ? fallback : cleaned).prefix(160))
    }

    private static func firstUsefulSentence(in value: String) -> String? {
        value.components(separatedBy: CharacterSet(charactersIn: ".!\n"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
            .map { String($0.prefix(160)) }
    }
}
