import Foundation

/// The only data shared with the WidgetKit extension. It is deliberately a
/// small aggregate rather than the action/homework/shopping payloads, so the
/// complication never needs a credential or a network request.
struct FamETCWatchComplicationSnapshot: Codable, Equatable {
    static let appGroup = "group.com.fametc.watch"
    static let storageKey = "fametc.watch.complication.snapshot"

    let urgentCount: Int
    let homeworkCount: Int
    let shoppingCount: Int
    let updatedAt: Date?
    /// Aggregate-only focus state. No homework title, assignment id, or
    /// checklist text is written to the shared complication store.
    let focusActive: Bool
    let focusEndsAt: Date?

    init(urgentCount: Int = 0,
         homeworkCount: Int = 0,
         shoppingCount: Int = 0,
         updatedAt: Date? = nil,
         focusActive: Bool = false,
         focusEndsAt: Date? = nil) {
        self.urgentCount = max(0, urgentCount)
        self.homeworkCount = max(0, homeworkCount)
        self.shoppingCount = max(0, shoppingCount)
        self.updatedAt = updatedAt
        self.focusActive = focusActive
        self.focusEndsAt = focusEndsAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        urgentCount = max(0, try container.decodeIfPresent(Int.self, forKey: .urgentCount) ?? 0)
        homeworkCount = max(0, try container.decodeIfPresent(Int.self, forKey: .homeworkCount) ?? 0)
        shoppingCount = max(0, try container.decodeIfPresent(Int.self, forKey: .shoppingCount) ?? 0)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        // These fields were added after the original aggregate payload. Old
        // JSON remains valid and simply represents an inactive focus state.
        focusActive = try container.decodeIfPresent(Bool.self, forKey: .focusActive) ?? false
        focusEndsAt = try container.decodeIfPresent(Date.self, forKey: .focusEndsAt)
    }

    private enum CodingKeys: String, CodingKey {
        case urgentCount, homeworkCount, shoppingCount, updatedAt, focusActive, focusEndsAt
    }

    func isFocusActive(at date: Date = Date()) -> Bool {
        focusActive && (focusEndsAt == nil || date < focusEndsAt!)
    }

    static let empty = FamETCWatchComplicationSnapshot()
}

enum WatchComplicationSnapshotStore {
    static func load(defaults: UserDefaults = UserDefaults(suiteName: FamETCWatchComplicationSnapshot.appGroup) ?? .standard) -> FamETCWatchComplicationSnapshot {
        guard let data = defaults.data(forKey: FamETCWatchComplicationSnapshot.storageKey),
              let snapshot = try? JSONDecoder().decode(FamETCWatchComplicationSnapshot.self, from: data) else {
            return .empty
        }
        return snapshot
    }

    static func save(_ snapshot: FamETCWatchComplicationSnapshot,
                     defaults: UserDefaults = UserDefaults(suiteName: FamETCWatchComplicationSnapshot.appGroup) ?? .standard) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: FamETCWatchComplicationSnapshot.storageKey)
    }
}
