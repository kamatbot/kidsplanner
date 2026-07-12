import SwiftUI

// MARK: - Per-sender color (stable across launches)

private let famColors: [Color] = [
    Palette.coral, Palette.teal, Palette.amber, Palette.blue, Palette.green, Palette.violet, Palette.orange,
]
/// A stable, launch-independent hash (String.hashValue is randomized per run).
private func stableHash(_ s: String) -> Int {
    s.unicodeScalars.reduce(5381) { ($0 &* 33) &+ Int($1.value) }
}
func famSenderColor(_ id: String) -> Color {
    famColors[abs(stableHash(id)) % famColors.count]
}
func famInitials(_ name: String) -> String {
    let parts = name.split(separator: " ")
    let first = parts.first?.first.map(String.init) ?? ""
    let second = parts.count > 1 ? (parts[1].first.map(String.init) ?? "") : ""
    return (first + second).uppercased()
}

/// A friendly character avatar per family member (grown-ups get parent faces,
/// kids get kid faces), assigned deterministically so each person keeps theirs.
func famAvatar(senderType: String, id: String) -> String {
    let grownups = ["👩", "👨", "🧑", "🧔", "👩‍🦰", "👨‍🦱", "👱‍♀️"]
    let kids = ["🧒", "👦", "👧", "🧑‍🎓", "🧑‍🚀", "👶"]
    let set = senderType == "kid" ? kids : grownups
    return set[abs(stableHash(id)) % set.count]
}

// MARK: - System card message (homework / event) — distinct + animated + tappable

struct SystemCardRow: View {
    let message: ChatMessage
    var onTapCard: (ChatCard) -> Void

    private var isEvent: Bool { message.card?.type == "event" }
    private var isDone: Bool { !isEvent && message.text.hasPrefix("✅") }
    private var tint: Color { isDone ? Palette.green : Palette.accent }
    private var emoji: String { isEvent ? "📅" : (isDone ? "✅" : "📚") }
    private var subLabel: String { isEvent ? "Event · tap to view" : "Homework · tap to view" }

    var body: some View {
        Button { if let c = message.card { onTapCard(c) } } label: {
            HStack(spacing: Space.md) {
                Text(emoji).font(.system(size: 26))
                VStack(alignment: .leading, spacing: 3) {
                    Text(message.text)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                    Text(subLabel)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(tint)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(tint)
            }
            .padding(Space.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(tint.opacity(0.45), lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Space.xl)
        // No onAppear-gated reveal: rows a scroll view hasn't materialized
        // never fire onAppear, which left these cards INVISIBLE after the
        // first-layout race (device bug, builds 21-22). Cards render visible
        // by default; the tinted card styling still reads distinct.
    }
}

// MARK: - GIF picker sheet

struct GifPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    var onPick: (GifResult) -> Void

    @State private var query = ""
    @State private var gifs: [GifResult] = []
    @State private var loading = true
    @State private var searchTask: Task<Void, Never>?

    private let cols = [GridItem(.adaptive(minimum: 110), spacing: 8)]

    var body: some View {
        NavigationStack {
            ScrollView {
                if loading && gifs.isEmpty {
                    ProgressView().tint(Palette.accent).padding(Space.xl)
                }
                LazyVGrid(columns: cols, spacing: 8) {
                    ForEach(gifs) { gif in
                        Button {
                            Haptics.selection()
                            onPick(gif); dismiss()
                        } label: {
                            AnimatedGIFView(url: URL(string: gif.url.isEmpty ? gif.previewUrl : gif.url))
                                .frame(height: 110)
                                .frame(maxWidth: .infinity)
                                .background(Palette.border)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(Space.md)
            }
            .background(ScreenBackground())
            .searchable(text: $query, prompt: "Search GIFs")
            .onChange(of: query) { _, q in debounce(q) }
            .navigationTitle("GIFs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .task { await reload() }
        }
    }

    private func reload() async {
        loading = true
        let result: [GifResult]
        if query.trimmingCharacters(in: .whitespaces).isEmpty {
            result = (try? await APIClient.shared.trendingGifs()) ?? []
        } else {
            result = (try? await APIClient.shared.searchGifs(query)) ?? []
        }
        gifs = result
        loading = false
    }
    private func debounce(_ q: String) {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            if Task.isCancelled { return }
            await reload()
        }
    }
}

// MARK: - Homework detail sheet (from tapping a homework card)

struct HomeworkDetailSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let homeworkId: String

    private var item: HomeworkItem? { store.homework.first { $0.id == homeworkId } }

    var body: some View {
        NavigationStack {
            ZStack {
                ScreenBackground()
                if let hw = item {
                    VStack(alignment: .leading, spacing: Space.lg) {
                        Text(hw.title).font(Typography.title).foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
                        detailRow("Subject", (hw.subject?.isEmpty == false) ? hw.subject! : "—")
                        detailRow("Due", Agenda.dayLabel(hw.dueDate) + (hw.dueTime.map { " · \($0)" } ?? ""))
                        detailRow("Status", hw.isDone ? "Done ✅" : "To do")
                        Button {
                            Haptics.selection()
                            Task { await store.toggleHomeworkDone(hw) }
                        } label: {
                            Text(hw.isDone ? "Mark not done" : "Mark as done")
                                .font(Typography.body.weight(.bold))
                                .foregroundStyle(Palette.onAccent)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, Space.md)
                                .background(hw.isDone ? Palette.textSecond : Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        Spacer()
                    }
                    .padding(Space.xl)
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(spacing: Space.md) {
                        Image(systemName: "questionmark.circle").font(.system(size: 34)).foregroundStyle(Palette.textSecond)
                        Text("This assignment is no longer available.").font(Typography.body).foregroundStyle(Palette.textSecond)
                    }
                    .padding(Space.xl)
                }
            }
            .navigationTitle("Homework")
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
