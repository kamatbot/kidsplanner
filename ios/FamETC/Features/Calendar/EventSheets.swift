import SwiftUI

/// Add a family appointment. Saves to the server-synced family events store, and
/// the server posts a "📅 New event" card to chat.
struct AddEventSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var initialDate: Date = Date()

    @State private var title = ""
    @State private var date = Date()
    @State private var hasTime = false
    @State private var time = Date()
    @State private var notes = ""
    @State private var category = "other"
    @State private var saving = false

    private let categories = ["school", "sports", "arts", "social", "other"]

    private var canSave: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty && !saving }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title — e.g. Soccer practice ⚽", text: $title)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Toggle("Set a time", isOn: $hasTime.animation())
                    if hasTime {
                        DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute)
                    }
                }
                Section("Category") {
                    Picker("Category", selection: $category) {
                        ForEach(categories, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                Section("Notes") {
                    TextField("Optional notes", text: $notes, axis: .vertical).lineLimit(2...5)
                }
            }
            .navigationTitle("New Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { save() }.fontWeight(.bold).disabled(!canSave)
                }
            }
        }
        .onAppear { date = initialDate }
    }

    private func save() {
        saving = true
        Haptics.selection()
        let d = EventFmt.ymd.string(from: date)
        let t = hasTime ? EventFmt.hm.string(from: time) : nil
        let clean = title.trimmingCharacters(in: .whitespaces)
        let n = notes.trimmingCharacters(in: .whitespaces)
        Task {
            await store.addEvent(title: clean, date: d, time: t, notes: n.isEmpty ? nil : n, category: category, kidId: nil)
            dismiss()
        }
    }
}

/// Read-only detail for a family event (opened by tapping a "📅" chat card).
struct EventDetailSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let eventId: String

    private var event: FamilyEvent? { store.familyEvents.first { $0.id == eventId } }

    var body: some View {
        NavigationStack {
            ZStack {
                ScreenBackground()
                if let ev = event {
                    VStack(alignment: .leading, spacing: Space.lg) {
                        Text(ev.title).font(Typography.title).foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
                        detailRow("When", Agenda.dayLabel(ev.date) + (ev.time.flatMap { $0.isEmpty ? nil : " · \($0)" } ?? ""))
                        if let cat = ev.category, !cat.isEmpty { detailRow("Category", cat.capitalized) }
                        if let notes = ev.notes, !notes.isEmpty {
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Text("Notes").font(Typography.caption.weight(.bold)).foregroundStyle(Palette.textSecond)
                                Text(notes).font(Typography.body).foregroundStyle(Palette.text)
                            }
                        }
                        Spacer()
                    }
                    .padding(Space.xl).frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(spacing: Space.md) {
                        Image(systemName: "calendar.badge.exclamationmark").font(.system(size: 34)).foregroundStyle(Palette.textSecond)
                        Text("This event is no longer available.").font(Typography.body).foregroundStyle(Palette.textSecond)
                    }
                    .padding(Space.xl)
                }
            }
            .navigationTitle("Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(Typography.caption.weight(.bold)).foregroundStyle(Palette.textSecond)
            Spacer()
            Text(value).font(Typography.body).foregroundStyle(Palette.text)
        }
        .padding(.vertical, Space.sm)
        .overlay(Divider().overlay(Palette.border), alignment: .bottom)
    }
}

enum EventFmt {
    static let ymd: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
    static let hm: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f }()
}
