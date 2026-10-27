import SwiftUI
import WatchKit

/// BRIEF screen 3. Recording starts as soon as the screen opens (after the
/// one-time microphone prompt). Send stops and sends; 30 s sends by itself.
struct WatchVoiceRecordingView: View {
    /// nil when cancelled, refused or too short to send.
    let onFinish: (WatchVoiceRecorder.Recording?) -> Void
    @StateObject private var recorder = WatchVoiceRecorder()
    @State private var finished = false

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Circle().fill(recorder.state == .recording ? Color.red : WatchChatPalette.secondary)
                    .frame(width: 8, height: 8)
                Text("To Family").font(.footnote.weight(.bold))
                Spacer(minLength: 0)
            }
            .padding(.leading, 6)
            switch recorder.state {
            case .denied:
                problem("Fam ETC can't use the microphone. Turn it on in Settings › Privacy & Security › Microphone.")
            case .failed(let message):
                problem(message)
            default:
                levelBars
                Text(WatchVoiceFormat.clock(recorder.elapsed))
                    .font(.system(size: 30, weight: .black, design: .rounded))
                    .monospacedDigit()
                    .accessibilityLabel("Recorded \(Int(recorder.elapsed)) seconds")
                controls
                Text("Tap to send · max \(WatchVoiceFormat.clock(WatchVoiceFormat.maxSeconds))")
                    .font(.caption2)
                    .foregroundStyle(WatchChatPalette.secondary)
            }
        }
        .fontDesign(.rounded)
        .task { await recorder.start() }
        .onChange(of: recorder.state) { _, state in
            if state == .recording { WKInterfaceDevice.current().play(.start) }
        }
        .onChange(of: recorder.autoFinished) { _, outcome in
            guard let outcome else { return }
            complete(outcome)
        }
        .onDisappear {
            // Swiped away or interrupted before send: never leave the mic on.
            if !finished { recorder.cancel() }
        }
    }

    private var levelBars: some View {
        HStack(spacing: 3) {
            ForEach(Array(recorder.levels.reversed().enumerated()), id: \.offset) { _, level in
                Capsule()
                    .fill(WatchChatPalette.violet)
                    .frame(width: 5, height: 4 + 22 * level)
            }
        }
        .frame(height: 26)
        .animation(.linear(duration: 0.08), value: recorder.levels)
        .accessibilityHidden(true)
    }

    private var controls: some View {
        HStack(spacing: 14) {
            Button { cancel() } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.heavy))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(WatchChatPalette.control, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel recording")
            Button { send() } label: {
                ZStack {
                    Circle().stroke(WatchChatPalette.control, lineWidth: 4)
                    Circle()
                        .trim(from: 0, to: min(1, recorder.elapsed / WatchVoiceFormat.maxSeconds))
                        .stroke(WatchChatPalette.violet, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Image(systemName: "arrow.up")
                        .font(.title2.weight(.black))
                        .foregroundStyle(.black)
                        .frame(width: 62, height: 62)
                        .background(WatchChatPalette.violet, in: Circle())
                }
                .frame(width: 72, height: 72)
            }
            .buttonStyle(.plain)
            .disabled(recorder.state != .recording)
            .accessibilityLabel("Send voice message")
            .accessibilityIdentifier("watch.voice.send")
        }
    }

    private func problem(_ text: String) -> some View {
        VStack(spacing: 8) {
            Text(text).font(.footnote).multilineTextAlignment(.center)
            Button("Close") { cancel() }
        }
        .padding(.top, 8)
    }

    private func send() {
        complete(recorder.finish())
    }

    private func cancel() {
        recorder.cancel()
        finished = true
        onFinish(nil)
    }

    private func complete(_ recording: WatchVoiceRecorder.Recording?) {
        guard !finished else { return }
        finished = true
        WKInterfaceDevice.current().play(recording == nil ? .failure : .click)
        onFinish(recording)
    }
}

/// BRIEF screen 4: plays the note at once, with progress, a React row and
/// Talk back.
struct WatchVoicePlaybackView: View {
    let message: WatchChatMessage
    let onTalkBack: () -> Void
    @EnvironmentObject private var store: WatchStore
    @StateObject private var player = WatchVoicePlayer()

    /// The cached copy, so reactions update in place.
    private var current: WatchChatMessage { store.snapshot.chat?.first { $0.id == message.id } ?? message }
    private var personColor: Color {
        current.isMine(store.snapshot.context?.profile) ? WatchChatPalette.violet : WatchChatPalette.color(for: current)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                HStack(spacing: 5) {
                    Text(String((current.senderName ?? "F").prefix(1)).uppercased())
                        .font(.system(size: 10, weight: .black))
                        .foregroundStyle(.black)
                        .frame(width: 20, height: 20)
                        .background(personColor, in: Circle())
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(current.senderName ?? "Family").font(.headline.weight(.heavy))
                        if let date = WatchPlanDate.iso(current.createdAt) {
                            Text(date.formatted(date: .omitted, time: .shortened))
                                .font(.caption2).foregroundStyle(WatchChatPalette.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
                card
                if case .failed(let reason) = player.state {
                    Text(reason).font(.caption2).foregroundStyle(.orange)
                }
                reactRow
                Button(action: onTalkBack) {
                    Label("Talk back", systemImage: "mic.fill")
                        .font(.body.weight(.heavy))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(WatchChatPalette.violet, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(store.chatUnavailable)
                .accessibilityIdentifier("watch.voice.talkBack")
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle("Voice")
        .navigationBarTitleDisplayMode(.inline)
        .fontDesign(.rounded)
        .task { await player.play(message) }
        .onDisappear { player.stop() }
    }

    private var card: some View {
        HStack(spacing: 8) {
            Button { toggle() } label: {
                Group {
                    if player.state == .loading {
                        ProgressView()
                    } else {
                        Image(systemName: player.state == .playing ? "pause.fill" : "play.fill")
                            .font(.body.weight(.black))
                            .foregroundStyle(personColor)
                    }
                }
                .frame(width: 36, height: 36)
                .background(.white, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(player.state == .playing ? "Pause" : "Play")
            VStack(alignment: .leading, spacing: 3) {
                WatchVoiceBars(heights: WatchVoiceFormat.waveform(for: current.media?.attachmentId ?? current.id),
                               progress: player.progress, filled: .white, empty: Color.white.opacity(0.4))
                    .frame(height: 20)
                Text("\(WatchVoiceFormat.clock(player.currentTime)) / \(WatchVoiceFormat.duration(ms: current.media?.durationMs))")
                    .font(.caption2.weight(.bold)).monospacedDigit()
                    .foregroundStyle(.white)
            }
        }
        .padding(8)
        .background(personColor.opacity(0.85), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var reactRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("React").font(.caption2.weight(.semibold)).foregroundStyle(WatchChatPalette.secondary)
            HStack(spacing: 6) {
                ForEach(WatchChatEmoji.reactions, id: \.self) { emoji in
                    let chosen = store.hasReacted(current, emoji: emoji)
                    Button {
                        WKInterfaceDevice.current().play(.click)
                        Task { await store.react(to: current, emoji: emoji) }
                    } label: {
                        Text(emoji)
                            .font(.system(size: 22))
                            .frame(maxWidth: .infinity, minHeight: 38)
                            .background(chosen ? WatchChatPalette.violet.opacity(0.45) : WatchChatPalette.control, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(chosen ? "Remove \(emoji)" : "React \(emoji)")
                }
            }
        }
    }

    private func toggle() {
        switch player.state {
        case .playing: player.pause()
        case .paused: player.resume()
        case .loading: break
        default: Task { await player.play(message) }
        }
    }
}
