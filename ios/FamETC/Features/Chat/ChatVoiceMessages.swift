import AVFoundation
import Foundation
import SwiftUI
import UIKit

// MARK: - Voice messages (docs/VOICE-MESSAGES.md)
//
// Recording: AVAudioRecorder, AAC in .m4a, mono 22 050 Hz ~32 kbps, 60 s cap.
// The clip goes through the normal private attachment upload (as audio/mp4
// with a `durationMs` field), then a normal chat message carries the returned
// descriptor with empty text — exactly like a photo.
// Playback: one clip at a time, AVAudioPlayer over the same authenticated,
// session-local attachment cache that photo previews and Quick Look use.

// MARK: Pure helpers

enum ChatVoiceMessage {
    static let mimeType = "audio/mp4"
    static let uploadFilename = "voice.m4a"
    static let maxDuration: TimeInterval = 60
    static let minDurationMs = 500
    static let maxDurationMs = 60_000
    /// Chat preview / notification text for an audio message with no text.
    static let previewText = "🎤 Voice message"

    /// The `durationMs` multipart value for a recording, or nil when the clip
    /// is too short for the server's 500–60000 ms window.
    static func uploadDurationMs(seconds: TimeInterval) -> Int? {
        guard seconds.isFinite, seconds > 0 else { return nil }
        let ms = Int((seconds * 1000).rounded())
        guard ms >= minDurationMs else { return nil }
        return min(ms, maxDurationMs)
    }

    /// "0:06", "1:00" — whole seconds, rounded down (elapsed time).
    static func clock(seconds: TimeInterval) -> String {
        let whole = seconds.isFinite ? max(0, Int(seconds.rounded(.down))) : 0
        return String(format: "%ld:%02ld", whole / 60, whole % 60)
    }

    /// A clip's total length for the bubble ("0:06" for 6200 ms). A non-empty
    /// clip never reads as 0:00.
    static func durationLabel(ms: Int?) -> String {
        guard let ms, ms > 0 else { return "0:00" }
        let whole = max(1, Int((Double(ms) / 1000).rounded()))
        return clock(seconds: TimeInterval(whole))
    }

    /// VoiceOver wording: "6 seconds", "1 minute", "1 minute 5 seconds".
    static func spokenDuration(ms: Int?) -> String {
        let whole = max(0, Int((Double(ms ?? 0) / 1000).rounded()))
        let minutes = whole / 60
        let seconds = whole % 60
        var parts: [String] = []
        if minutes > 0 { parts.append(minutes == 1 ? "1 minute" : "\(minutes) minutes") }
        if seconds > 0 || minutes == 0 { parts.append(seconds == 1 ? "1 second" : "\(seconds) seconds") }
        return parts.joined(separator: " ")
    }

    /// Playback progress 0...1, safe for unknown or zero durations.
    static func progress(elapsed: TimeInterval, duration: TimeInterval) -> Double {
        guard elapsed.isFinite, duration.isFinite, duration > 0 else { return 0 }
        return min(1, max(0, elapsed / duration))
    }

    /// Maps AVAudioRecorder average power (dBFS, -160...0) to a 0...1 meter level.
    static func meterLevel(decibels: Float) -> Double {
        guard decibels.isFinite else { return 0 }
        let floor: Float = -50
        if decibels <= floor { return 0 }
        if decibels >= 0 { return 1 }
        return Double((decibels - floor) / -floor)
    }

    /// Decorative, deterministic waveform-style bar heights (0.25...1) for a
    /// clip. Seeded by a stable FNV-1a hash so a bubble looks the same on
    /// every launch (Swift's `hashValue` is randomized per process).
    static func waveform(seed: String, count: Int) -> [Double] {
        guard count > 0 else { return [] }
        var state: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in seed.utf8 {
            state ^= UInt64(byte)
            state = state &* 0x0000_0100_0000_01b3
        }
        if state == 0 { state = 0x9e37_79b9_7f4a_7c15 }
        var bars: [Double] = []
        bars.reserveCapacity(count)
        for _ in 0..<count {
            state ^= state << 13
            state ^= state >> 7
            state ^= state << 17
            bars.append(0.25 + Double(state % 1000) / 999.0 * 0.75)
        }
        return bars
    }
}

extension ChatMedia {
    /// A private chat attachment carrying a voice recording.
    var isVoiceMessage: Bool { isChatAttachment && attachmentKind == "audio" }
}

extension ChatMessage {
    /// One-line summary for previews and notification-style surfaces. Mirrors
    /// the server's push wording (lib/routes/chat.js `notificationText`).
    var previewText: String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        guard let media else { return "Sent a message" }
        if media.type == "gif" { return "Sent a GIF" }
        guard media.isChatAttachment else { return "Sent a message" }
        switch media.attachmentKind {
        case "audio": return ChatVoiceMessage.previewText
        case "photo": return "Sent a photo"
        case "video": return "Sent a video"
        default:
            let name = media.filename?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return name.isEmpty ? "Sent a file" : "Sent \(name)"
        }
    }
}

/// Client-local "already listened" log for the unplayed dot. Scoped per
/// account and bounded so it never grows without limit.
enum ChatVoicePlayedLog {
    static let limit = 400

    static func key(accountId: String) -> String { "fam_voice_played_\(accountId)" }

    static func appending(_ id: String, to ids: [String], limit: Int = ChatVoicePlayedLog.limit) -> [String] {
        var next = ids.filter { $0 != id }
        next.append(id)
        if next.count > limit { next.removeFirst(next.count - limit) }
        return next
    }
}

enum ChatVoiceError: LocalizedError {
    case recordingFailed
    case playbackFailed

    var errorDescription: String? {
        switch self {
        case .recordingFailed: return "Couldn't start recording. Please try again."
        case .playbackFailed: return "Couldn't play this voice message."
        }
    }
}

// MARK: - Recorder

@MainActor
@Observable
final class ChatVoiceRecorder {
    enum Permission { case undetermined, granted, denied }

    struct Clip {
        let url: URL
        let durationMs: Int
    }

    nonisolated static let meterBarCount = 18

    private(set) var isRecording = false
    private(set) var elapsed: TimeInterval = 0
    private(set) var levels: [Double] = Array(repeating: 0, count: ChatVoiceRecorder.meterBarCount)
    /// Flips true once the 60 s cap is hit; the composer auto-sends.
    private(set) var reachedLimit = false
    /// Flips true when a call/Siri/another app takes the microphone; the clip
    /// is discarded and the composer explains why.
    private(set) var wasInterrupted = false

    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var fileURL: URL?
    @ObservationIgnored private var meterTask: Task<Void, Never>?
    @ObservationIgnored private var interruptionObserver: NSObjectProtocol?

    static var permission: Permission {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        default: return .undetermined
        }
    }

    static func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func start() throws {
        guard !isRecording else { return }
        let session = AVAudioSession.sharedInstance()
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("fam-voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 22_050.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let next = try AVAudioRecorder(url: url, settings: settings)
            next.isMeteringEnabled = true
            guard next.prepareToRecord(), next.record() else { throw ChatVoiceError.recordingFailed }
            recorder = next
        } catch {
            try? FileManager.default.removeItem(at: url)
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw error
        }
        fileURL = url
        elapsed = 0
        levels = Array(repeating: 0, count: Self.meterBarCount)
        reachedLimit = false
        wasInterrupted = false
        isRecording = true
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: session,
            queue: .main
        ) { [weak self] notification in
            let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw.flatMap(AVAudioSession.InterruptionType.init(rawValue:)) == .began else { return }
            MainActor.assumeIsolated { self?.handleInterruption() }
        }
        meterTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                guard let self else { return }
                self.tick()
            }
        }
    }

    /// Stops recording and hands back the clip, or nil (file removed) when it
    /// is shorter than the server's 0.5 s minimum.
    func finish() -> Clip? {
        guard let recorder, let url = fileURL else { return nil }
        let seconds = recorder.currentTime   // reset to 0 by stop()
        recorder.stop()
        teardown()
        guard let ms = ChatVoiceMessage.uploadDurationMs(seconds: seconds) else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        return Clip(url: url, durationMs: ms)
    }

    func cancel() {
        guard let recorder else { return }
        recorder.stop()
        _ = recorder.deleteRecording()
        if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
        teardown()
    }

    func acknowledgeInterruption() { wasInterrupted = false }

    private func handleInterruption() {
        guard isRecording else { return }
        cancel()
        wasInterrupted = true
    }

    private func tick() {
        guard isRecording, let recorder else { return }
        recorder.updateMeters()
        var next = levels
        if !next.isEmpty { next.removeFirst() }
        next.append(ChatVoiceMessage.meterLevel(decibels: recorder.averagePower(forChannel: 0)))
        levels = next
        elapsed = recorder.currentTime
        if elapsed >= ChatVoiceMessage.maxDuration && !reachedLimit { reachedLimit = true }
    }

    private func teardown() {
        meterTask?.cancel()
        meterTask = nil
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
        interruptionObserver = nil
        recorder = nil
        fileURL = nil
        isRecording = false
        elapsed = 0
        reachedLimit = false
        levels = Array(repeating: 0, count: Self.meterBarCount)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// MARK: - Player (one clip at a time)

@MainActor
@Observable
final class ChatVoicePlayer {
    static let shared = ChatVoicePlayer()

    /// The message whose clip is loaded (playing or paused).
    private(set) var activeKey: String?
    /// The message whose clip is downloading.
    private(set) var loadingKey: String?
    private(set) var isPlaying = false
    private(set) var elapsed: TimeInterval = 0
    private(set) var duration: TimeInterval = 0
    /// The last clip that played through to its end; drives quick reactions.
    private(set) var finishedKey: String?
    private var playedRevision = 0

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var progressTask: Task<Void, Never>?
    private let delegate = ChatVoicePlayerDelegate()
    @ObservationIgnored private var playedCache: [String: Set<String>] = [:]
    private let defaults: UserDefaults
    @ObservationIgnored private var interruptionObserver: NSObjectProtocol?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        delegate.onFinish = { [weak self] in self?.playbackFinished() }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw.flatMap(AVAudioSession.InterruptionType.init(rawValue:)) == .began else { return }
            MainActor.assumeIsolated {
                if self?.isPlaying == true { self?.pause() }
            }
        }
    }

    // MARK: Unplayed state (client-local)

    func isPlayed(_ messageId: String, accountId: String?) -> Bool {
        _ = playedRevision   // observe changes made by markPlayed
        guard let accountId, !accountId.isEmpty else { return true }
        if let cached = playedCache[accountId] { return cached.contains(messageId) }
        let ids = Set(defaults.stringArray(forKey: ChatVoicePlayedLog.key(accountId: accountId)) ?? [])
        playedCache[accountId] = ids
        return ids.contains(messageId)
    }

    func markPlayed(_ messageId: String, accountId: String?) {
        guard let accountId, !accountId.isEmpty else { return }
        let key = ChatVoicePlayedLog.key(accountId: accountId)
        let current = defaults.stringArray(forKey: key) ?? []
        guard !current.contains(messageId) else { return }
        let next = ChatVoicePlayedLog.appending(messageId, to: current)
        defaults.set(next, forKey: key)
        playedCache[accountId] = Set(next)
        playedRevision &+= 1
    }

    // MARK: Transport

    /// Play/pause `key`'s clip, stopping any other clip first. Downloads
    /// through the authenticated attachment cache on first play.
    func toggle(key: String, path: String, filename: String) async throws {
        if activeKey == key, let player {
            if player.isPlaying { pause() } else { try resume(player) }
            return
        }
        stop()
        loadingKey = key
        defer { if loadingKey == key { loadingKey = nil } }
        let local = try await ChatAttachmentLocalCache.shared.localURL(path: path, filename: filename)
        // Another clip was chosen (or playback stopped) while downloading.
        guard loadingKey == key else { return }
        let next = try AVAudioPlayer(contentsOf: local)
        next.delegate = delegate
        next.prepareToPlay()
        player = next
        activeKey = key
        duration = next.duration
        elapsed = 0
        finishedKey = nil
        do {
            try resume(next)
        } catch {
            stop()
            throw error
        }
    }

    func pause() {
        player?.pause()
        isPlaying = false
        stopProgress()
        if let player { elapsed = player.currentTime }
    }

    /// Stops and unloads the current clip. Leaves the audio session alone
    /// when nothing was loaded, so it never cuts off an active recording.
    func stop() {
        let hadPlayer = player != nil
        player?.stop()
        player = nil
        activeKey = nil
        loadingKey = nil
        isPlaying = false
        elapsed = 0
        duration = 0
        stopProgress()
        if hadPlayer {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func resume(_ player: AVAudioPlayer) throws {
        let session = AVAudioSession.sharedInstance()
        // .playback routes to the loudspeaker (or connected headphones) and
        // keeps playing with the Ring/Silent switch on silent.
        try session.setCategory(.playback, mode: .default, options: [])
        try session.setActive(true)
        guard player.play() else { throw ChatVoiceError.playbackFailed }
        isPlaying = true
        finishedKey = nil
        startProgress()
    }

    private func playbackFinished() {
        guard let key = activeKey else { return }
        stopProgress()
        isPlaying = false
        player?.currentTime = 0
        elapsed = 0
        finishedKey = key
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func startProgress() {
        stopProgress()
        progressTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                guard let self, let player = self.player else { return }
                self.elapsed = player.currentTime
            }
        }
    }

    private func stopProgress() {
        progressTask?.cancel()
        progressTask = nil
    }
}

private final class ChatVoicePlayerDelegate: NSObject, AVAudioPlayerDelegate {
    var onFinish: (@MainActor () -> Void)?

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let callback = onFinish
        Task { @MainActor in callback?() }
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let callback = onFinish
        Task { @MainActor in callback?() }
    }
}

// MARK: - Voice bubble

struct ChatVoiceBubble: View {
    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let media: ChatMedia
    let messageId: String
    let isMine: Bool
    let fill: Color
    let stroke: Color
    var canReact: Bool = false
    var onReact: (String) -> Void = { _ in }

    @State private var errorMessage: String?
    @State private var offerReactions = false

    private static let barCount = 26
    private var player: ChatVoicePlayer { ChatVoicePlayer.shared }
    private var path: String { media.url ?? "" }
    private var isActive: Bool { player.activeKey == messageId }
    private var isLoading: Bool { player.loadingKey == messageId }
    private var isPlaying: Bool { isActive && player.isPlaying }
    private var totalMs: Int? {
        if isActive, player.duration > 0 { return Int((player.duration * 1000).rounded()) }
        return media.durationMs
    }
    private var progress: Double {
        guard isActive else { return 0 }
        return ChatVoiceMessage.progress(elapsed: player.elapsed, duration: Double(totalMs ?? 0) / 1000)
    }
    private var isUnplayed: Bool { !isMine && !player.isPlayed(messageId, accountId: store.me?.id) }
    private var timeLabel: String {
        let total = ChatVoiceMessage.durationLabel(ms: totalMs)
        guard isActive, isPlaying || player.elapsed > 0 else { return total }
        return "\(ChatVoiceMessage.clock(seconds: player.elapsed)) / \(total)"
    }
    private var accessibilityValue: String {
        let total = ChatVoiceMessage.spokenDuration(ms: totalMs)
        if isLoading { return "Loading, \(total)" }
        if isActive, isPlaying || player.elapsed > 0 {
            let elapsed = ChatVoiceMessage.spokenDuration(ms: Int(player.elapsed * 1000))
            return "\(elapsed) of \(total)"
        }
        return isUnplayed ? "\(total), not played yet" : total
    }
    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: isMine ? 22 : 6,
                               bottomTrailingRadius: isMine ? 6 : 22, topTrailingRadius: 22)
    }

    var body: some View {
        VStack(alignment: isMine ? .trailing : .leading, spacing: Space.xs) {
            HStack(spacing: Space.sm) {
                Button(action: toggle) {
                    ZStack {
                        Circle().fill(Palette.accent)
                        if isLoading {
                            ProgressView().tint(Palette.onAccent)
                        } else {
                            Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(Palette.onAccent)
                                .offset(x: isPlaying ? 0 : 1.5)
                        }
                    }
                    .frame(width: 44, height: 44)
                }
                .buttonStyle(PressableStyle())
                .disabled(path.isEmpty)
                .accessibilityLabel(isPlaying ? "Pause voice message" : "Play voice message")
                .accessibilityValue(accessibilityValue)
                .accessibilityIdentifier("chat.voice.play")

                VStack(alignment: .leading, spacing: 4) {
                    waveform
                    HStack(spacing: 6) {
                        Text(timeLabel)
                            .font(Typography.mono(11.5))
                            .monospacedDigit()
                            .foregroundStyle(Palette.textSecond)
                        if isUnplayed {
                            Circle().fill(Palette.accent).frame(width: 8, height: 8)
                        }
                    }
                }
                .accessibilityHidden(true)
            }
            .padding(.leading, 8).padding(.trailing, 14).padding(.vertical, 8)
            .background(shape.fill(AnyShapeStyle(fill)))
            .overlay(shape.strokeBorder(stroke, lineWidth: 1))

            if offerReactions {
                quickReactions
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.7), value: offerReactions)
        .onChange(of: player.finishedKey) { _, key in
            if key == messageId, canReact, !isMine { offerReactions = true }
        }
        .onDisappear {
            if isActive || isLoading { player.stop() }
        }
        .alert("Voice message unavailable", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Please try again.")
        }
    }

    private var waveform: some View {
        let bars = ChatVoiceMessage.waveform(seed: media.attachmentId ?? messageId, count: Self.barCount)
        let filled = Int((progress * Double(bars.count)).rounded(.down))
        return HStack(alignment: .center, spacing: 2) {
            ForEach(Array(bars.enumerated()), id: \.offset) { index, height in
                Capsule()
                    .fill(index < filled ? Palette.accent : Palette.accent.opacity(0.3))
                    .frame(width: 3, height: max(4, 24 * height))
            }
        }
        .frame(height: 24)
    }

    /// After someone else's clip plays through, offer the first six
    /// reactions inline (all eight stay in the long-press reaction bar).
    private var quickReactions: some View {
        HStack(spacing: 2) {
            ForEach(Array(ChatReaction.all.prefix(6)), id: \.key) { option in
                Button {
                    onReact(option.key)
                    offerReactions = false
                } label: {
                    Text(option.emoji)
                        .font(.system(size: 20))
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("React \(option.emoji)")
            }
            Button {
                offerReactions = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Palette.textSecond)
                    .frame(width: 32, height: 40)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss reactions")
        }
        .padding(.horizontal, 6)
        .background(Palette.panel, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.border, lineWidth: 1))
    }

    private func toggle() {
        guard !path.isEmpty else { return }
        Haptics.selection()
        offerReactions = false
        if !isMine { player.markPlayed(messageId, accountId: store.me?.id) }
        let key = messageId
        let clipPath = self.path
        let filename = media.attachmentFilename
        Task { @MainActor in
            do {
                try await ChatVoicePlayer.shared.toggle(key: key, path: clipPath, filename: filename)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Composer recording strip

struct ChatVoiceRecordingStrip: View {
    let recorder: ChatVoiceRecorder
    let onCancel: () -> Void
    let onSend: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        HStack(spacing: Space.sm) {
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.frDanger)
                    .frame(width: 44, height: 44)
                    .background(Palette.frDangerSoft, in: Circle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Cancel recording")
            .accessibilityHint("Deletes this voice message without sending it")
            .accessibilityIdentifier("chat.voice.cancel")

            HStack(spacing: Space.sm) {
                Circle()
                    .fill(Palette.frDanger)
                    .frame(width: 10, height: 10)
                    .opacity(reduceMotion ? 1 : (pulse ? 0.35 : 1))
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: pulse)
                    .onAppear { pulse = true }
                Text(ChatVoiceMessage.clock(seconds: recorder.elapsed))
                    .font(Typography.mono(15, .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Palette.text)
                ChatVoiceLevelMeter(levels: recorder.levels, reduceMotion: reduceMotion)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .clipped()
                Text(ChatVoiceMessage.clock(seconds: ChatVoiceMessage.maxDuration))
                    .font(Typography.mono(11.5))
                    .foregroundStyle(Palette.textSecond)
            }
            .padding(.horizontal, Space.md)
            .frame(minHeight: 44)
            .background(Palette.panel2, in: Capsule())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Recording voice message")
            .accessibilityValue("\(ChatVoiceMessage.spokenDuration(ms: Int(recorder.elapsed * 1000))) of 1 minute")
            .accessibilityAddTraits(.updatesFrequently)
            .accessibilityIdentifier("chat.voice.recording")

            Button(action: onSend) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(width: 44, height: 44)
                    .background(Palette.accent, in: Circle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Send voice message")
            .accessibilityIdentifier("chat.voice.send")
        }
    }
}

/// Live input level. With Reduce Motion the moving bars become a static
/// waveform glyph and label.
private struct ChatVoiceLevelMeter: View {
    let levels: [Double]
    let reduceMotion: Bool

    var body: some View {
        if reduceMotion {
            HStack(spacing: 4) {
                Image(systemName: "waveform")
                Text("Recording").font(Typography.caption)
            }
            .foregroundStyle(Palette.frDanger)
            .lineLimit(1)
        } else {
            HStack(alignment: .center, spacing: 2) {
                ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                    Capsule()
                        .fill(Palette.frDanger.opacity(0.75))
                        .frame(width: 3, height: 4 + 20 * level)
                }
            }
            .frame(height: 24)
            .animation(.linear(duration: 0.05), value: levels)
        }
    }
}

// MARK: - Microphone button

struct ChatVoiceMicButton: View {
    let isSending: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if isSending { ProgressView().tint(Palette.onAccent) }
                else { Image(systemName: "mic.fill") }
            }
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Palette.onAccent)
            .frame(width: 44, height: 44)
            .background(Palette.accent, in: Circle())
        }
        .buttonStyle(PressableStyle())
        .disabled(isSending)
        .accessibilityLabel(isSending ? "Sending voice message" : "Record voice message")
        .accessibilityHint("Records up to one minute for the chat")
        .accessibilityIdentifier("chat.voice.record")
    }
}

// MARK: - Composer alerts

/// Voice alerts for the chat composer: upload failure (retry/discard), short
/// notices (too short, interrupted) and the friendly microphone-denied state.
struct ChatVoiceComposerAlerts: ViewModifier {
    @Binding var voiceError: String?
    @Binding var voiceNotice: String?
    @Binding var showMicDenied: Bool
    let onRetry: () -> Void
    let onDiscard: () -> Void

    @Environment(\.openURL) private var openURL

    func body(content: Content) -> some View {
        content
            .alert("Voice message not sent", isPresented: Binding(
                get: { voiceError != nil },
                set: { if !$0 { voiceError = nil } }
            )) {
                Button("Discard", role: .destructive) { onDiscard() }
                Button("Retry") {
                    voiceError = nil
                    onRetry()
                }
            } message: {
                Text(voiceError ?? "Please try again.")
            }
            .alert("Voice message", isPresented: Binding(
                get: { voiceNotice != nil },
                set: { if !$0 { voiceNotice = nil } }
            )) {
                Button("OK", role: .cancel) { voiceNotice = nil }
            } message: {
                Text(voiceNotice ?? "")
            }
            .alert("Microphone is off", isPresented: $showMicDenied) {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                Button("Not now", role: .cancel) {}
            } message: {
                Text("Fam ETC uses the microphone to record voice messages for your family chat. Turn on Microphone for Fam ETC in Settings to send one.")
            }
    }
}
