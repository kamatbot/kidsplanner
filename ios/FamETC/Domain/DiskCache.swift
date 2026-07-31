import Foundation

/// Cache-first cold start payload: the signed-in user, their family, and a
/// recent slice of chat.
struct CachedAppData: Codable {
    var family: Family?
    var messages: [ChatMessage]   // family room only — kept for downgrade safety (see messagesByRoom)
    var me: User?   // optional for back-compat with caches written before this field
    /// Trips (docs/TRIPS-PLAN.md) multi-room chat cache, keyed by room id.
    /// Optional for back-compat: a cache written before Trips shipped decodes
    /// this as nil, and `AppStore.load()` falls back to `messages` (the family
    /// room) in that case. The app keeps writing `messages` alongside this
    /// field so a build predating this field (a TestFlight rollback) still
    /// finds its family-room history.
    var messagesByRoom: [String: [ChatMessage]]? = nil
}

/// Persists the last-known family/chat data so the app renders instantly on cold
/// start (no launch spinner), then refreshes from the network in the background.
struct DiskCache {
    private let fileURL: URL = {
        let dir = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("fametc-cache.json")
    }()

    func load() -> CachedAppData? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(CachedAppData.self, from: data)
    }

    func save(_ appData: CachedAppData) {
        guard let data = try? JSONEncoder().encode(appData) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
