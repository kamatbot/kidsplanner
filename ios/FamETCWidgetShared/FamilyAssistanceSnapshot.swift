import AppIntents
import Foundation

/// A deliberately small, credential-free projection for Siri and WidgetKit.
/// The parent app is the only writer. The extension never receives cookies,
/// tokens, notes, locations, invite codes, or full family records.
struct FamilyAssistanceSnapshot: Codable, Equatable {
    static let appGroup = "group.com.fametc.app.family-assistance"
    static let maximumAge: TimeInterval = 45 * 60

    let accountID: String
    let familyID: String
    let generatedAt: Date
    let expiresAt: Date
    let dayKey: String
    let timeZoneIdentifier: String
    let children: [FamilyAssistanceChild]

    func isFresh(at date: Date = Date(), calendar: Calendar = .current) -> Bool {
        var localCalendar = calendar
        localCalendar.timeZone = calendar.timeZone
        return generatedAt <= date.addingTimeInterval(5 * 60) && date <= expiresAt &&
            date.timeIntervalSince(generatedAt) <= Self.maximumAge &&
            Self.dayKey(date, calendar: localCalendar) == dayKey &&
            localCalendar.timeZone.identifier == timeZoneIdentifier
    }

    func child(id: String) -> FamilyAssistanceChild? {
        children.first { $0.id == id }
    }

    private static func dayKey(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}

struct FamilyAssistanceChild: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let colorHex: String?
    let nextActivity: FamilyAssistanceItem?
    let todayActivities: [FamilyAssistanceItem]
    let tomorrowActivities: [FamilyAssistanceItem]
    let todayHomework: [FamilyAssistanceItem]
    let tomorrowHomework: [FamilyAssistanceItem]
    let todayActivityCount: Int
    let tomorrowActivityCount: Int
    let todayHomeworkCount: Int
    let tomorrowHomeworkCount: Int
    let dailyFive: FamilyDailyFiveProgress?
    let expectedHomeTime: String?
    let calendarAvailable: Bool
    let homeworkAvailable: Bool
    let dailyFiveAvailable: Bool
}

struct FamilyChildInsightSnapshot {
    let dailyFive: FamilyDailyFiveProgress
    let expectedHomeTime: String?
}

enum FamilyAssistancePresentation {
    static func homeworkText(_ child: FamilyAssistanceChild, dayKey: String) -> String {
        guard child.homeworkAvailable else { return "Homework unavailable" }
        if let item = child.todayHomework.first {
            return item.dateKey < dayKey ? "\(item.title) · overdue" : "\(item.title) · due today"
        }
        if let item = child.tomorrowHomework.first { return "\(item.title) · due tomorrow" }
        return "No open homework due today or tomorrow"
    }
}

struct FamilyAssistanceItem: Codable, Equatable, Identifiable {
    enum Kind: String, Codable { case activity, homework }

    let id: String
    let kind: Kind
    let title: String
    let dateKey: String
    let startsAt: Date?
    let timeText: String?
}

struct FamilyDailyFiveProgress: Codable, Equatable {
    let completed: Int
    let started: Int
    let total: Int

    var summary: String {
        if completed >= total { return "Daily 5 complete" }
        if started > 0 { return "Daily 5: \(completed) of \(total) complete, \(started) in progress" }
        return "Daily 5: \(completed) of \(total) complete"
    }
}

enum FamilyAssistanceSnapshotStore {
    static var sharedURL: URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: FamilyAssistanceSnapshot.appGroup
        )?.appendingPathComponent("family-assistance.snapshot", isDirectory: false)
    }

    static func load(url: URL? = sharedURL) -> FamilyAssistanceSnapshot? {
        guard let url,
              let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(FamilyAssistanceSnapshot.self, from: data) else {
            return nil
        }
        return snapshot
    }

    static func save(_ snapshot: FamilyAssistanceSnapshot, url: URL? = sharedURL) {
        guard let url, let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
    }

    static func clear(url: URL? = sharedURL) {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

struct FamilyChildEntity: AppEntity, Identifiable, Hashable {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Child")
    static let defaultQuery = FamilyChildQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct FamilyChildQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [FamilyChildEntity] {
        guard let snapshot = FamilyAssistanceSnapshotStore.load(), snapshot.isFresh() else { return [] }
        let wanted = Set(identifiers)
        return snapshot.children.filter { wanted.contains($0.id) }
            .map { FamilyChildEntity(id: $0.id, name: $0.name) }
    }

    func entities(matching string: String) async throws -> [FamilyChildEntity] {
        guard let snapshot = FamilyAssistanceSnapshotStore.load(), snapshot.isFresh() else { return [] }
        return snapshot.children
            .filter { string.isEmpty || $0.name.localizedCaseInsensitiveContains(string) }
            .map { FamilyChildEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [FamilyChildEntity] {
        try await entities(matching: "")
    }
}

enum FamilyAssistanceRoute {
    /// RootView integration should recognize this universal-link query and open
    /// Today with the matching child selected. Unknown ids must be ignored.
    static func todayURL(childID: String) -> URL? {
        var components = URLComponents(string: "https://www.fametc.com/")
        components?.queryItems = [
            URLQueryItem(name: "famRoute", value: "today"),
            URLQueryItem(name: "childId", value: childID),
            URLQueryItem(name: "source", value: "widget")
        ]
        return components?.url
    }
}
