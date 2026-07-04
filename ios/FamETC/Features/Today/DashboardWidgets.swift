import SwiftUI

/// A colorful tinted widget card — the building block of the Today dashboard,
/// matching the web app's widgets grid. Each widget picks a distinct tint.
struct DashCard<Content: View>: View {
    let icon: String
    let title: String
    let tint: Color
    let content: Content

    init(_ icon: String, _ title: String, tint: Color, @ViewBuilder content: () -> Content) {
        self.icon = icon; self.title = title; self.tint = tint; self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            HStack(spacing: 6) {
                Text(icon).font(.system(size: 16))
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(0.5)
                    .foregroundStyle(tint)
            }
            content
        }
        .padding(Space.lg)
        .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(tint.opacity(0.28), lineWidth: 1)
        )
    }
}

// MARK: - Enrichment gating

/// Wraps an enrichment widget so that when homework is piling up, the widget
/// shows a locked overlay ("Finish your homework first") instead of its normal
/// interactive content, and disables interaction underneath.
private struct EnrichmentGateModifier: ViewModifier {
    let locked: Bool
    let dueCount: Int

    func body(content: Content) -> some View {
        content
            .allowsHitTesting(!locked)
            .overlay {
                if locked {
                    ZStack {
                        RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                            .fill(.ultraThinMaterial)
                        VStack(spacing: 4) {
                            Text("🔒 Finish your homework first")
                                .font(Typography.body.weight(.bold))
                                .foregroundStyle(Palette.text)
                                .multilineTextAlignment(.center)
                            Text("\(dueCount) due today")
                                .font(Typography.caption)
                                .foregroundStyle(Palette.textSecond)
                        }
                        .padding(Space.md)
                    }
                    .transition(.opacity)
                }
            }
    }
}

private extension View {
    /// Apply the enrichment lock overlay to a widget when `store.enrichmentLocked`.
    func enrichmentGated(locked: Bool, dueCount: Int) -> some View {
        modifier(EnrichmentGateModifier(locked: locked, dueCount: dueCount))
    }
}

// MARK: - Daily content widgets (ported from the web widgets grid)

struct QuoteWidget: View {
    @Environment(AppStore.self) private var store
    @State private var flipped = false
    @State private var reflection = ""
    @State private var saved = false

    var body: some View {
        let q = Daily.quote
        return DashCard("💬", "Quote of the Day", tint: Palette.coral) {
            ZStack {
                VStack(alignment: .leading, spacing: Space.sm) {
                    Text("“\(q.text)”")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("— \(q.author)").font(Typography.caption).foregroundStyle(Palette.textSecond)
                    Text("Tap to reflect ✏️").font(Typography.caption).foregroundStyle(Palette.coral)
                }
                .opacity(flipped ? 0 : 1)
                .rotation3DEffect(.degrees(flipped ? 90 : 0), axis: (x: 0, y: 1, z: 0))

                VStack(alignment: .leading, spacing: Space.sm) {
                    Text("Your reflection…").font(Typography.caption.weight(.semibold)).foregroundStyle(Palette.textSecond)
                    TextField("What did this quote make you think of?", text: $reflection, axis: .vertical)
                        .lineLimit(2...4)
                        .padding(Space.sm)
                        .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                    HStack {
                        Button {
                            Haptics.selection()
                            withAnimation(.easeInOut(duration: 0.3)) { flipped = false }
                        } label: {
                            Text("Cancel").font(Typography.caption.weight(.semibold)).foregroundStyle(Palette.textSecond)
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        if saved {
                            Label("Saved", systemImage: "checkmark.circle.fill")
                                .font(Typography.caption.weight(.bold))
                                .foregroundStyle(Palette.green)
                        } else {
                            Button {
                                Haptics.selection()
                                let text = reflection
                                Task {
                                    _ = await store.addNote(body: text, source: "quote", ref: ["kind": "quote", "id": "", "context": q.text])
                                    saved = true
                                    try? await Task.sleep(nanoseconds: 700_000_000)
                                    withAnimation(.easeInOut(duration: 0.3)) { flipped = false }
                                    reflection = ""
                                    saved = false
                                }
                            } label: {
                                Text("Save reflection")
                                    .font(Typography.caption.weight(.bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
                                    .background(Palette.coral, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .disabled(reflection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }
                .opacity(flipped ? 1 : 0)
                .rotation3DEffect(.degrees(flipped ? 0 : -90), axis: (x: 0, y: 1, z: 0))
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard !flipped else { return }
            Haptics.selection()
            withAnimation(.easeInOut(duration: 0.3)) { flipped = true }
        }
        .enrichmentGated(locked: store.enrichmentLocked, dueCount: store.homeworkDueTodayCount)
    }
}

/// New social-emotional check-in widget: pick a feeling emoji + optional note.
struct MoodWidget: View {
    @Environment(AppStore.self) private var store
    private let feelings = ["😀", "🙂", "😐", "😢", "😡", "😰"]
    @State private var picked: String? = nil
    @State private var text = ""
    @State private var saved = false

    var body: some View {
        DashCard("💗", "How are you feeling?", tint: Palette.coral) {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(spacing: Space.sm) {
                    ForEach(feelings, id: \.self) { emoji in
                        Button {
                            Haptics.selection()
                            picked = emoji
                        } label: {
                            Text(emoji)
                                .font(.system(size: 24))
                                .padding(6)
                                .background(
                                    picked == emoji ? Palette.coral.opacity(0.22) : Color.clear,
                                    in: Circle()
                                )
                                .overlay(
                                    Circle().strokeBorder(picked == emoji ? Palette.coral : .clear, lineWidth: 1.5)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
                TextField("Anything big you felt today?", text: $text, axis: .vertical)
                    .lineLimit(2...4)
                    .font(Typography.body)
                    .padding(Space.sm)
                    .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                HStack {
                    Spacer()
                    if saved {
                        Label("Saved", systemImage: "checkmark.circle.fill")
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(Palette.green)
                    } else {
                        Button {
                            Haptics.selection()
                            let emoji = picked ?? "🙂"
                            let body = "Feeling \(emoji). \(text)"
                            Task {
                                _ = await store.addNote(body: body, source: "social")
                                saved = true
                                try? await Task.sleep(nanoseconds: 900_000_000)
                                saved = false
                                text = ""
                                picked = nil
                            }
                        } label: {
                            Text("Save")
                                .font(Typography.caption.weight(.bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
                                .background(Palette.coral, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(picked == nil)
                    }
                }
            }
        }
        .enrichmentGated(locked: store.enrichmentLocked, dueCount: store.homeworkDueTodayCount)
    }
}

struct WordWidget: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        DashCard("📖", "SAT Word of the Day", tint: Palette.teal) {
            SATActivityView()
        }
        .enrichmentGated(locked: store.enrichmentLocked, dueCount: store.homeworkDueTodayCount)
    }
}

struct FactWidget: View {
    var body: some View {
        let f = Daily.fact
        return DashCard(f.icon, "\(f.type) Fact", tint: Palette.orange) {
            Text(f.text).font(Typography.body).foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct NewsWidget: View {
    @Environment(AppStore.self) private var store
    @State private var reflection = ""
    @State private var saved = false

    var body: some View {
        let n = Daily.news
        return DashCard("📰", "Interesting News", tint: Palette.green) {
            VStack(alignment: .leading, spacing: 6) {
                Text(n.cat)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.green)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Palette.green.opacity(0.16), in: Capsule())
                Text(n.headline).font(Typography.body.weight(.bold)).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(n.summary).font(Typography.caption).foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)

                Divider().overlay(Palette.border)

                Text("What do you think about this?")
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.textSecond)
                TextField("Share your thoughts…", text: $reflection, axis: .vertical)
                    .lineLimit(2...4)
                    .font(Typography.body)
                    .padding(Space.sm)
                    .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                HStack {
                    Spacer()
                    if saved {
                        Label("Saved", systemImage: "checkmark.circle.fill")
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(Palette.green)
                    } else {
                        Button {
                            Haptics.selection()
                            let text = reflection
                            Task {
                                _ = await store.addNote(body: text, source: "news", ref: ["kind": "news", "id": "", "context": n.headline])
                                saved = true
                                try? await Task.sleep(nanoseconds: 900_000_000)
                                saved = false
                                reflection = ""
                            }
                        } label: {
                            Text("Save")
                                .font(Typography.caption.weight(.bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
                                .background(Palette.green, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(reflection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
        .enrichmentGated(locked: store.enrichmentLocked, dueCount: store.homeworkDueTodayCount)
    }
}

struct QuizWidget: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        DashCard("🧠", "Daily Brain Teaser", tint: Palette.violet) {
            BrainTeaserView()
        }
        .enrichmentGated(locked: store.enrichmentLocked, dueCount: store.homeworkDueTodayCount)
    }
}
