import SwiftUI
import UIKit

/// Puts the keyboard away. The dashboard's free-text fields use `axis: .vertical`
/// (so Return inserts a newline instead of dismissing) and live inside a
/// ScrollView; the dashboard dismisses on a background tap (chat-style) using this.
func famDismissKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}

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

extension View {
    /// Apply the enrichment lock overlay to a widget when `store.enrichmentLocked`.
    /// Internal (not file-private) — also used by TodayView's Daily 5 / News cards.
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
                                    _ = await store.addNote(body: text, source: "quote", ref: ["kind": "quote", "id": "", "context": "\u{201C}\(q.text)\u{201D} — \(q.author)"])
                                    saved = true
                                    try? await Task.sleep(nanoseconds: 700_000_000)
                                    withAnimation(.easeInOut(duration: 0.3)) { flipped = false }
                                    reflection = ""
                                    saved = false
                                }
                            } label: {
                                Text("Save reflection")
                                    .font(Typography.caption.weight(.bold))
                                    .foregroundStyle(Palette.onAccent)
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

struct WordWidget: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        DashCard("📖", "SAT Word of the Day", tint: Palette.teal) {
            SATActivityView()
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

// MARK: - Daily 5 card (Horizon, canvas-1f/1g)
//
// Folds the quote, SAT word-of-the-day, brain-teaser, and news widgets above
// into one compact card, matching the web app's Daily 5 order (commit
// f148d7b): Quote / Word / Brain teaser / Interesting news, each row starting
// with a label-first MicroLabel. Tapping a row opens the full existing
// experience in a sheet; the news headline itself is a tappable link straight
// to the article (Daily.news.articleLink), with a chevron opening the fuller
// news sheet. Underlying views/sheets/flows (QuoteWidget, SATActivityView,
// BrainTeaserView, NewsWidget) are unchanged, just re-hosted.
struct DailyFiveCard: View {
    @Environment(AppStore.self) private var store
    /// Kid variant per canvas-1g: no quote row, solid full-width CTA instead of
    /// the parent's outline button.
    var isKid: Bool = false

    private enum DailySheet: String, Identifiable { case quote, word, teaser, news; var id: String { rawValue } }
    @State private var activeSheet: DailySheet? = nil
    @AppStorage(Daily5Done.teaserKey) private var teaserDoneStamp = ""

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.md) {
                MicroLabel(text: "Daily 5")

                if !isKid {
                    VStack(alignment: .leading, spacing: 2) {
                        MicroLabel(text: "Quote")
                        Button { Haptics.selection(); activeSheet = .quote } label: {
                            Text("“\(Daily.quote.text)”")
                                .font(Typography.caption.italic())
                                .foregroundStyle(Palette.textSecond)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .buttonStyle(.plain)
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    MicroLabel(text: "Word")
                    Button { Haptics.selection(); activeSheet = .word } label: {
                        HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                            Text(Daily.word.word).font(Typography.body.weight(.bold)).foregroundStyle(Palette.accent)
                            Text(Daily.word.def).font(Typography.caption).foregroundStyle(Palette.textSecond).lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                }

                if !Daily5Done.isToday(teaserDoneStamp) {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        MicroLabel(text: "Brain teaser")
                        if isKid {
                            AccentButton(title: "Play today's quiz") { activeSheet = .teaser }
                        } else {
                            Button { Haptics.selection(); activeSheet = .teaser } label: {
                                Text("Take today's quiz →")
                                    .font(Typography.body.weight(.semibold))
                                    .foregroundStyle(Palette.accent)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, Space.sm + 2)
                                    .background(
                                        RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                                            .strokeBorder(Palette.border, lineWidth: 1)
                                    )
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    MicroLabel(text: "Interesting news")
                    HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                        if let url = URL(string: Daily.news.articleLink) {
                            Link(destination: url) {
                                Text(Daily.news.headline)
                                    .font(Typography.body.weight(.semibold))
                                    .foregroundStyle(Palette.text)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: Space.sm)
                        Button { Haptics.selection(); activeSheet = .news } label: {
                            Image(systemName: "chevron.down")
                                .font(Typography.caption)
                                .foregroundStyle(Palette.textSecond)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .enrichmentGated(locked: store.enrichmentLocked, dueCount: store.homeworkDueTodayCount)
        .sheet(item: $activeSheet) { sheet in
            NavigationStack {
                ScrollView { sheetContent(sheet).padding(Space.lg) }
                    .background(ScreenBackground())
                    .navigationTitle(sheetTitle(sheet))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { activeSheet = nil } } }
            }
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: DailySheet) -> some View {
        switch sheet {
        case .quote: QuoteWidget()
        case .word: WordWidget()
        case .teaser: QuizWidget()
        case .news: NewsWidget()
        }
    }
    private func sheetTitle(_ sheet: DailySheet) -> String {
        switch sheet {
        case .quote: return "Quote of the Day"
        case .word: return "SAT Word of the Day"
        case .teaser: return "Daily Brain Teaser"
        case .news: return "Interesting News"
        }
    }
}

// MARK: - News widget (hosted in the Daily 5 "Interesting news" sheet)

/// Headline, summary, "Read the full story" link, and reflection composer —
/// moved here from TodayView's standalone `NewsCard` now that news lives
/// inside the Daily 5 flow (matching the web app) instead of its own card.
struct NewsWidget: View {
    @Environment(AppStore.self) private var store
    @State private var reflection = ""
    @State private var saved = false

    var body: some View {
        let n = Daily.news
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                MicroLabel(text: "Interesting news")
                Text(n.headline).font(Typography.body.weight(.bold)).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(n.summary).font(Typography.caption).foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                if let url = URL(string: n.articleLink) {
                    Link(destination: url) {
                        Label("Read the full story", systemImage: "arrow.up.right.square")
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(Palette.accent)
                    }
                }
                Divider().overlay(Palette.border)
                TextField("Share your thoughts…", text: $reflection, axis: .vertical)
                    .lineLimit(2...4)
                    .font(Typography.body)
                    .padding(Space.sm)
                    .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                HStack {
                    Spacer()
                    if saved {
                        Label("Saved", systemImage: "checkmark.circle.fill")
                            .font(Typography.caption.weight(.bold)).foregroundStyle(Palette.green)
                    } else {
                        Button {
                            Haptics.selection()
                            let text = reflection
                            Task {
                                _ = await store.addNote(body: text, source: "news", ref: ["kind": "news", "id": "", "context": "\(n.headline)\n\n\(n.summary)\n\n\(n.articleLink)"])
                                saved = true
                                try? await Task.sleep(nanoseconds: 900_000_000)
                                saved = false
                                reflection = ""
                            }
                        } label: {
                            Text("Save")
                                .font(Typography.caption.weight(.bold))
                                .foregroundStyle(Palette.onAccent)
                                .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
                                .background(Palette.accent, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(reflection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .enrichmentGated(locked: store.enrichmentLocked, dueCount: store.homeworkDueTodayCount)
    }
}
