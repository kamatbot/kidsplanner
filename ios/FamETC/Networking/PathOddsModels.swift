import Foundation

struct PathOddsTodayResponse: Decodable, Sendable {
    let linked: Bool
    let snapshot: PathOddsModuleSnapshot?
    let linkUrl: String?
    let childView: Bool?
}

struct PathOddsModuleSnapshot: Decodable, Sendable {
    let schemaVersion: String
    let moduleId: String
    let subject: String
    let learnerStateVersion: Int64
    let generatedAt: String
    let staleAfter: String
    let state: PathOddsQuestState
    let action: PathOddsAction?
}

struct PathOddsAction: Decodable, Sendable {
    let kind: String
    let route: String
}

struct PathOddsQuestState: Decodable, Sendable {
    let readiness: String
    let localDate: String
    let estimatedMinutes: Int?
    let answered: Int?
    let total: Int?
    let xpAvailable: Int?
    let xpEarned: Int?
    let currentStreak: Int?
    let focusLabel: String?
    let completedAt: String?

    var progress: Double {
        if readiness == "completed" { return 1 }
        let denominator = max(1, total ?? 11)
        return min(1, max(0, Double(answered ?? 0) / Double(denominator)))
    }

    var title: String {
        switch readiness {
        case "setup-required": return "Set up SAT prep"
        case "diagnostic-required": return "Build your SAT baseline"
        case "in-progress": return "Continue today's SAT Quest"
        case "completed": return "SAT Quest complete"
        default: return "Today's SAT Quest"
        }
    }

    var detail: String {
        switch readiness {
        case "setup-required":
            return "Choose a target score and study schedule so PathOdds can build your plan."
        case "diagnostic-required":
            return "Complete the diagnostic before PathOdds starts adapting your daily quests."
        case "in-progress":
            return "\(answered ?? 0) of \(total ?? 11) complete · \(estimatedMinutes ?? 15) min plan"
        case "completed":
            return xpEarned.map { "Done for today · +\($0) XP" } ?? "Done for today."
        default:
            return "\(estimatedMinutes ?? 15) focused minutes · \(total ?? 11) questions · Review → Focus → Mix → Sprint"
        }
    }

    var actionTitle: String {
        switch readiness {
        case "setup-required": return "Finish setup"
        case "diagnostic-required": return "Start diagnostic"
        case "in-progress": return "Continue quest"
        case "completed": return "View progress"
        default: return "Start quest"
        }
    }
}

struct PathOddsConnectResponse: Decodable, Sendable {
    let linked: Bool
    let snapshot: PathOddsModuleSnapshot?
    let childView: Bool?
}

struct PathOddsLaunchResponse: Decodable, Sendable {
    let launchUrl: String
    let expiresAt: String
}

struct PathOddsErrorResponse: Decodable, Sendable {
    let error: String?
    let code: String?
    let linkUrl: String?
}
