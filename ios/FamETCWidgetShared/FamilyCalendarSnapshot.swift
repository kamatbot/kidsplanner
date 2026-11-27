import AppIntents
import Foundation

/// The family calendar as the Home Screen and Lock Screen calendar widgets see
/// it: upcoming events only, already scoped to what the signed-in person may
/// see in the app (a kid gets family-wide events plus their own). The app is
/// the only writer. No notes, locations, tokens or invite codes are stored.
struct FamilyCalendarSnapshot: Codable, Equatable {
    static let appGroup = FamilyAssistanceSnapshot.appGroup
    static let widgetKind = "FamETCCalendarWidget"
    /// Older than this, the widget asks for the app to be opened.
    static let staleAfter: TimeInterval = 24 * 60 * 60

    let accountID: String
    let familyID: String
    let generatedAt: Date
    let members: [FamilyCalendarMember]
    let events: [FamilyCalendarEvent]

    func member(id: String?) -> FamilyCalendarMember? {
        guard let id else { return nil }
        return members.first { $0.id == id }
    }

    /// Events still worth showing at `date`, optionally narrowed to one family
    /// member (their own events plus family-wide ones).
    func upcoming(at date: Date, memberID: String? = nil, calendar: Calendar = .current) -> [FamilyCalendarEvent] {
        let today = FamilyCalendarEvent.dayKey(date, calendar: calendar)
        return events.filter { event in
            if let memberID, event.memberID != nil, event.memberID != memberID { return false }
            if event.allDay || event.start == nil { return event.lastDayKey >= today }
            return event.effectiveEnd > date
        }
    }
}

struct FamilyCalendarMember: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let colorHex: String?
}

struct FamilyCalendarEvent: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    /// yyyy-MM-dd of the first day, local to the device that wrote it.
    let dayKey: String
    /// Last day of a multi-day event (nil = single day).
    let endDayKey: String?
    let start: Date?
    let end: Date?
    let allDay: Bool
    /// Kid profile id; nil means a family-wide event.
    let memberID: String?
    /// "school", "sports", "arts", "social", "deadline" or nil. Picks the icon.
    var category: String? = nil

    var lastDayKey: String { max(endDayKey ?? dayKey, dayKey) }

    /// Timed events without an end are treated as one hour long.
    var effectiveEnd: Date {
        if let end, let start, end > start { return end }
        return (start ?? .distantPast).addingTimeInterval(60 * 60)
    }

    static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func date(fromDayKey key: String, calendar: Calendar = .current) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}

enum FamilyCalendarSnapshotStore {
    static var sharedURL: URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: FamilyCalendarSnapshot.appGroup
        )?.appendingPathComponent("family-calendar.snapshot", isDirectory: false)
    }

    static func load(url: URL? = sharedURL) -> FamilyCalendarSnapshot? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try? decoder.decode(FamilyCalendarSnapshot.self, from: data)
    }

    static func save(_ snapshot: FamilyCalendarSnapshot, url: URL? = sharedURL) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        guard let url, let data = try? encoder.encode(snapshot) else { return }
        // Readable after the first unlock so Lock Screen widgets keep working
        // while the phone is locked (complete protection would blank them).
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func clear(url: URL? = sharedURL) {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

enum FamilyCalendarRoute {
    /// Opens the Calendar tab on `dayKey` (RootView handles famRoute=calendar).
    static func url(dayKey: String?) -> URL? {
        var components = URLComponents(string: "https://www.fametc.com/")
        var items = [URLQueryItem(name: "famRoute", value: "calendar"),
                     URLQueryItem(name: "source", value: "widget")]
        if let dayKey { items.append(URLQueryItem(name: "day", value: dayKey)) }
        components?.queryItems = items
        return components?.url
    }

    /// The day a calendar route asks for, or nil when the URL is not one.
    static func dayKey(from url: URL) -> String?? {
        guard url.scheme == "https", let host = url.host?.lowercased(),
              ["fametc.com", "www.fametc.com"].contains(host), url.path == "/" || url.path.isEmpty,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.first(where: { $0.name == "famRoute" })?.value == "calendar" else {
            return nil
        }
        let day = components.queryItems?.first(where: { $0.name == "day" })?.value
        guard let day, day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
            return .some(nil)
        }
        return .some(day)
    }
}

/// "Whose events" choice for the calendar widget. Nil = everyone.
struct FamilyCalendarMemberEntity: AppEntity, Identifiable, Hashable {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Family member")
    static let defaultQuery = FamilyCalendarMemberQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct FamilyCalendarMemberQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [FamilyCalendarMemberEntity] {
        let wanted = Set(identifiers)
        return all().filter { wanted.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [FamilyCalendarMemberEntity] {
        all().filter { string.isEmpty || $0.name.localizedCaseInsensitiveContains(string) }
    }

    func suggestedEntities() async throws -> [FamilyCalendarMemberEntity] { all() }

    private func all() -> [FamilyCalendarMemberEntity] {
        (FamilyCalendarSnapshotStore.load()?.members ?? [])
            .map { FamilyCalendarMemberEntity(id: $0.id, name: $0.name) }
    }
}
