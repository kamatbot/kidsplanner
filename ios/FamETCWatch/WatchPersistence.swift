import Foundation

protocol WatchPersistence {
    func load() -> WatchPersistedState?
    func save(_ state: WatchPersistedState)
    func clear()
}

/// Application-support storage is intentionally one file: the snapshot and
/// mutation ledger must advance together. Atomic writes keep a power loss from
/// leaving a fresh cache paired with an older outbox (or vice versa).
struct FileWatchPersistence: WatchPersistence {
    let fileURL: URL

    init(fileURL: URL? = nil) {
        if let fileURL {
            self.fileURL = fileURL
            return
        }

        let directory = (try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? FileManager.default.temporaryDirectory
        self.fileURL = directory.appendingPathComponent("fametc-watch-state.json")
    }

    func load() -> WatchPersistedState? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(WatchPersistedState.self, from: data)
    }

    func save(_ state: WatchPersistedState) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: fileURL, options: .atomic)
        } catch {
            // A cache write must never take down the watch UI. The in-memory
            // state remains usable and the next mutation retries persistence.
        }
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
