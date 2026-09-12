import Foundation

struct FamsWallet: Decodable {
    struct Week: Decodable { let earned: Double; let limit: Double; let weekStart: String }
    struct Goal: Decodable { let name: String; let target: Double }
    struct School: Decodable { let current: Double?; let highWater: Double; let resetPending: Bool }
    struct Chore: Decodable, Identifiable { let id: String; let title: String; let amount: Double; let status: String }
    struct Transaction: Decodable, Identifiable { let id: String; let amount: Double; let reason: String; let createdAt: String }
    let kidId: String
    let isParent: Bool
    let balance: Double
    let totalEarned: Double
    let weekly: Week
    let goal: Goal?
    let schoolPoints: School
    let chores: [Chore]
    let transactions: [Transaction]
    let completedLessons: [String]
    var weeklyFraction: Double { weekly.limit > 0 ? min(1, max(0, weekly.earned / weekly.limit)) : 0 }
    var goalFraction: Double { guard let goal, goal.target > 0 else { return 0 }; return min(1, max(0, balance / goal.target)) }
}
struct FamsLesson: Decodable, Identifiable {
    struct Option: Decodable, Identifiable { let id: String; let text: String }
    let id: String; let title: String; let body: String; let question: String
    let options: [Option]; var completed: Bool
}
struct FamsLessonsResponse: Decodable { let lessons: [FamsLesson] }
struct FamsAnswer: Decodable { let correct: Bool; let explanation: String; let awarded: Double? }
struct FamsMutation: Decodable { let error: String? }

func famsAmount(_ amount: Double) -> String { amount.formatted(.number.precision(.fractionLength(0...2))) }

extension Notification.Name {
    static let famsRewardsChanged = Notification.Name("fam_rewards_changed")
}
