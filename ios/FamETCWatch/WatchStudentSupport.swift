import Foundation

protocol WatchStudentSupportClient {
    func fetchStudentSupport() async throws -> WatchStudentSupport
    func sendStudentSupport(_ command: WatchSupportCommand) async throws -> WatchStudentSupport
}

struct WatchStudentSupport: Codable, Equatable {
    var schemaVersion: Int
    var familyId: String
    var kidId: String
    var enabled: Bool
    var revision: Int
    var timezone: String
    var today: String
    var refreshedAt: String
    var preferences: Preferences
    var packing: Packing
    var occurrences: [Occurrence]
    var homeworkPlans: [HomeworkPlan]
    struct Preferences: Codable, Equatable {
        var quietStart: String; var quietEnd: String
        var homeworkTime: String; var packingTime: String; var morningTime: String
        var focusMinutes: Int
    }
    struct Packing: Codable, Equatable {
        var date: String?; var coverage: String; var message: String?
        var sourceUpdatedAt: String?; var items: [Item]; var complete: Bool
        var requirementsConfirmed: Bool? = nil
    }
    struct Item: Codable, Equatable, Identifiable {
        var id: String; var title: String; var reasons: [String]; var phase: String; var status: String
    }
    struct Occurrence: Codable, Equatable, Identifiable {
        var id: String; var routineId: String; var date: String; var title: String; var time: String
        var steps: [Step]; var status: String; var snoozedUntil: String?
    }
    struct Step: Codable, Equatable, Identifiable { var id: String; var title: String; var done: Bool }
    struct HomeworkPlan: Codable, Equatable {
        var homeworkId: String; var nextStep: String; var plannedDate: String?; var workFinished: Bool
        var handInMethod: String; var submission: String; var submittedAt: String?
    }
    func belongs(to profile: WatchProfile?) -> Bool {
        profile?.role == "kid" && profile?.familyId == familyId && profile?.kidId == kidId
    }
}

struct WatchSupportCommand: Codable, Equatable, Identifiable {
    var id: String { commandId }
    var userId: String
    var familyId: String
    var kidId: String
    var commandId: String = UUID().uuidString
    var expectedRevision: Int
    var type: String
    var payload: Payload
    struct Payload: Codable, Equatable {
        var date: String?; var itemId: String?; var status: String?
        var occurrenceId: String?; var snoozedUntil: String?; var stepId: String?; var done: Bool?
        var homeworkId: String?; var nextStep: String?; var workFinished: Bool?; var submission: String?
    }
}

extension WatchStudentSupport {
    /// Keep the acknowledged revision intact; only display durable, identity-matched intents.
    func projecting(_ commands: [WatchSupportCommand], profile: WatchProfile?) -> Self {
        var value = self
        for command in commands where command.userId == profile?.userId && command.familyId == familyId && command.kidId == kidId {
            let payload = command.payload
            switch command.type {
            case "packing_item":
                guard payload.date == value.packing.date,
                      let index = value.packing.items.firstIndex(where: { $0.id == payload.itemId }),
                      let status = payload.status else { continue }
                value.packing.items[index].status = status
                value.packing.complete = value.packing.requirementsConfirmed == true
                    && ["verified", "manual"].contains(value.packing.coverage)
                    && !value.packing.items.isEmpty
                    && value.packing.items.allSatisfy { ["packed", "at_school"].contains($0.status) }
            case "routine_status":
                guard let index = value.occurrences.firstIndex(where: { $0.id == payload.occurrenceId }),
                      let status = payload.status else { continue }
                value.occurrences[index].status = status
                value.occurrences[index].snoozedUntil = payload.snoozedUntil
            case "routine_step":
                guard let index = value.occurrences.firstIndex(where: { $0.id == payload.occurrenceId }),
                      let step = value.occurrences[index].steps.firstIndex(where: { $0.id == payload.stepId }),
                      let done = payload.done else { continue }
                value.occurrences[index].steps[step].done = done
            case "homework_plan":
                guard let id = payload.homeworkId else { continue }
                if !value.homeworkPlans.contains(where: { $0.homeworkId == id }) {
                    value.homeworkPlans.append(.init(homeworkId: id, nextStep: "", workFinished: false, handInMethod: "unknown", submission: "unknown"))
                }
                guard let index = value.homeworkPlans.firstIndex(where: { $0.homeworkId == id }) else { continue }
                if let step = payload.nextStep { value.homeworkPlans[index].nextStep = step }
                if let finished = payload.workFinished { value.homeworkPlans[index].workFinished = finished }
                if let submission = payload.submission { value.homeworkPlans[index].submission = submission }
            default: break
            }
        }
        return value
    }
}
