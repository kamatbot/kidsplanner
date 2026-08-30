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
// with a label-first MicroLabel. Tapping a row opens its full experience in a
// sheet; current news comes from the authenticated recent-news service.
struct DailyFiveCard: View {
    @Environment(AppStore.self) private var store
    /// Kid variant per canvas-1g: no quote row, solid full-width CTA instead of
    /// the parent's outline button.
    var isKid: Bool = false

    private enum DailySheet: String, Identifiable { case quote, word, teaser, puzzle, news; var id: String { rawValue } }
    @State private var activeSheet: DailySheet? = nil
    @State private var puzzle: DailyPuzzleResponse?
    @State private var news: RecentNewsItem?
    @State private var extrasLoading = true
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

                if let puzzle, puzzle.available {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        MicroLabel(text: puzzle.type == "crossword" ? "Weekend puzzle" : "Wednesday puzzle")
                        Button { Haptics.selection(); activeSheet = .puzzle } label: {
                            HStack(spacing: Space.sm) {
                                Text(puzzle.type == "crossword" ? "🧩" : "🔢")
                                Text(puzzle.title ?? "Today's puzzle")
                                    .font(Typography.body.weight(.semibold))
                                    .foregroundStyle(Palette.text)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(Typography.caption)
                                    .foregroundStyle(Palette.textSecond)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens today's interactive puzzle")
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    MicroLabel(text: "Interesting news")
                    HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                        if let news, let url = URL(string: news.url) {
                            Link(destination: url) {
                                Text(news.headline)
                                    .font(Typography.body.weight(.semibold))
                                    .foregroundStyle(Palette.text)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        } else {
                            Text(extrasLoading ? "Finding a fresh story…" : "No recent story is available right now.")
                                .font(Typography.body.weight(.semibold))
                                .foregroundStyle(Palette.textSecond)
                                .multilineTextAlignment(.leading)
                        }
                        Spacer(minLength: Space.sm)
                        Button { Haptics.selection(); activeSheet = .news } label: {
                            Image(systemName: "chevron.down")
                                .font(Typography.caption)
                                .foregroundStyle(Palette.textSecond)
                        }
                        .buttonStyle(.plain)
                        .disabled(news == nil)
                        .accessibilityLabel("Open news details")
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .enrichmentGated(locked: store.enrichmentLocked, dueCount: store.homeworkDueTodayCount)
        .task { await loadDailyExtras() }
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
        case .puzzle:
            if let puzzle { DailyPuzzleView(puzzle: puzzle) }
        case .news: NewsWidget(news: news)
        }
    }
    private func sheetTitle(_ sheet: DailySheet) -> String {
        switch sheet {
        case .quote: return "Quote of the Day"
        case .word: return "SAT Word of the Day"
        case .teaser: return "Daily Brain Teaser"
        case .puzzle: return puzzle?.title ?? "Today's Puzzle"
        case .news: return "Interesting News"
        }
    }

    private func loadDailyExtras() async {
        extrasLoading = true
        async let puzzleRequest = try? APIClient.shared.dailyPuzzle(date: Agenda.todayKey())
        async let newsRequest = try? APIClient.shared.recentNews()
        puzzle = await puzzleRequest
        if let items = await newsRequest?.items, !items.isEmpty {
            let studentItems = items.filter { $0.source == "NASA STEM" || $0.source == "NASA Kids" }
            let candidates = studentItems.isEmpty ? items : studentItems
            news = candidates[Daily.index(candidates.count)]
        } else {
            news = nil
        }
        extrasLoading = false
    }
}

// MARK: - News widget (hosted in the Daily 5 "Interesting news" sheet)

/// Headline, summary, "Read the full story" link, and reflection composer —
/// moved here from TodayView's standalone `NewsCard` now that news lives
/// inside the Daily 5 flow (matching the web app) instead of its own card.
struct NewsWidget: View {
    let news: RecentNewsItem?
    @Environment(AppStore.self) private var store
    @State private var reflection = ""
    @State private var saved = false

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                MicroLabel(text: "Interesting news")
                if let news {
                    Text("\(news.source) · \(freshness(news.publishedAt))")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.textSecond)
                    Text(news.headline).font(Typography.body.weight(.bold)).foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(news.summary).font(Typography.caption).foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("No story published in the last 14 days is available right now.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                }
                if let news, let url = URL(string: news.url) {
                    Link(destination: url) {
                        Label("Read the full story", systemImage: "arrow.up.right.square")
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(Palette.accent)
                    }
                }
                if let news {
                    Divider().overlay(Palette.border)
                    Text(news.question)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                    TextField("Write what you think…", text: $reflection, axis: .vertical)
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
                                    _ = await store.addNote(body: text, source: "news", ref: ["kind": "news", "id": news.id, "context": "\(news.headline)\n\n\(news.summary)\n\n\(news.url)"])
                                    saved = true
                                    try? await Task.sleep(nanoseconds: 900_000_000)
                                    saved = false
                                    reflection = ""
                                }
                            } label: {
                                Text("Save response")
                                    .font(Typography.caption.weight(.bold))
                                    .foregroundStyle(Palette.onAccent)
                                    .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
                                    .background(Palette.accent, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .frame(minHeight: 44)
                            .disabled(reflection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .enrichmentGated(locked: store.enrichmentLocked, dueCount: store.homeworkDueTodayCount)
    }

    private func freshness(_ publishedAt: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: publishedAt) else { return "Recent" }
        let days = max(0, Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: date), to: Calendar.current.startOfDay(for: Date())).day ?? 0)
        return days == 0 ? "Today" : "\(days) day\(days == 1 ? "" : "s") ago"
    }
}

// MARK: - Wednesday / weekend puzzle

private final class CrosswordUITextField: UITextField {
    var onDeleteBackward: (() -> Void)?

    override func deleteBackward() {
        onDeleteBackward?()
    }
}

private struct CrosswordCellField: UIViewRepresentable {
    let text: String
    let isFocused: Bool
    let fontSize: CGFloat
    let onFocus: () -> Void
    let onInput: (String) -> Void
    let onDeleteBackward: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> CrosswordUITextField {
        let field = CrosswordUITextField()
        field.delegate = context.coordinator
        field.autocapitalizationType = .allCharacters
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.textAlignment = .center
        field.borderStyle = .none
        field.backgroundColor = .clear
        field.adjustsFontSizeToFitWidth = true
        return field
    }

    func updateUIView(_ field: CrosswordUITextField, context: Context) {
        context.coordinator.parent = self
        field.text = text
        field.font = .systemFont(ofSize: fontSize, weight: .bold)
        field.textColor = UIColor(Palette.text)
        field.onDeleteBackward = onDeleteBackward
        if isFocused, !field.isFirstResponder {
            DispatchQueue.main.async { field.becomeFirstResponder() }
        }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: CrosswordCellField

        init(parent: CrosswordCellField) {
            self.parent = parent
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            parent.onFocus()
        }

        func textField(
            _ textField: UITextField,
            shouldChangeCharactersIn range: NSRange,
            replacementString string: String
        ) -> Bool {
            if !string.isEmpty {
                parent.onInput(string)
            }
            return false
        }
    }
}

private struct DailyPuzzleView: View {
    let puzzle: DailyPuzzleResponse
    private let progressIdentity: DailyPuzzleProgressIdentity
    private let progressKeys: Set<String>
    @State private var answers: [String: String]
    @State private var resultMessage: String?
    @State private var activeCrosswordEntryID: String?
    @State private var focusedCrosswordCell: String?

    init(puzzle: DailyPuzzleResponse) {
        self.puzzle = puzzle
        let identity = DailyPuzzleProgressIdentity(puzzle: puzzle)
        progressIdentity = identity
        progressKeys = DailyPuzzleProgressStore.allowedKeys(for: puzzle)
        _answers = State(initialValue: DailyPuzzleProgressStore.load(
            for: identity,
            allowedKeys: progressKeys
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Text(puzzle.instructions ?? "Take your time and have fun.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            if let crossword = puzzle.crossword {
                crosswordView(crossword)
                crosswordClues(crossword)
            } else if let sudoku = puzzle.sudoku {
                sudokuView(sudoku)
            } else {
                Text("No puzzle today — come back Wednesday or this weekend.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
            }
            if let resultMessage {
                Text(resultMessage)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(resultMessage.hasPrefix("You did") ? Palette.green : Palette.warn)
                    .accessibilityLabel(resultMessage)
            }
            HStack(spacing: Space.md) {
                Button("Clear") {
                    answers = [:]
                    resultMessage = nil
                    DailyPuzzleProgressStore.clear(for: progressIdentity)
                }
                .buttonStyle(.bordered)
                .tint(Palette.textSecond)
                .frame(minHeight: 44)
                Spacer()
                AccentButton(title: "Check puzzle", systemImage: "checkmark.circle.fill") {
                    checkPuzzle()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func crosswordView(_ crossword: CrosswordPuzzle) -> some View {
        let columns = max(1, crossword.cols)
        let rows = max(1, crossword.rows)
        let spacing: CGFloat = 1
        let maximumGridWidth = CGFloat(columns) * 34 + CGFloat(columns - 1) * spacing

        return LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(minimum: 1, maximum: 34), spacing: spacing), count: columns),
            spacing: spacing
        ) {
            ForEach(0..<(rows * columns), id: \.self) { index in
                let row = index / columns
                let col = index % columns
                let letter = solutionLetter(crossword.solution, row: row, col: col)
                if letter == "." {
                    Color.clear
                        .aspectRatio(1, contentMode: .fit)
                } else {
                    ZStack(alignment: .topLeading) {
                        CrosswordCellField(
                            text: answers[crosswordCellKey(row: row, col: col)] ?? "",
                            isFocused: focusedCrosswordCell == crosswordCellKey(row: row, col: col),
                            // Keep the incumbent readable type on larger devices;
                            // CrosswordCellField's adjustsFontSizeToFitWidth scales
                            // the single-letter field down for narrow columns.
                            fontSize: 18,
                            onFocus: {
                                activateCrosswordEntry(containingRow: row, col: col, in: crossword)
                                focusedCrosswordCell = crosswordCellKey(row: row, col: col)
                            },
                            onInput: { value in
                                letterBinding(row: row, col: col, crossword: crossword).wrappedValue = value
                            },
                            onDeleteBackward: {
                                deleteCrosswordLetter(row: row, col: col, crossword: crossword)
                            }
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Palette.panel)
                        .overlay(Rectangle().strokeBorder(Palette.border, lineWidth: 1))
                        .accessibilityLabel("Crossword row \(row + 1), column \(col + 1)")
                        if let number = crossword.entries.first(where: { $0.row == row && $0.col == col })?.number {
                            Text("\(number)")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(Palette.textSecond)
                                .padding(2)
                                .accessibilityHidden(true)
                        }
                    }
                    .aspectRatio(1, contentMode: .fit)
                }
            }
        }
        .frame(maxWidth: maximumGridWidth, alignment: .center)
        .aspectRatio(CGFloat(columns) / CGFloat(rows), contentMode: .fit)
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityLabel("Crossword grid with \(crossword.entries.count) words")
    }

    private func crosswordClues(_ crossword: CrosswordPuzzle) -> some View {
        VStack(alignment: .leading, spacing: Space.md) {
            ForEach(["across", "down"], id: \.self) { direction in
                let entries = crossword.entries.filter { $0.direction == direction }
                if !entries.isEmpty {
                    Text(direction.capitalized)
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                    ForEach(entries) { entry in
                        Button {
                            activateCrosswordEntry(entry, focusFirstBlank: true)
                        } label: {
                            Text("\(entry.number). \(entry.clue)")
                                .font(Typography.body)
                                .foregroundStyle(Palette.text)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(entry.number) \(direction), \(entry.clue)")
                        .accessibilityHint("Selects this answer so you can type the whole word")
                    }
                }
            }
        }
    }

    private func sudokuView(_ sudoku: SudokuPuzzle) -> some View {
        GeometryReader { geometry in
            let spacing: CGFloat = 1
            let cellSize = min(42, (geometry.size.width - 8 * spacing) / 9)
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(cellSize), spacing: spacing), count: 9), spacing: spacing) {
                ForEach(0..<81, id: \.self) { index in
                    let row = index / 9
                    let col = index % 9
                    let given = character(sudoku.puzzle, at: index)
                    Group {
                        if given != "0" {
                            Text(given)
                                .font(.system(size: cellSize * 0.5, weight: .bold, design: .rounded))
                                .foregroundStyle(Palette.text)
                        } else {
                            TextField("", text: digitBinding(index: index))
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.center)
                                .font(.system(size: cellSize * 0.5, weight: .semibold, design: .rounded))
                                .foregroundStyle(Palette.accent)
                                .accessibilityLabel("Sudoku row \(row + 1), column \(col + 1)")
                        }
                    }
                    .frame(width: cellSize, height: cellSize)
                    .background(given == "0" ? Palette.panel : Palette.panel2)
                    .overlay(Rectangle().strokeBorder(Palette.border, lineWidth: 1))
                    .overlay(alignment: .trailing) {
                        if col == 2 || col == 5 { Rectangle().fill(Palette.textSecond).frame(width: 2) }
                    }
                    .overlay(alignment: .bottom) {
                        if row == 2 || row == 5 { Rectangle().fill(Palette.textSecond).frame(height: 2) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .frame(height: 9 * 43)
        .accessibilityLabel("Nine by nine Sudoku grid, \(sudoku.difficulty) difficulty")
    }

    private func letterBinding(row: Int, col: Int, crossword: CrosswordPuzzle) -> Binding<String> {
        let cellKey = crosswordCellKey(row: row, col: col)
        return Binding(
            get: { answers[cellKey] ?? "" },
            set: { value in
                let letters = value.uppercased().filter(\.isLetter)
                guard let entry = activeEntry(containingRow: row, col: col, in: crossword),
                      let index = crosswordCells(for: entry).firstIndex(where: { $0.row == row && $0.col == col }) else {
                    return
                }
                activeCrosswordEntryID = entry.id
                if letters.isEmpty {
                    answers.removeValue(forKey: cellKey)
                } else if letters.count > 1 {
                    _ = DailyPuzzleCrosswordInput.distribute(
                        String(letters),
                        into: &answers,
                        entry: entry,
                        selectedCellIndex: index
                    )
                } else {
                    answers[cellKey] = String(letters)
                    let cells = crosswordCells(for: entry)
                    if index + 1 < cells.count {
                        focusedCrosswordCell = crosswordCellKey(row: cells[index + 1].row, col: cells[index + 1].col)
                    }
                }
                DailyPuzzleProgressStore.save(answers, for: progressIdentity, allowedKeys: progressKeys)
            }
        )
    }

    private func crosswordCellKey(row: Int, col: Int) -> String {
        DailyPuzzleCrosswordInput.cellKey(row: row, col: col)
    }

    private func crosswordCells(for entry: CrosswordEntry) -> [(row: Int, col: Int)] {
        DailyPuzzleCrosswordInput.cells(for: entry)
    }

    private func deleteCrosswordLetter(row: Int, col: Int, crossword: CrosswordPuzzle) {
        guard let entry = activeEntry(containingRow: row, col: col, in: crossword),
              let index = crosswordCells(for: entry).firstIndex(where: { $0.row == row && $0.col == col }) else {
            return
        }
        activeCrosswordEntryID = entry.id
        focusedCrosswordCell = DailyPuzzleCrosswordInput.deleteBackward(
            from: &answers,
            entry: entry,
            selectedCellIndex: index
        )
        resultMessage = nil
        DailyPuzzleProgressStore.save(answers, for: progressIdentity, allowedKeys: progressKeys)
    }

    private func activeEntry(containingRow row: Int, col: Int, in crossword: CrosswordPuzzle) -> CrosswordEntry? {
        if let activeCrosswordEntryID,
           let active = crossword.entries.first(where: { $0.id == activeCrosswordEntryID }),
           crosswordCells(for: active).contains(where: { $0.row == row && $0.col == col }) {
            return active
        }
        return crossword.entries.first(where: { $0.row == row && $0.col == col })
            ?? crossword.entries.first(where: { crosswordCells(for: $0).contains(where: { $0.row == row && $0.col == col }) })
    }

    private func activateCrosswordEntry(containingRow row: Int, col: Int, in crossword: CrosswordPuzzle) {
        guard let entry = activeEntry(containingRow: row, col: col, in: crossword) else { return }
        activeCrosswordEntryID = entry.id
    }

    private func activateCrosswordEntry(_ entry: CrosswordEntry, focusFirstBlank: Bool) {
        activeCrosswordEntryID = entry.id
        guard focusFirstBlank else { return }
        let cells = crosswordCells(for: entry)
        let target = cells.first(where: { answers[crosswordCellKey(row: $0.row, col: $0.col), default: ""].isEmpty }) ?? cells.first
        if let target {
            focusedCrosswordCell = crosswordCellKey(row: target.row, col: target.col)
        }
    }

    private func digitBinding(index: Int) -> Binding<String> {
        let cellKey = "s-\(index)"
        return Binding(
            get: { answers[cellKey] ?? "" },
            set: {
                answers[cellKey] = String($0.filter { ("1"..."9").contains(String($0)) }.suffix(1))
                DailyPuzzleProgressStore.save(answers, for: progressIdentity, allowedKeys: progressKeys)
            }
        )
    }

    private func checkPuzzle() {
        let required: [(String, String)]
        if let crossword = puzzle.crossword {
            required = crossword.solution.enumerated().flatMap { row, line in
                Array(line).enumerated().compactMap { col, letter in
                    letter == "." ? nil : ("c-\(row)-\(col)", String(letter))
                }
            }
        } else if let sudoku = puzzle.sudoku {
            required = (0..<81).compactMap { index in
                character(sudoku.puzzle, at: index) == "0" ? ("s-\(index)", character(sudoku.solution, at: index)) : nil
            }
        } else {
            return
        }
        let correct = required.filter { answers[$0.0]?.uppercased() == $0.1 }.count
        if correct == required.count {
            resultMessage = "You did it — every answer is correct! 🎉"
            Haptics.notify(.success)
        } else {
            let unanswered = required.filter { (answers[$0.0] ?? "").isEmpty }.count
            resultMessage = unanswered > 0
                ? "\(unanswered) square\(unanswered == 1 ? "" : "s") still need an answer."
                : "\(correct) of \(required.count) squares are correct — look again at the clues."
            Haptics.notify(.warning)
        }
    }

    private func solutionLetter(_ rows: [String], row: Int, col: Int) -> Character {
        guard rows.indices.contains(row) else { return "." }
        return character(rows[row], at: col).first ?? "."
    }

    private func character(_ text: String, at index: Int) -> String {
        guard text.indices.contains(text.index(text.startIndex, offsetBy: min(index, text.count))) else { return "" }
        return String(text[text.index(text.startIndex, offsetBy: index)])
    }
}
