import Foundation

struct Goal: Codable, Identifiable, Equatable {
    let id: String
    var kidId: String
    var title: String
    var type: String
    var target: Int
    var checks: [String]?
    var progress: Int?
}

struct GoalsResponse: Codable { var goals: [Goal] }
struct GoalResponse: Codable { var goal: Goal }

enum GoalLoadState { case idle, loading, ready, error }
