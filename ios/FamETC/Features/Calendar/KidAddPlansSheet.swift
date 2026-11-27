import SwiftUI

/// A kid's own "+" on iPad: add an event, a reminder, or several plans at once
/// by typing or dictating ("soccer Saturday at 10, dentist Tuesday at 4,
/// remind me to pack my recorder tomorrow at 7:30"). Everything is added for
/// the signed-in kid only, and reminders buzz on their watch.
/// Parents get the "Say it" part only (their single event has its own sheet):
/// their plans go on their own list unless they name a kid.
struct KidAddPlansSheet: View {
    enum Mode: String, CaseIterable, Identifiable {
        case say, event, reminder
        var id: String { rawValue }
        var label: String {
            switch self {
            case .say: return "Say it"
            case .event: return "Event"
            case .reminder: return "Reminder"
            }
        }
    }

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var initialMode: Mode = .say
    var initialDate: Date = Date()
    var initialTime: String? = nil

    @State private var mode: Mode = .say
    @State private var title = ""
    @State private var date = Date()
    @State private var hasTime = false
    @State private var time = Date()
    @State private var notes = ""
    @State private var note = ""
    @State private var saving = false
    @State private var error: String?
    @State private var result: KidPlansResult?
    @State private var requestId = UUID().uuidString
    @State private var lastSubmitted = ""
    @State private var undoing = false

    var body: some View {
        NavigationStack {
            Form {
                if !store.isParent { Section {
                    Picker("Add", selection: $mode) {
                        ForEach(Mode.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("kid.add.mode")
                } }
                switch mode {
                case .say: saySection
                case .event: eventSection
                case .reminder: reminderSection
                }
                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(Palette.frDanger)
                            .accessibilityIdentifier("kid.add.error")
                    }
                }
                Section { DeviceCalendarRow() }
            }
            .navigationTitle("Add plans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(result == nil ? "Cancel" : "Done") { dismiss() } }
                if mode != .say {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(saving ? "Adding…" : "Add") { saveSingle() }
                            .fontWeight(.bold)
                            .disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .accessibilityIdentifier("kid.add.save")
                    }
                }
            }
            .onAppear {
                mode = store.isParent ? .say : initialMode
                date = initialDate
                if let initialTime, let parsed = EventFmt.hm.date(from: initialTime) {
                    let parts = Calendar.current.dateComponents([.hour, .minute], from: parsed)
                    if let combined = Calendar.current.date(bySettingHour: parts.hour ?? 0, minute: parts.minute ?? 0, second: 0, of: initialDate) {
                        time = combined
                        hasTime = true
                    }
                }
            }
            .onChange(of: mode) { _, newMode in
                error = nil
                // A reminder needs a time to buzz.
                if newMode == .reminder { hasTime = true }
            }
        }
        .interactiveDismissDisabled(saving)
    }

    // MARK: Say it

    @ViewBuilder private var saySection: some View {
        Section {
            TextField(store.isParent
                      ? "Dentist Tuesday at 4, remind me to call the plumber tomorrow at 9, Maya has soccer Saturday at 10"
                      : "Soccer Saturday at 10, dentist Tuesday at 4, remind me to pack my recorder tomorrow at 7:30",
                      text: $note, axis: .vertical)
                .lineLimit(3...8)
                .accessibilityIdentifier("kid.add.note")
            Button {
                submitNote()
            } label: {
                HStack {
                    if saving { ProgressView() }
                    Text(saving ? "Adding…" : "Add all")
                }
            }
            .disabled(saving || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("kid.add.submitNote")
        } header: {
            Text("Type or tap the keyboard mic and say your plans")
        } footer: {
            Text(store.isParent
                 ? "Say lots of plans at once. They're added for you unless you name one of the kids."
                 : "You can say lots of plans at once. Events and reminders are only added for you.")
        }
        if let result { resultSection(result) }
    }

    @ViewBuilder private func resultSection(_ result: KidPlansResult) -> some View {
        Section(result.items.isEmpty || result.undone ? "Result" : "Added") {
            if result.items.isEmpty || result.undone {
                Text(result.reply)
            } else {
                ForEach(result.items) { item in
                    Label(item.label?.replacingOccurrences(of: "📅 ", with: "").replacingOccurrences(of: "⏰ ", with: "") ?? item.title,
                          systemImage: item.isReminder ? "alarm.fill" : "calendar")
                }
                if let skipped = result.skipped, !skipped.isEmpty {
                    Text("Skipped: " + skipped.map { "\($0.title ?? "one") (\($0.reason))" }.joined(separator: ", "))
                        .foregroundStyle(Palette.frDanger)
                }
                Button(undoing ? "Undoing…" : "Undo", role: .destructive) { undo(result) }
                    .disabled(undoing)
                    .accessibilityIdentifier("kid.add.undo")
            }
        }
    }

    // MARK: Single event / reminder

    @ViewBuilder private var eventSection: some View {
        Section {
            TextField("What is it? e.g. Soccer practice ⚽", text: $title)
                .accessibilityIdentifier("kid.add.title")
            DatePicker("Date", selection: $date, in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
            Toggle("Set a time", isOn: $hasTime.animation())
            if hasTime { DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute) }
            TextField("Notes (optional)", text: $notes, axis: .vertical).lineLimit(1...4)
        } footer: {
            Text(hasTime ? "Your watch buzzes 10 minutes before it starts." : "Add a time if you want your watch to buzz.")
        }
    }

    @ViewBuilder private var reminderSection: some View {
        Section {
            TextField("Remind me to… e.g. Pack my recorder", text: $title)
                .accessibilityIdentifier("kid.add.title")
            DatePicker("Date", selection: $date, in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
            DatePicker("Buzz at", selection: $time, displayedComponents: .hourAndMinute)
            TextField("Notes (optional)", text: $notes, axis: .vertical).lineLimit(1...4)
        } footer: {
            Text("Your watch buzzes at this time and keeps nudging until you tap Done. Reminders don't buzz between 9 PM and 7 AM.")
        }
    }

    // MARK: Actions

    private func saveSingle() {
        saving = true
        error = nil
        let day = EventFmt.ymd.string(from: date)
        let clock = EventFmt.hm.string(from: time)
        let cleanNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            let failure: String?
            if mode == .reminder {
                failure = await store.createKidReminder(title: title, dueDate: day, dueTime: clock, notes: cleanNotes.isEmpty ? nil : cleanNotes)
            } else {
                failure = await store.addKidEvent(title: title, date: day, time: hasTime ? clock : nil, notes: cleanNotes.isEmpty ? nil : cleanNotes)
            }
            saving = false
            if let failure { error = failure } else { Haptics.selection(); dismiss() }
        }
    }

    private func submitNote() {
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        // Re-sending the same words after a failure reuses the id, so a reply
        // lost on the way back can't add everything twice.
        if text != lastSubmitted { requestId = UUID().uuidString; lastSubmitted = text }
        saving = true
        error = nil
        let id = requestId
        Task {
            do {
                let added = try await store.addKidPlans(text: text, requestId: id)
                result = added
                if !added.items.isEmpty { note = ""; lastSubmitted = ""; Haptics.selection() }
            } catch {
                self.error = AppStore.kidPlanErrorText(error)
            }
            saving = false
        }
    }

    private func undo(_ added: KidPlansResult) {
        undoing = true
        error = nil
        Task {
            do { result = try await store.undoKidPlans(requestId: added.requestId) }
            catch { self.error = "Couldn't undo: " + AppStore.kidPlanErrorText(error) }
            undoing = false
        }
    }
}
