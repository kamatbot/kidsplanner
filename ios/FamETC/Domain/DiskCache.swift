import Foundation

/// Cache-first cold start payload: the family + a recent slice of chat.
struct CachedAppData: Codable {
    var family: Family?
    var messages: [ChatMessage]
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
