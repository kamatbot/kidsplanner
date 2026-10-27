import AVFoundation
import Foundation

/// Which voice notes this watch has played (client-local only, per the
/// voice contract). Drives the unplayed dot on other people's notes.
@MainActor
final class WatchVoicePlayedStore: ObservableObject {
    static let shared = WatchVoicePlayedStore()
    private static let key = "fametc.watch.voicePlayed"
    private let defaults: UserDefaults
    @Published private(set) var played: [String]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        played = defaults.stringArray(forKey: Self.key) ?? []
    }

    func isPlayed(_ id: String) -> Bool { played.contains(id) }

    func markPlayed(_ id: String) {
        guard !played.contains(id) else { return }
        played = Array((played + [id]).suffix(300))
        defaults.set(played, forKey: Self.key)
    }
}

/// Downloads a voice note over the watch's bearer (never a public URL),
/// caches it in Caches, and plays it through the watch speaker.
@MainActor
final class WatchVoicePlayer: ObservableObject {
    enum State: Equatable { case idle, loading, playing, paused, failed(String) }

    @Published private(set) var state: State = .idle
    @Published private(set) var currentTime: TimeInterval = 0
    @Published private(set) var duration: TimeInterval = 0

    private var player: AVAudioPlayer?
    private var tick: Task<Void, Never>?
    private let clientFactory: () -> WatchVoiceClient

    init(clientFactory: @escaping () -> WatchVoiceClient = { URLSessionWatchAPIClient() }) {
        self.clientFactory = clientFactory
    }

    var progress: Double { duration > 0 ? min(1, currentTime / duration) : 0 }

    static var cacheDirectory: URL {
        ((try? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory).appendingPathComponent("fametc-voice-cache", isDirectory: true)
    }

    static func clearCache() {
        try? FileManager.default.removeItem(at: cacheDirectory)
    }

    /// Plays `message`, downloading it first when needed. `localFile` plays a
    /// note still waiting in the outbox.
    func play(_ message: WatchChatMessage, localFile: URL? = nil) async {
        if state == .paused, player != nil { resume(); return }
        stop()
        duration = TimeInterval(message.media?.durationMs ?? 0) / 1000
        state = .loading
        do {
            let file: URL
            if let localFile { file = localFile } else { file = try await cachedFile(for: message) }
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            let player = try AVAudioPlayer(contentsOf: file)
            player.prepareToPlay()
            guard player.play() else { throw WatchAPIError.transport("Playback did not start.") }
            self.player = player
            if player.duration > 0 { duration = player.duration }
            state = .playing
            WatchVoicePlayedStore.shared.markPlayed(message.id)
            startTicking()
        } catch is CancellationError {
            state = .idle
        } catch {
            state = .failed(Self.message(for: error))
        }
    }

    func pause() {
        guard let player, player.isPlaying else { return }
        player.pause()
        tick?.cancel()
        state = .paused
    }

    func resume() {
        guard let player else { return }
        if player.play() { state = .playing; startTicking() }
    }

    func stop() {
        tick?.cancel()
        tick = nil
        player?.stop()
        player = nil
        currentTime = 0
        if state != .idle { state = .idle }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func startTicking() {
        tick?.cancel()
        tick = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self, let player = self.player else { return }
                self.currentTime = player.currentTime
                if !player.isPlaying {
                    // Finished: leave the bar full, ready to play again.
                    self.currentTime = self.duration
                    self.player = nil
                    self.state = .idle
                    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                    return
                }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
    }

    private func cachedFile(for message: WatchChatMessage) async throws -> URL {
        guard let id = message.media?.attachmentId, !id.isEmpty,
              id.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }) else {
            throw WatchAPIError.decoding("This voice message has no audio.")
        }
        let directory = Self.cacheDirectory
        let file = directory.appendingPathComponent("\(id).m4a")
        if FileManager.default.fileExists(atPath: file.path) { return file }
        let data = try await clientFactory().downloadAttachment(id)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return file
    }

    private static func message(for error: Error) -> String {
        switch error {
        case WatchAPIError.forbidden: return "Voice messages need a newer Fam ETC server."
        case WatchAPIError.transport, WatchAPIError.timedOut: return "Can't load it right now. Try again."
        default: return "Couldn't play this voice message."
        }
    }
}
