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
// Folds the quote, SAT word-of-the-day, and brain-teaser widgets above into one
// compact card — a quote line + word row (tap either to open the full existing
// experience in a sheet) and a "quiz" CTA that opens the brain teaser. Their
// underlying views/sheets/flows (QuoteWidget, SATActivityView, BrainTeaserView)
// are unchanged, just re-hosted.
struct DailyFiveCard: View {
    @Environment(AppStore.self) private var store
    /// Kid variant per canvas-1g: no quote row, solid full-width CTA instead of
    /// the parent's outline button.
    var isKid: Bool = false

    private enum DailySheet: String, Identifiable { case quote, word, teaser; var id: String { rawValue } }
    @State private var activeSheet: DailySheet? = nil

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                MicroLabel(text: "Daily 5")

                if !isKid {
                    Button { Haptics.selection(); activeSheet = .quote } label: {
                        Text("“\(Daily.quote.text)”")
                            .font(Typography.caption.italic())
                            .foregroundStyle(Palette.textSecond)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .buttonStyle(.plain)
                }

                Button { Haptics.selection(); activeSheet = .word } label: {
                    HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                        if !isKid { MicroLabel(text: "Word") }
                        Text(Daily.word.word).font(Typography.body.weight(.bold)).foregroundStyle(Palette.accent)
                        Text(Daily.word.def).font(Typography.caption).foregroundStyle(Palette.textSecond).lineLimit(1)
                    }
                }
                .buttonStyle(.plain)

                Spacer(minLength: Space.sm)

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
        }
    }
    private func sheetTitle(_ sheet: DailySheet) -> String {
        switch sheet {
        case .quote: return "Quote of the Day"
        case .word: return "SAT Word of the Day"
        case .teaser: return "Daily Brain Teaser"
        }
    }
}
