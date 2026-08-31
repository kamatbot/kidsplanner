import Foundation

// MARK: - Watch payloads

/// The small, read-mostly slice that the standalone watch app can render.
/// These types intentionally live in the watch target instead of sharing the
/// iPhone target: a watch install must remain buildable and useful on its own.
struct WatchSnapshot: Codable, Equatable {
    var actions: [WatchAction]
    var homework: [WatchHomework]
    var shopping: [WatchShoppingItem]
    var updatedAt: Date?

    init(actions: [WatchAction] = [],
         homework: [WatchHomework] = [],
         shopping: [WatchShoppingItem] = [],
         updatedAt: Date? = nil) {
        self.actions = actions
        self.homework = homework
        self.shopping = shopping
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        actions = try container.decodeIfPresent([WatchAction].self, forKey: .actions) ?? []
        homework = try container.decodeIfPresent([WatchHomework].self, forKey: .homework) ?? []
        shopping = try container.decodeIfPresent([WatchShoppingItem].self, forKey: .shopping) ?? []
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
    }

    private enum CodingKeys: String, CodingKey {
        case actions, homework, shopping, updatedAt
    }

    /// Open actions are ordered by the server's due date fields. The string
    /// sort is deliberate: Fam ETC dates are ISO-like YYYY-MM-DD / HH:mm.
    var urgentActions: [WatchAction] {
        actions
            .filter { $0.status != "done" && $0.status != "snoozed" }
            .sorted { lhs, rhs in
                let left = WatchDateSortKey(date: lhs.dueDate, time: lhs.dueTime)
                let right = WatchDateSortKey(date: rhs.dueDate, time: rhs.dueTime)
                if left != right { return left < right }
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
    }

    var openHomework: [WatchHomework] {
        homework
            .filter { !$0.isDone }
            .sorted { lhs, rhs in
                let left = WatchDateSortKey(date: lhs.dueDate, time: lhs.dueTime)
                let right = WatchDateSortKey(date: rhs.dueDate, time: rhs.dueTime)
                if left != right { return left < right }
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
    }

    /// The one assignment the watch should put in front of a student. This
    /// deliberately reuses the existing due-date ordering instead of trying
    /// to infer urgency or rank work with a second heuristic.
    var focusHomework: WatchHomework? {
        openHomework.first
    }

    var openShopping: [WatchShoppingItem] {
        shopping
            .filter { !$0.done }
            .sorted { lhs, rhs in
                lhs.text.localizedCaseInsensitiveCompare(rhs.text) == .orderedAscending
            }
    }
}

private struct WatchDateSortKey: Comparable {
    private let value: String

    init(date: String?, time: String?) {
        value = "\(date ?? "9999-12-31")T\(time ?? "23:59")"
    }

    static func < (lhs: WatchDateSortKey, rhs: WatchDateSortKey) -> Bool {
        lhs.value < rhs.value
    }

    static func == (lhs: WatchDateSortKey, rhs: WatchDateSortKey) -> Bool {
        lhs.value == rhs.value
    }
}

/// Mirrors the server's `/api/family/actions` response, retaining only fields
/// that are useful to My next or needed for a safe cache round-trip.
struct WatchAction: Codable, Equatable, Identifiable {
    let id: String
    let familyId: String?
    var title: String
    var notes: String?
    var status: String
    var dueDate: String?
    var dueTime: String?
    var assigneeType: String?
    var assigneeId: String?
    var kidId: String?
    var sourceType: String?
    var sourceId: String?
    var createdAt: String?
    var updatedAt: String?
    var snoozedUntil: String?

    var isDone: Bool { status == "done" }
}

/// Mirrors the server's `/api/homework` item. Homework is kept separate from
/// actions because the server exposes a distinct status mutation and because a
/// kid session has a narrower visibility scope for it.
struct WatchChecklistItem: Codable, Equatable {
    var text: String
    var done: Bool

    init(text: String, done: Bool = false) {
        self.text = text
        self.done = done
    }
}

struct WatchHomework: Codable, Equatable, Identifiable {
    let id: String
    var kidId: String?
    var title: String
    var subject: String?
    var dueDate: String
    var dueTime: String?
    var status: String
    var effortMin: Int?
    var checklist: [WatchChecklistItem]

    init(id: String,
         kidId: String? = nil,
         title: String,
         subject: String? = nil,
         dueDate: String,
         dueTime: String? = nil,
         status: String,
         effortMin: Int? = nil,
         checklist: [WatchChecklistItem] = []) {
        self.id = id
        self.kidId = kidId
        self.title = title
        self.subject = subject
        self.dueDate = dueDate
        self.dueTime = dueTime
        self.status = status
        self.effortMin = effortMin
        self.checklist = checklist
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kidId = try container.decodeIfPresent(String.self, forKey: .kidId)
        title = try container.decode(String.self, forKey: .title)
        subject = try container.decodeIfPresent(String.self, forKey: .subject)
        dueDate = try container.decode(String.self, forKey: .dueDate)
        dueTime = try container.decodeIfPresent(String.self, forKey: .dueTime)
        status = try container.decode(String.self, forKey: .status)
        effortMin = try container.decodeIfPresent(Int.self, forKey: .effortMin)
        // The checklist was added after the first watch cache schema. Missing
        // data means that the assignment has no watch-visible steps.
        checklist = try container.decodeIfPresent([WatchChecklistItem].self, forKey: .checklist) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, kidId, title, subject, dueDate, dueTime, status, effortMin, checklist
    }

    var isDone: Bool { status == "done" }

    var completedChecklistCount: Int {
        checklist.reduce(into: 0) { count, item in
            if item.done { count += 1 }
        }
    }

    var firstIncompleteChecklistIndex: Int? {
        checklist.firstIndex(where: { !$0.done })
    }

    var firstIncompleteChecklistItem: WatchChecklistItem? {
        guard let index = firstIncompleteChecklistIndex else { return nil }
        return checklist[index]
    }

    /// Short aliases keep the projection readable at call sites that speak
    /// about a project's next step rather than its wire-format checklist.
    var firstIncompleteStepIndex: Int? { firstIncompleteChecklistIndex }
    var firstIncompleteStep: WatchChecklistItem? { firstIncompleteChecklistItem }
}

/// The server calls shopping fields `text` and `done`. Older native payloads
/// used `name` and `checked`, so decoding accepts both shapes while all new
/// cache writes use the server's canonical names.
struct WatchShoppingItem: Codable, Equatable, Identifiable {
    let id: String
    var text: String
    var category: String?
    var done: Bool
    var assigneeUserId: String?
    var createdAt: String?

    init(id: String,
         text: String,
         category: String? = nil,
         done: Bool = false,
         assigneeUserId: String? = nil,
         createdAt: String? = nil) {
        self.id = id
        self.text = text
        self.category = category
        self.done = done
        self.assigneeUserId = assigneeUserId
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        if let serverText = try container.decodeIfPresent(String.self, forKey: .text) {
            text = serverText
        } else {
            text = try container.decodeIfPresent(String.self, forKey: .name) ?? ""
        }
        category = try container.decodeIfPresent(String.self, forKey: .category)
        if let serverDone = try container.decodeIfPresent(Bool.self, forKey: .done) {
            done = serverDone
        } else {
            done = try container.decodeIfPresent(Bool.self, forKey: .checked) ?? false
        }
        assigneeUserId = try container.decodeIfPresent(String.self, forKey: .assigneeUserId)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(text, forKey: .text)
        try container.encodeIfPresent(category, forKey: .category)
        try container.encode(done, forKey: .done)
        try container.encodeIfPresent(assigneeUserId, forKey: .assigneeUserId)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
    }

    private enum CodingKeys: String, CodingKey {
        case id, text, name, category, done, checked, assigneeUserId, createdAt
    }
}

// MARK: - Durable mutation ledger

enum WatchMutationKind: String, Codable {
    case actionStatus
    case homeworkStatus
    case shoppingDone
    case homeworkChecklistStep
}

/// One user mutation in the durable outbox. The entry is written before any
/// network request starts, so a killed watch process cannot lose a check-off.
struct WatchMutation: Codable, Equatable, Identifiable {
    let id: UUID
    let kind: WatchMutationKind
    let resourceID: String
    let stringValue: String?
    let boolValue: Bool?
    let index: Int?
    let createdAt: Date

    init(id: UUID = UUID(),
         kind: WatchMutationKind,
         resourceID: String,
         stringValue: String? = nil,
         boolValue: Bool? = nil,
         index: Int? = nil,
         createdAt: Date = Date()) {
        self.id = id
        self.kind = kind
        self.resourceID = resourceID
        self.stringValue = stringValue
        self.boolValue = boolValue
        self.index = index
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        kind = try container.decode(WatchMutationKind.self, forKey: .kind)
        resourceID = try container.decode(String.self, forKey: .resourceID)
        stringValue = try container.decodeIfPresent(String.self, forKey: .stringValue)
        boolValue = try container.decodeIfPresent(Bool.self, forKey: .boolValue)
        // The index is absent from schema-1 mutation records.
        index = try container.decodeIfPresent(Int.self, forKey: .index)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(resourceID, forKey: .resourceID)
        try container.encodeIfPresent(stringValue, forKey: .stringValue)
        try container.encodeIfPresent(boolValue, forKey: .boolValue)
        try container.encodeIfPresent(index, forKey: .index)
        try container.encode(createdAt, forKey: .createdAt)
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, resourceID, stringValue, boolValue, index, createdAt
    }
}

/// A local focus block is intentionally a small timestamped record. It is
/// not a background timer and contains only a title snapshot for the watch's
/// in-app display; the canonical assignment remains the server's homework.
struct WatchFocusSession: Codable, Equatable, Identifiable {
    static let duration: TimeInterval = 20 * 60

    let id: UUID
    let homeworkID: String
    let checklistIndex: Int?
    let titleSnapshot: String
    let startedAt: Date
    let duration: TimeInterval
    var completionAcknowledged: Bool

    init(id: UUID = UUID(),
         homeworkID: String,
         checklistIndex: Int? = nil,
         titleSnapshot: String,
         startedAt: Date = Date(),
         duration: TimeInterval = WatchFocusSession.duration,
         completionAcknowledged: Bool = false) {
        self.id = id
        self.homeworkID = homeworkID
        self.checklistIndex = checklistIndex
        self.titleSnapshot = titleSnapshot
        self.startedAt = startedAt
        self.duration = duration
        self.completionAcknowledged = completionAcknowledged
    }

    var endsAt: Date { startedAt.addingTimeInterval(duration) }

    func remaining(at date: Date = Date()) -> TimeInterval {
        max(0, endsAt.timeIntervalSince(date))
    }

    func isComplete(at date: Date = Date()) -> Bool {
        date >= endsAt
    }

    var hasChecklistStep: Bool { checklistIndex != nil }
}

struct WatchPersistedState: Codable, Equatable {
    static let currentSchemaVersion = 2

    let schemaVersion: Int
    var snapshot: WatchSnapshot
    var outbox: [WatchMutation]
    var focusSession: WatchFocusSession?

    init(snapshot: WatchSnapshot = WatchSnapshot(),
         outbox: [WatchMutation] = [],
         focusSession: WatchFocusSession? = nil,
         schemaVersion: Int = WatchPersistedState.currentSchemaVersion) {
        self.schemaVersion = schemaVersion
        self.snapshot = snapshot
        self.outbox = outbox
        self.focusSession = focusSession
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion)
            ?? WatchPersistedState.currentSchemaVersion
        snapshot = try container.decodeIfPresent(WatchSnapshot.self, forKey: .snapshot)
            ?? WatchSnapshot()
        outbox = try container.decodeIfPresent([WatchMutation].self, forKey: .outbox) ?? []
        focusSession = try container.decodeIfPresent(WatchFocusSession.self, forKey: .focusSession)
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, snapshot, outbox, focusSession
    }
}
