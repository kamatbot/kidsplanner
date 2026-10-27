import AVFoundation
import Foundation

/// Records one family-chat voice note: AAC in an `.m4a` container, mono,
/// 22 050 Hz, ~32 kbps (docs/VOICE-MESSAGES.md). Metering feeds the live
/// level bars; the recording stops itself at 30 s and reports `autoFinished`.
@MainActor
final class WatchVoiceRecorder: ObservableObject {
    enum State: Equatable { case idle, needsPermission, denied, recording, finished, failed(String) }

    struct Recording: Equatable {
        let url: URL
        let durationMs: Int
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var elapsed: TimeInterval = 0
    /// Most recent level first; 0…1.
    @Published private(set) var levels: [Double] = Array(repeating: 0, count: 12)
    /// Set when the recording ended by itself (30 s cap or an interruption);
    /// nil inside when it was too short. The view sends it, or closes.
    @Published private(set) var autoFinished: Recording??

    private var recorder: AVAudioRecorder?
    private var meterTask: Task<Void, Never>?

    static let settings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 22_050.0,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 32_000,
        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
    ]

    /// Asks for the microphone if needed, then records straight away.
    func start() async {
        guard state != .recording else { return }
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            break
        case .denied:
            state = .denied
            return
        default:
            state = .needsPermission
            let granted = await AVAudioApplication.requestRecordPermission()
            guard granted else { state = .denied; return }
        }
        // The screen may have closed while the permission prompt was up.
        guard state != .recording else { return }
        guard !Task.isCancelled else { state = .idle; return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("fametc-voice-\(UUID().uuidString).m4a")
            let recorder = try AVAudioRecorder(url: url, settings: Self.settings)
            recorder.isMeteringEnabled = true
            guard recorder.prepareToRecord(), recorder.record(forDuration: WatchVoiceFormat.maxSeconds + 0.5) else {
                throw WatchAPIError.transport("The microphone could not start.")
            }
            self.recorder = recorder
            elapsed = 0
            autoFinished = nil
            levels = Array(repeating: 0, count: levels.count)
            state = .recording
            startMetering()
        } catch {
            deactivateSession()
            state = .failed("Couldn't start recording. Try again.")
        }
    }

    /// Stops and returns the recording, or nil when it was too short to send.
    func finish() -> Recording? {
        guard let recorder else { return nil }
        let seconds = min(recorder.currentTime > 0 ? recorder.currentTime : elapsed, WatchVoiceFormat.maxSeconds)
        stopRecorder()
        state = .finished
        let durationMs = WatchVoiceFormat.durationMs(seconds)
        guard durationMs >= WatchVoiceFormat.minDurationMs else {
            try? FileManager.default.removeItem(at: recorder.url)
            return nil
        }
        return Recording(url: recorder.url, durationMs: durationMs)
    }

    /// Stops and deletes the recording.
    func cancel() {
        guard let recorder else { state = .idle; return }
        stopRecorder()
        recorder.deleteRecording()
        state = .idle
    }

    private func stopRecorder() {
        meterTask?.cancel()
        meterTask = nil
        recorder?.stop()
        recorder = nil
        deactivateSession()
    }

    private func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func startMetering() {
        meterTask?.cancel()
        meterTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self, let recorder = self.recorder else { return }
                recorder.updateMeters()
                let level = WatchVoiceFormat.level(fromDecibels: recorder.averagePower(forChannel: 0))
                self.levels = [level] + self.levels.dropLast()
                if recorder.isRecording { self.elapsed = recorder.currentTime }
                // The 30 s cap, the recorder's own backstop, or an interruption
                // (a call, Siri) all end here; whatever was recorded is sent.
                if self.elapsed >= WatchVoiceFormat.maxSeconds || !recorder.isRecording {
                    self.autoFinished = .some(self.finish())
                    return
                }
                try? await Task.sleep(for: .milliseconds(80))
            }
        }
    }
}
