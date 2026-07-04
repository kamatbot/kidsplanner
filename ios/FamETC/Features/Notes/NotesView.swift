import SwiftUI

// MARK: - Notes
//
// Day-grouped timeline of the family's notes: reflections pinned from the
// quote/mood/news/SAT widgets, chat pins, and manual entries. Kids see only
// their own notes; parents see the whole family (the server scopes this by
// session, so the client just renders whatever `store.notes` returns).
struct NotesScreen: View {
    @Environment(AppStore.self) private var store
    @State private var showComposer = false

    private var sections: [(day: String, notes: [Note])] {
        let byDay = Dictionary(grouping: store.notes) { $0.date }
        return byDay.keys.sorted(by: >).map { day in
            (day, byDay[day]!.sorted { $0.id > $1.id })
        }
    }

    var body: some View {
        SurfaceScaffold(title: "Notes", subtitle: subtitle, trailing: {
            Button { Haptics.selection(); showComposer = true } label: {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(Palette.onAccent)
                    .frame(width: 38, height: 38).background(Palette.accent, in: Circle())
            }
            .accessibilityLabel("Add a note")
        }) {
            addNoteButton

            if sections.isEmpty {
                emptyState
            } else {
                ForEach(sections, id: \.day) { section in
                    VStack(alignment: .leading, spacing: Space.sm) {
                        Text(Agenda.dayLabel(section.day))
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.text)
                            .padding(.horizontal, Space.xs)
                        Card {
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(section.notes) { note in
                                    NoteRow(note: note)
                                    if note.id != section.notes.last?.id {
                                        Divider().overlay(Palette.border)
                                            .padding(.vertical, Space.sm)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .refreshable { await store.loadNotes() }
        .task { await store.loadNotes() }
        .sheet(isPresented: $showComposer) { AddNoteSheet() }
    }

    private var subtitle: String? {
        store.notes.isEmpty ? nil : "\(store.notes.count) note\(store.notes.count == 1 ? "" : "s")"
    }

    private var addNoteButton: some View {
        Button { Haptics.selection(); showComposer = true } label: {
            HStack(spacing: Space.sm) {
                Image(systemName: "plus.circle.fill")
                Text("Add a note")
            }
            .font(Typography.body.weight(.semibold))
            .foregroundStyle(Palette.accent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Space.md)
            .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }

    private var emptyState: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.md) {
                Image(systemName: "note.text")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                Text("No notes yet")
                    .font(Typography.cardTitle).foregroundStyle(Palette.text)
                Text("Reflections you save from the daily quote, mood check-in, news, or chat show up here — or tap “Add a note” to write one yourself.")
                    .font(Typography.body).foregroundStyle(Palette.textSecond)
            }
        }
    }
}

// MARK: - One note row

private struct NoteRow: View {
    let note: Note

    var body: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            HStack(spacing: Space.sm) {
                SourceChip(source: note.source)
                Spacer()
            }
            Text(note.body)
                .font(Typography.body)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            if let context = note.ref?.context, !context.isEmpty {
                Text(context)
                    .font(Typography.caption.italic())
                    .foregroundStyle(Palette.textSecond)
                    .padding(.leading, Space.md)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(Palette.border).frame(width: 2)
                    }
            }
        }
        .padding(.vertical, Space.sm)
    }
}

// MARK: - Source chip

private struct SourceChip: View {
    let source: String

    private var emoji: String {
        switch source {
        case "quote": return "📌"
        case "sat": return "🔤"
        case "chat": return "💬"
        case "social": return "💗"
        case "news": return "📰"
        default: return "📝"
        }
    }

    private var label: String {
        switch source {
        case "quote": return "Quote"
        case "sat": return "Word of the day"
        case "chat": return "Chat"
        case "social": return "Feelings"
        case "news": return "News"
        default: return "Note"
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Text(emoji)
            Text(label)
        }
        .font(Typography.monoSmall)
        .foregroundStyle(Palette.textSecond)
        .padding(.horizontal, Space.sm)
        .padding(.vertical, 3)
        .background(Palette.accentSoft, in: Capsule())
    }
}

// MARK: - Add note composer

private struct AddNoteSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var noteText = ""
    @State private var saving = false
    @FocusState private var focused: Bool

    private var canSave: Bool { !noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !saving }

    var body: some View {
        NavigationStack {
            ZStack {
                ScreenBackground()
                VStack(alignment: .leading, spacing: Space.lg) {
                    Text("What's on your mind?")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)

                    TextEditor(text: $noteText)
                        .font(Typography.body)
                        .foregroundStyle(Palette.text)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 160)
                        .padding(Space.sm)
                        .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Radius.field, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))
                        .focused($focused)

                    Spacer()
                }
                .padding(Space.lg)
            }
            .navigationTitle("Add a note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { save() }
                        .disabled(!canSave)
                        .fontWeight(.semibold)
                }
            }
            .onAppear { focused = true }
        }
    }

    private func save() {
        let text = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        saving = true
        Task {
            await store.addNote(body: text, source: "manual")
            saving = false
            dismiss()
        }
    }
}
