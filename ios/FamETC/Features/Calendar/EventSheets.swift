import SwiftUI

/// Add a family appointment. Saves to the server-synced family events store, and
/// the server posts a "📅 New event" card to chat.
struct AddEventSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var initialDate: Date = Date()
    var initialTitle: String = ""
    var initialTime: String? = nil
    /// When set, the sheet edits this event in place (title/CTA become "Edit
    /// event"/"Save", fields prefill from it, and save() PATCHes instead of
    /// POSTing). Editing a recurring event updates the whole series.
    var editing: FamilyEvent? = nil

    @State private var title = ""
    @State private var date = Date()
    @State private var hasTime = false
    @State private var time = Date()
    @State private var notes = ""
    @State private var category = "other"
    @State private var kidId: String? = nil
    @State private var saving = false
    @State private var isMultiDay = false
    @State private var endDate = Date()
    @State private var repeatRule = "none"
    @State private var hasRepeatUntil = false
    @State private var repeatUntilDate = Date()

    private let categories = ["school", "sports", "arts", "social", "other"]
    private let repeatOptions: [(value: String, label: String)] = [
        ("none", "None"), ("daily", "Daily"), ("weekly", "Weekly"),
        ("biweekly", "Biweekly"), ("monthly", "Monthly"),
    ]

    private var isEditing: Bool { editing != nil }
    private var canSave: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty && !saving }

    /// Rows offered in the "For" picker, beyond "Whole family": a parent may
    /// target any kid; a kid session may only target themself (the server
    /// enforces this too — resolveEventKidId coerces any other id to family —
    /// but the UI shouldn't offer a choice that's a no-op).
    private var audienceKids: [Kid] {
        store.isParent ? store.kids : store.kids.filter { $0.id == store.me?.kidId }
    }
    private func kidColor(_ kid: Kid) -> Color {
        store.kids.firstIndex(where: { $0.id == kid.id }).map { Palette.kidColor(index: $0) } ?? Palette.accent
    }

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
                    Toggle("Multi-day", isOn: $isMultiDay.animation())
                    if isMultiDay {
                        DatePicker("End date", selection: $endDate, in: date..., displayedComponents: .date)
                    }
                }
                Section("Repeat") {
                    Picker("Repeat", selection: $repeatRule) {
                        ForEach(repeatOptions, id: \.value) { Text($0.label).tag($0.value) }
                    }
                    .pickerStyle(.menu)
                    if repeatRule != "none" {
                        Toggle("Until a date", isOn: $hasRepeatUntil.animation())
                        if hasRepeatUntil {
                            DatePicker("Until", selection: $repeatUntilDate, in: date..., displayedComponents: .date)
                        }
                    }
                    if isEditing && (editing?.isRecurring ?? false) {
                        Text("Editing updates the whole series, not just this occurrence.")
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                    }
                }
                Section("For") {
                    Picker("For", selection: $kidId) {
                        Text("Whole family").tag(String?.none)
                        ForEach(audienceKids) { kid in
                            HStack {
                                Circle().fill(kidColor(kid)).frame(width: 10, height: 10)
                                Text(kid.name)
                            }
                            .tag(Optional(kid.id))
                        }
                    }
                    .pickerStyle(.menu)
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
            .navigationTitle(isEditing ? "Edit Event" : "New Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEditing ? "Save" : "Add") { save() }.fontWeight(.bold).disabled(!canSave)
                }
            }
        }
        .onAppear {
            if let editing {
                title = editing.title
                if let d = EventFmt.ymd.date(from: editing.date) { date = d }
                if let et = editing.endDate, !et.isEmpty, let d = EventFmt.ymd.date(from: et) {
                    endDate = d
                    isMultiDay = true
                } else {
                    endDate = editing.date.isEmpty ? Date() : (EventFmt.ymd.date(from: editing.date) ?? Date())
                }
                if let t = editing.time, !t.isEmpty, let parsed = EventFmt.hm.date(from: t) {
                    let comps = Calendar.current.dateComponents([.hour, .minute], from: parsed)
                    if let combined = Calendar.current.date(bySettingHour: comps.hour ?? 0, minute: comps.minute ?? 0, second: 0, of: date) {
                        hasTime = true
                        time = combined
                    }
                }
                notes = editing.notes ?? ""
                category = editing.category ?? "other"
                kidId = editing.kidId
                repeatRule = editing.repeatRule ?? "none"
                repeatUntilDate = date
                if let ru = editing.repeatUntil, !ru.isEmpty, let d = EventFmt.ymd.date(from: ru) {
                    hasRepeatUntil = true
                    repeatUntilDate = d
                }
            } else {
                date = initialDate
                endDate = initialDate
                repeatUntilDate = initialDate
                if !initialTitle.isEmpty { title = initialTitle }
                if let initialTime, let parsed = EventFmt.hm.date(from: initialTime) {
                    let comps = Calendar.current.dateComponents([.hour, .minute], from: parsed)
                    if let combined = Calendar.current.date(bySettingHour: comps.hour ?? 0, minute: comps.minute ?? 0, second: 0, of: Date()) {
                        hasTime = true
                        time = combined
                    }
                }
            }
        }
    }

    private func save() {
        saving = true
        Haptics.selection()
        let d = EventFmt.ymd.string(from: date)
        let t = hasTime ? EventFmt.hm.string(from: time) : nil
        let clean = title.trimmingCharacters(in: .whitespaces)
        let n = notes.trimmingCharacters(in: .whitespaces)
        let ed = (isMultiDay && endDate > date) ? EventFmt.ymd.string(from: endDate) : nil
        let until = (repeatRule != "none" && hasRepeatUntil) ? EventFmt.ymd.string(from: repeatUntilDate) : nil
        Task {
            if let editing {
                await store.updateEvent(editing.id, title: clean, date: d, time: t, notes: n.isEmpty ? nil : n, category: category, kidId: kidId,
                                         endDate: ed, repeatRule: repeatRule == "none" ? nil : repeatRule, repeatUntil: until)
            } else {
                await store.addEvent(title: clean, date: d, time: t, notes: n.isEmpty ? nil : n, category: category, kidId: kidId,
                                      endDate: ed, repeatRule: repeatRule == "none" ? nil : repeatRule, repeatUntil: until)
            }
            dismiss()
        }
    }
}

/// Read-only detail for a family event (opened by tapping a "📅" chat card).
struct EventDetailSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let eventId: String
    var occurrenceDate: String? = nil
    @State private var showDeleteConfirm = false
    @State private var showEditSheet = false

    // Occurrences of a recurring series share `id`, so prefer the occurrence
    // that matches the date we were opened from; fall back to any occurrence
    // of the series (e.g. when opened from a chat card with no specific date).
    private var event: FamilyEvent? {
        store.familyEvents.first { $0.id == eventId && (occurrenceDate == nil || $0.date == occurrenceDate) }
            ?? store.familyEvents.first { $0.id == eventId }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                ScreenBackground()
                if let ev = event {
                    VStack(alignment: .leading, spacing: Space.lg) {
                        Text(ev.title).font(Typography.title).foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
                        detailRow("When", Agenda.dayLabel(ev.date) + (ev.time.flatMap { $0.isEmpty ? nil : " · \($0)" } ?? ""))
                        if let ed = ev.endDate, !ed.isEmpty { detailRow("Through", Agenda.dayLabel(ed)) }
                        if ev.isRecurring {
                            let rule = (ev.repeatRule ?? "none").capitalized
                            let until = ev.repeatUntil.flatMap { $0.isEmpty ? nil : " until \(Agenda.dayLabel($0))" } ?? ""
                            detailRow("Repeats", rule + until)
                        }
                        if let cat = ev.category, !cat.isEmpty { detailRow("Category", cat.capitalized) }
                        if let notes = ev.notes, !notes.isEmpty {
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Text("Notes").font(Typography.caption.weight(.bold)).foregroundStyle(Palette.textSecond)
                                Text(notes).font(Typography.body).foregroundStyle(Palette.text)
                            }
                        }
                        Spacer()
                        // Server-computed: true when this user created the event OR is a
                        // parent (GET /api/calendar/events `canEdit`). nil (not yet synced
                        // through a server round-trip) is treated as false — no edit/delete
                        // shown. Kids get edit+delete on their OWN events via this flag, so
                        // it's deliberately NOT gated on store.isParent.
                        if ev.canEdit == true {
                            Button { showEditSheet = true } label: {
                                Text("Edit Event").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            Button(role: .destructive) { showDeleteConfirm = true } label: {
                                Text("Delete Event").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Palette.coral)
                        }
                    }
                    .padding(Space.xl).frame(maxWidth: .infinity, alignment: .leading)
                    .sheet(isPresented: $showEditSheet) { AddEventSheet(editing: ev) }
                    .alert("Delete Event", isPresented: $showDeleteConfirm) {
                        Button("Cancel", role: .cancel) {}
                        Button("Delete", role: .destructive) {
                            Task { await store.deleteEvent(ev.id); dismiss() }
                        }
                    } message: {
                        Text(ev.isRecurring ? "Delete this event and all its repeats?" : "Delete this event?")
                    }
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

    // Cosmetic only (Horizon mono micro-label for the row caption) — kept minimal
    // since another session is concurrently touching this sheet's structure.
    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack {
            MicroLabel(text: label)
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
