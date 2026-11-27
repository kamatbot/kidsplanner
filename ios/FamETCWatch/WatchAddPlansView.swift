import SwiftUI
import UserNotifications
import WatchKit

/// "Add plans": the kid taps Talk, says everything at once ("soccer Saturday
/// at 10, dentist Tuesday at 4, remind me to pack my recorder tomorrow"), and
/// the server adds every event and reminder for them. watchOS has no on-watch
/// speech framework, so the words come from system dictation (the mic in the
/// text input sheet); Siri uses the same server call (AddPlansIntent).
struct WatchAddPlansView: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.dismiss) private var dismiss

    private enum Phase: Equatable {
        case ready
        case working(String)
        case done(WatchPlansResult)
        case failed(heard: String, message: String)
    }

    @State private var phase: Phase = .ready
    /// Kept across "Try again" so a retry after a dropped reply can't add twice.
    @State private var requestId = UUID().uuidString
    @State private var undoing = false
    @State private var undoError: String?
    @State private var remindersOff = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                switch phase {
                case .ready: ready
                case .working(let heard): working(heard)
                case .done(let result): done(result)
                case .failed(let heard, let message): failed(heard: heard, message: message)
                }
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle("Add plans")
        .navigationBarTitleDisplayMode(.inline)
        .fontDesign(.rounded)
        .tint(WatchChatPalette.coral)
        .task { remindersOff = await Self.remindersAreOff() }
    }

    // MARK: Screens

    private var ready: some View {
        VStack(alignment: .leading, spacing: 8) {
            talkButton(title: "Talk")
            Text("Say all your plans at once.")
                .font(.footnote.weight(.semibold))
            Text("“Soccer Saturday at 10, dentist Tuesday at 4, remind me to pack my recorder tomorrow at 7:30”")
                .font(.caption2)
                .foregroundStyle(WatchChatPalette.secondary)
            Text("Tip: say “Hey Siri, add plans in Fam ETC”.")
                .font(.caption2)
                .foregroundStyle(WatchChatPalette.secondary)
        }
    }

    private func working(_ heard: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                ProgressView().frame(width: 20, height: 20)
                Text("Adding…").font(.headline)
            }
            heardText(heard)
        }
    }

    private func done(_ result: WatchPlansResult) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if result.items.isEmpty || result.undone {
                Text(result.reply).font(.footnote.weight(.semibold))
            } else {
                Label(result.items.count == 1 ? "Added 1" : "Added \(result.items.count)", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundStyle(.green)
                ForEach(result.items) { item in
                    HStack(alignment: .top, spacing: 4) {
                        Image(systemName: item.isReminder ? "alarm.fill" : "calendar")
                            .foregroundStyle(item.isReminder ? WatchChatPalette.homework : WatchChatPalette.violet)
                            .font(.caption)
                        Text(item.line.replacingOccurrences(of: "📅 ", with: "").replacingOccurrences(of: "⏰ ", with: ""))
                            .font(.caption)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let skipped = result.skipped, !skipped.isEmpty {
                    Text("Skipped: " + skipped.map { "\($0.title ?? "one") (\($0.reason))" }.joined(separator: ", "))
                        .font(.caption2).foregroundStyle(.orange)
                }
                if remindersOff && result.items.contains(where: \.isReminder) {
                    Button("Turn on reminders") {
                        Task { await store.enableReminders(); remindersOff = await Self.remindersAreOff() }
                    }
                    .font(.caption.weight(.bold))
                    Text("Reminders only buzz when they're on.").font(.caption2).foregroundStyle(.orange)
                }
            }
            if let undoError { Text(undoError).font(.caption2).foregroundStyle(.orange) }
            if !result.items.isEmpty && !result.undone {
                Button(role: .destructive) { undo(result) } label: {
                    Label(undoing ? "Undoing…" : "Undo", systemImage: "arrow.uturn.backward")
                        .frame(maxWidth: .infinity)
                }
                .disabled(undoing)
            }
            talkButton(title: "Add more")
            Button("Done") { dismiss() }
                .frame(maxWidth: .infinity)
        }
    }

    private func failed(heard: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Not added", systemImage: "exclamationmark.triangle.fill")
                .font(.headline).foregroundStyle(.orange)
            Text(message).font(.footnote).fixedSize(horizontal: false, vertical: true)
            heardText(heard)
            Button { submit(heard) } label: {
                Label("Try again", systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
            }
            talkButton(title: "Say it again")
        }
    }

    // MARK: Parts

    /// Opens the system input sheet straight away; its mic button dictates.
    private func talkButton(title: String) -> some View {
        TextFieldLink(prompt: Text("Say your plans")) {
            HStack(spacing: 4) {
                Image(systemName: "mic.fill")
                Text(title)
            }
            .font(.body.weight(.heavy))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(WatchChatPalette.coral, in: Capsule())
        } onSubmit: { text in
            // A new note is a new request; "Try again" keeps the old id.
            requestId = UUID().uuidString
            submit(text)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title): say your plans")
        .accessibilityIdentifier("watch.plans.talk")
    }

    private func heardText(_ heard: String) -> some View {
        Text("I heard: “\(heard)”")
            .font(.caption2)
            .foregroundStyle(WatchChatPalette.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Actions

    private func submit(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        WKInterfaceDevice.current().play(.click)
        phase = .working(text)
        undoError = nil
        let id = requestId
        Task {
            do {
                let result = try await WatchPlansService.shared.add(text, requestId: id, via: "app")
                WKInterfaceDevice.current().play(result.items.isEmpty ? .failure : .success)
                phase = .done(result)
            } catch {
                WKInterfaceDevice.current().play(.failure)
                phase = .failed(heard: text, message: WatchPlansService.message(for: error))
            }
        }
    }

    private func undo(_ result: WatchPlansResult) {
        undoing = true
        undoError = nil
        Task {
            defer { undoing = false }
            do {
                phase = .done(try await WatchPlansService.shared.undo(requestId: result.requestId))
                WKInterfaceDevice.current().play(.click)
            } catch {
                undoError = "Couldn't undo: " + WatchPlansService.message(for: error)
            }
        }
    }

    private static func remindersAreOff() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return !(settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional)
    }
}
