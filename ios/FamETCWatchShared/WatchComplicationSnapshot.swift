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

    init(urgentCount: Int = 0,
         homeworkCount: Int = 0,
         shoppingCount: Int = 0,
         updatedAt: Date? = nil) {
        self.urgentCount = max(0, urgentCount)
        self.homeworkCount = max(0, homeworkCount)
        self.shoppingCount = max(0, shoppingCount)
        self.updatedAt = updatedAt
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
