import Foundation

struct StudentSupportSnapshot: Codable {
    var schemaVersion: Int
    var familyId: String
    var kidId: String
    var enabled: Bool
    var revision: Int
    var timezone: String
    var today: String
    var refreshedAt: String
    var preferences: SupportPreferences
    var materialRules: [SupportMaterialRule]
    var routines: [SupportRoutine]
    var packing: SupportPacking
    var occurrences: [SupportOccurrence]
    var homeworkPlans: [SupportHomeworkPlan]
}
struct SupportPreferences: Codable {
    var quietStart: String; var quietEnd: String; var homeworkTime: String
    var packingTime: String; var morningTime: String; var focusMinutes: Int
}
struct SupportMaterialRule: Codable, Identifiable {
    var id: String; var title: String; var matchKind: String; var matchValue: String
    var phase: String; var location: String
}
struct SupportRoutine: Codable, Identifiable {
    var id: String; var title: String; var weekdays: [Int]; var time: String
    var steps: [SupportRoutineStep]; var active: Bool
}
struct SupportRoutineStep: Codable, Identifiable { var id: String; var title: String }
struct SupportPacking: Codable {
    var date: String?; var coverage: String; var message: String?; var sourceUpdatedAt: String?
    var items: [SupportPackingItem]; var complete: Bool
    var requirementsConfirmed: Bool? = nil

    var parentWarning: String? {
        guard coverage == "stale" || coverage == "missing" || requirementsConfirmed != true else { return nil }
        return message ?? "Packing requirements are not fully confirmed. Review the school timetable and agreed materials before treating this list as complete."
    }
}
struct SupportPackingItem: Codable, Identifiable {
    var id: String; var title: String; var reasons: [String]; var phase: String; var status: String
}
struct SupportOccurrence: Codable, Identifiable {
    var id: String; var routineId: String; var date: String; var title: String; var time: String
    var steps: [SupportOccurrenceStep]; var status: String; var snoozedUntil: String?
}
struct SupportOccurrenceStep: Codable, Identifiable { var id: String; var title: String; var done: Bool }
struct SupportHomeworkPlan: Codable {
    var homeworkId: String; var nextStep: String; var plannedDate: String?; var workFinished: Bool
    var handInMethod: String; var submission: String; var submittedAt: String?
}
struct StudentSupportResponse: Decodable { var support: StudentSupportSnapshot }
struct SupportScope: Codable, Equatable { var userID: String; var familyID: String; var kidID: String }
struct SupportCommand: Codable, Identifiable {
    var id: String
    var scope: SupportScope
    var expectedRevision: Int
    var type: String
    var payload: Data
    var body: [String: Any] {
        ["kidId": scope.kidID, "commandId": id, "expectedRevision": expectedRevision,
         "type": type, "payload": (try? JSONSerialization.jsonObject(with: payload)) ?? [:]]
    }
}
// Device-local recovery only: no focus history or completion inference.
// ponytail: cross-device timer takeover requires an explicit ownership protocol.
struct SupportTimer: Codable {
    var remaining: TimeInterval = 600
    var endsAt: Date?
    func seconds(at now: Date) -> Int { max(0, Int((endsAt.map { $0.timeIntervalSince(now) } ?? remaining).rounded(.up))) }
    mutating func pause(at now: Date) { remaining = Double(seconds(at: now)); endsAt = nil }
    mutating func resume(at now: Date) { if remaining > 0 { endsAt = now.addingTimeInterval(remaining) } }
}

extension StudentSupportSnapshot {
    /// Pure projection of explicit pending intents. Revision remains server-owned.
    /// Derived list membership and ready state require a server acknowledgement.
    mutating func apply(_ command: SupportCommand) {
        guard command.scope.familyID == familyId, command.scope.kidID == kidId,
              let payload = try? JSONSerialization.jsonObject(with: command.payload) as? [String: Any] else { return }
        switch command.type {
        case "packing_item":
            guard payload["date"] as? String == packing.date,
                  let index = packing.items.firstIndex(where: { $0.id == payload["itemId"] as? String }),
                  let status = payload["status"] as? String else { return }
            packing.items[index].status = status
            packing.complete = false // A pending local check must not assert confirmed readiness.
        case "routine_step":
            guard let index = occurrences.firstIndex(where: { $0.id == payload["occurrenceId"] as? String }),
                  let step = occurrences[index].steps.firstIndex(where: { $0.id == payload["stepId"] as? String }),
                  let done = payload["done"] as? Bool else { return }
            occurrences[index].steps[step].done = done
        case "routine_status":
            guard let index = occurrences.firstIndex(where: { $0.id == payload["occurrenceId"] as? String }),
                  let status = payload["status"] as? String else { return }
            occurrences[index].status = status
            occurrences[index].snoozedUntil = payload["snoozedUntil"] as? String
        case "homework_plan":
            guard let id = payload["homeworkId"] as? String else { return }
            if !homeworkPlans.contains(where: { $0.homeworkId == id }) {
                homeworkPlans.append(SupportHomeworkPlan(homeworkId: id, nextStep: "", workFinished: false, handInMethod: "unknown", submission: "unknown"))
            }
            guard let index = homeworkPlans.firstIndex(where: { $0.homeworkId == id }) else { return }
            if let step = payload["nextStep"] as? String { homeworkPlans[index].nextStep = step }
            if payload.keys.contains("plannedDate") { homeworkPlans[index].plannedDate = payload["plannedDate"] as? String }
            if let finished = payload["workFinished"] as? Bool { homeworkPlans[index].workFinished = finished }
            if let method = payload["handInMethod"] as? String { homeworkPlans[index].handInMethod = method }
            if let submission = payload["submission"] as? String { homeworkPlans[index].submission = submission }
        default: break // Configuration remains unconfirmed until server validation succeeds.
        }
    }
}

/// Deterministic, explainable ordering; no attention inference or persistent focus history.
enum SupportNowChoice {
    case routine(SupportOccurrence)
    case homework(HomeworkItem, reason: String)
    case none

    static func choose(snapshot: StudentSupportSnapshot, homework: [HomeworkItem], now: Date) -> SupportNowChoice {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: snapshot.timezone)
        formatter.dateFormat = "HH:mm"
        let localTime = formatter.string(from: now)
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: now)
        if snapshot.today == today,
           let routine = snapshot.occurrences.filter({
               $0.date == today && $0.time <= localTime && ($0.status == "open" ||
                   ($0.status == "snoozed" && ($0.snoozedUntil.flatMap { ISO8601DateFormatter().date(from: $0) } ?? .distantFuture) <= now))
           }).sorted(by: { ($0.time, $0.id) < ($1.time, $1.id) }).first {
            return .routine(routine)
        }
        let own = homework.filter { $0.kidId == snapshot.kidId && !$0.isDone }.sorted { ($0.dueDate, $0.id) < ($1.dueDate, $1.id) }
        if let planned = own.first(where: { item in snapshot.homeworkPlans.contains { $0.homeworkId == item.id && $0.plannedDate == today && !$0.nextStep.isEmpty && !$0.workFinished } }) {
            return .homework(planned, reason: "You planned a next step for today.")
        }
        if let first = own.first { return .homework(first, reason: "Your earliest due open assignment. Choose another if it fits better.") }
        return .none
    }
}
