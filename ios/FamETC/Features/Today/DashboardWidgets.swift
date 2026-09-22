import Foundation
import SwiftUI
import UIKit

/// Puts the keyboard away. The dashboard's free-text fields use `axis: .vertical`
/// (so Return inserts a newline instead of dismissing) and live inside a
/// ScrollView; the dashboard dismisses on a background tap (chat-style) using this.
func famDismissKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}

// MARK: - Daily content widgets

struct QuoteWidget: View {
    @Environment(AppStore.self) private var store
    @Binding var reflection: String
    @State private var saved = false
    @State private var saving = false
    @State private var saveFailed = false

    var body: some View {
        let q = Daily.quote
        return VStack(alignment: .leading, spacing: Space.lg) {
            LearningActivityHeading(title: "Quote of the Day", subtitle: "Pause for a thought, then make it your own.", systemImage: "quote.bubble")
            Text("“\(q.text)”")
                .font(Typography.title)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            Text("— \(q.author)").font(Typography.body).foregroundStyle(Palette.textSecond)
            Divider().overlay(Palette.border)
            Text("Your reflection").font(Typography.cardTitle).foregroundStyle(Palette.text)
            TextField("What did this quote make you think of?", text: $reflection, axis: .vertical)
                .lineLimit(3...6)
                .font(Typography.body)
                .padding(Space.md)
                .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                .disabled(saving || saved)
                .accessibilityIdentifier("quote.reflection")
                .onChange(of: reflection) { _, _ in
                    if !saving { saved = false; saveFailed = false }
                }
            if saved {
                LearningFeedback(title: "Reflection saved", message: "Your thought is in Notes.", kind: .success)
            } else if saveFailed {
                LearningFeedback(title: "Couldn't save reflection", message: "Your writing is still here. Try again when you're ready.", kind: .retry)
            }
            Button {
                Haptics.selection()
                let text = reflection
                let userID = store.me?.id
                let day = Agenda.todayKey()
                let scope = Daily5Reporter.capture(store)
                saving = true
                saveFailed = false
                Task {
                    let note = await store.addNote(body: text, source: "quote", ref: ["kind": "quote", "id": "", "context": "\u{201C}\(q.text)\u{201D} — \(q.author)"])
                    saving = false
                    guard store.me?.id == userID, Agenda.todayKey() == day else { return }
                    if note != nil {
                        Daily5Reporter.report("quote", "completed", store: store, scope: scope)
                        saved = true
                    } else {
                        saveFailed = true
                    }
                }
            } label: {
                Label(saving ? "Saving…" : saveFailed ? "Retry save" : "Save reflection", systemImage: saved ? "checkmark.circle.fill" : "square.and.arrow.down")
                    .font(Typography.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Palette.accent)
            .disabled(saving || saved || reflection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("quote.save")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct WordWidget: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            LearningActivityHeading(title: "SAT Word of the Day", subtitle: "Build confidence one useful word at a time.", systemImage: "textformat.abc")
            SATActivityView()
        }
    }
}

struct QuizWidget: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            LearningActivityHeading(title: "Daily Brain Teaser", subtitle: "Take a quiet moment to reason it through.", systemImage: "brain.head.profile")
            BrainTeaserView()
        }
    }
}

// MARK: - Daily 5 card (Horizon compact preview)

/// A compact, visual entry point for the five activities. The actual word,
/// quiz, puzzle, quote, and news experiences remain in their existing native
/// sheets so their completion and draft state keep the same ownership rules.
struct DailyFiveCard: View {
    @Environment(AppStore.self) private var store
    /// Kept for existing parent/kid call sites and the approved child variant.
    var isKid: Bool = false

    private enum DailySheet: Identifiable {
        case quote
        case word
        case teaser
        case puzzle(DailyPuzzleResponse)
        case news(RecentNewsItem)

        var id: String {
            switch self {
            case .quote: return "quote"
            case .word: return "word"
            case .teaser: return "teaser"
            case .puzzle(let puzzle): return "puzzle-\(puzzle.date)-\(puzzle.type ?? "")"
            case .news(let article): return "news-\(article.id)"
            }
        }
    }

    @State private var activeSheet: DailySheet?
    @State private var puzzle: DailyPuzzleResponse?
    @State private var newsChoices: [DailyNewsChoice] = []
    @State private var vocabulary: DailyVocabularyResponse?
    @State private var reflections: [String: String] = [:]
    @State private var quoteReflection = ""
    @State private var extrasScope = ""
    @State private var puzzleStatus = ""
    @State private var ideaSaved = false
    @State private var extrasLoading = true
    @State private var selectedNewsID: String?
    @State private var dailyFiveProgress: DailyFiveProgressPayload?
    @State private var dailyFiveProgressLoading = false

    var body: some View {
        TodayDailyFivePreview(
            isKid: isKid,
            statuses: activityStatuses,
            newsChoices: newsChoices,
            selectedNews: selectedNews,
            isLoading: extrasLoading || dailyFiveProgressLoading,
            progressKnown: dailyFiveProgress != nil,
            canRetry: !extrasLoading,
            onOpen: openActivity,
            onSelectNews: selectNews,
            onRetry: { Task { await loadDailyExtras() } }
        )
        .task(id: "\(store.me?.id ?? "")|\(Agenda.todayKey())") { await loadDailyExtras() }
        .onReceive(NotificationCenter.default.publisher(for: .famsRewardsChanged)) { _ in
            Task { await refreshServerProgress() }
        }
        .sheet(item: $activeSheet, onDismiss: refreshEngagement) { sheet in
            NavigationStack {
                ScrollView {
                    sheetContent(sheet)
                        .frame(maxWidth: sheetMaximumWidth(sheet), alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.horizontal, Space.lg)
                        .padding(.vertical, Space.xl)
                }
                .scrollDismissesKeyboard(.interactively)
                    .background(ScreenBackground())
                    .navigationTitle(sheetTitle(sheet))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") { activeSheet = nil }
                        }
                    }
            }
            .presentationSizing(.page)
        }
    }

    private func sheetMaximumWidth(_ sheet: DailySheet) -> CGFloat {
        if case .puzzle = sheet { return 1040 }
        return 760
    }

    private var selectedNews: RecentNewsItem? {
        newsChoices.first(where: { $0.article?.id == selectedNewsID })?.article
    }

    private var activityStatuses: [DailyFiveActivity: DailyFiveActivityStatus] {
        if extrasLoading || dailyFiveProgressLoading {
            return Dictionary(uniqueKeysWithValues: DailyFiveActivity.allCases.map {
                ($0, DailyFiveActivityStatus.loading)
            })
        }

        if let dailyFiveProgress, dailyFiveProgress.date == Agenda.todayKey() {
            return Dictionary(uniqueKeysWithValues: DailyFiveActivity.allCases.map {
                ($0, serverStatus(for: $0, progress: dailyFiveProgress))
            })
        }

        var result: [DailyFiveActivity: DailyFiveActivityStatus] = [:]
        result[.news] = ideaSaved || hasNote(source: "news") ? .completed : (newsChoices.allSatisfy { $0.article == nil } && !extrasLoading ? .unavailable : .available)
        result[.word] = vocabulary == nil ? .unavailable : .available
        result[.quote] = hasNote(source: "quote") ? .completed : .available
        result[.brain] = .available
        if let puzzle, puzzle.available {
            result[.puzzle] = puzzleStatus == "Puzzle solved" ? .completed : puzzleStatus == "Resume your puzzle" ? .started : .available
        } else {
            result[.puzzle] = .unavailable
        }
        return result
    }

    private func serverStatus(
        for activity: DailyFiveActivity,
        progress: DailyFiveProgressPayload
    ) -> DailyFiveActivityStatus {
        switch progress.parts[activity.progressPart]?.status {
        case "completed": return .completed
        case "started": return .started
        default:
            if activity == .puzzle && puzzle?.available != true { return .unavailable }
            if activity == .word && vocabulary == nil { return .unavailable }
            if activity == .news && newsChoices.allSatisfy({ $0.article == nil }) { return .unavailable }
            return .available
        }
    }

    private func hasNote(source: String) -> Bool {
        let ownAuthorIDs = Set([store.me?.id, store.me?.kidId].compactMap { $0 })
        return store.notes.contains {
            $0.source == source &&
                $0.date == Agenda.todayKey() &&
                ownAuthorIDs.contains($0.authorId)
        }
    }

    private func selectNews(_ article: RecentNewsItem) {
        guard newsChoices.contains(where: { $0.article?.id == article.id }) else { return }
        selectedNewsID = article.id
    }

    private func openActivity(_ activity: DailyFiveActivity) {
        Haptics.selection()
        switch activity {
        case .quote: activeSheet = .quote
        case .word: activeSheet = .word
        case .brain: activeSheet = .teaser
        case .puzzle:
            guard let puzzle, puzzle.available else {
                Task { await loadDailyExtras() }
                return
            }
            activeSheet = .puzzle(puzzle)
        case .news:
            guard let article = selectedNews ?? newsChoices.compactMap(\.article).first else { return }
            selectedNewsID = article.id
            activeSheet = .news(article)
        }
    }

    @ViewBuilder
    private func sheetContent(_ sheet: DailySheet) -> some View {
        switch sheet {
        case .quote: QuoteWidget(reflection: $quoteReflection).id(extrasScope)
        case .word: WordWidget()
        case .teaser: QuizWidget()
        case .puzzle(let puzzle):
            if let userID = store.me?.id { DailyPuzzleView(puzzle: puzzle, userID: userID) }
        case .news(let article):
            NewsWidget(news: article, vocabulary: vocabulary?.word, reflection: Binding(
                get: { reflections[article.id] ?? "" },
                set: { reflections[article.id] = $0 }
            )).id("\(extrasScope)|\(article.id)")
        }
    }

    private func sheetTitle(_ sheet: DailySheet) -> String {
        switch sheet {
        case .quote: return "Quote of the Day"
        case .word: return "SAT Word of the Day"
        case .teaser: return "Daily Brain Teaser"
        case .puzzle(let puzzle): return puzzle.title ?? "Today's Puzzle"
        case .news: return "Interesting News"
        }
    }

    private func loadDailyExtras() async {
        let userID = store.me?.id
        let day = Agenda.todayKey()
        let scope = "\(userID ?? "")|\(day)"
        if extrasScope != scope {
            reflections = [:]
            quoteReflection = ""
            selectedNewsID = nil
            dailyFiveProgress = nil
            extrasScope = scope
            activeSheet = nil
        }
        extrasLoading = true
        dailyFiveProgressLoading = store.me?.role == "kid"
        puzzle = nil
        newsChoices = DailyNewsSelection.choices(nil, day: day)
        vocabulary = nil
        refreshEngagement()
        async let puzzleRequest = try? APIClient.shared.dailyPuzzle(date: day)
        async let newsRequest = try? APIClient.shared.recentNews(date: day)
        async let wordRequest = try? APIClient.shared.dailyVocabulary(date: day)
        async let progressRequest = loadDailyFiveProgress(userID: userID, day: day)
        let loadedPuzzle = await puzzleRequest
        let loadedNews = await newsRequest
        let loadedWord = await wordRequest
        let loadedProgress = await progressRequest
        guard !Task.isCancelled, store.me?.id == userID, Agenda.todayKey() == day else { return }
        puzzle = loadedPuzzle
        newsChoices = DailyNewsSelection.choices(loadedNews, day: day)
        if selectedNewsID != nil && selectedNews == nil { selectedNewsID = nil }
        vocabulary = loadedWord?.date == day ? loadedWord : nil
        dailyFiveProgress = loadedProgress?.date == day ? loadedProgress : nil
        extrasLoading = false
        dailyFiveProgressLoading = false
        refreshEngagement()
    }

    private func loadDailyFiveProgress(userID: String?, day: String) async -> DailyFiveProgressPayload? {
        guard let scope = Daily5Reporter.capture(store), scope.userID == userID,
              scope.date == day else { return nil }
        let payload = try? await APIClient.shared.dailyFiveProgress(date: day, cookie: scope.cookie)
        guard let current = Daily5Reporter.capture(store), current.userID == scope.userID,
              current.cookie == scope.cookie, current.date == day,
              payload?.date == day else { return nil }
        return payload
    }

    private func refreshServerProgress() async {
        let userID = store.me?.id
        let day = Agenda.todayKey()
        let progress = await loadDailyFiveProgress(userID: userID, day: day)
        guard store.me?.id == userID, Agenda.todayKey() == day else { return }
        dailyFiveProgress = progress
    }

    private func refreshEngagement() {
        puzzleStatus = ""
        ideaSaved = false
        guard let userID = store.me?.id else { return }
        ideaSaved = UserDefaults.standard.bool(forKey: DailyNewsSelection.ideaKey(userID: userID, day: Agenda.todayKey()))
        if let puzzle {
            let identity = DailyPuzzleProgressIdentity(puzzle: puzzle, userID: userID)
            if DailyPuzzleProgressStore.isSolved(for: identity) {
                puzzleStatus = "Puzzle solved"
            } else if !DailyPuzzleProgressStore.load(for: identity, allowedKeys: DailyPuzzleProgressStore.allowedKeys(for: puzzle)).isEmpty {
                puzzleStatus = "Resume your puzzle"
            }
        }
    }
}

// MARK: - News widget (hosted in the Daily 5 "Interesting news" sheet)

/// Headline, summary, "Read the full story" link, and reflection composer —
/// moved here from TodayView's standalone `NewsCard` now that news lives
/// inside the Daily 5 flow (matching the web app) instead of its own card.
struct NewsWidget: View {
    let news: RecentNewsItem
    let vocabulary: VocabularyWord?
    @Environment(AppStore.self) private var store
    @Binding var reflection: String
    @State private var saved = false
    @State private var saving = false
    @State private var saveFailed = false
    @State private var readingHelpExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                Label(DailyNewsSelection.publisherLine(news), systemImage: "newspaper")
                    .font(Typography.label.weight(.semibold))
                    .foregroundStyle(Palette.textSecond)
                Text(news.headline).font(Typography.title).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(news.summary).font(Typography.body).foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                if let url = URL(string: news.url) {
                    Link(destination: url) {
                        Label("Read the full story", systemImage: "arrow.up.right.square")
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(Palette.accent)
                            .frame(minHeight: 44)
                    }
                }
                DisclosureGroup("Reading help", isExpanded: $readingHelpExpanded) {
                    ReadingCompanionView(article: news, vocabulary: vocabulary)
                        .padding(.top, Space.sm)
                }
                .font(Typography.body.weight(.semibold))
                .tint(Palette.accent)
                .accessibilityIdentifier("news.readingHelp")
                Divider().overlay(Palette.border)
                Text(news.question)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                TextField("Write what you think…", text: $reflection, axis: .vertical)
                    .lineLimit(3...6)
                    .font(Typography.body)
                    .padding(Space.sm)
                    .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                    .disabled(saving)
                    .accessibilityIdentifier("news.reflection")
                    .onChange(of: reflection) { _, value in if !value.isEmpty && !saving { saved = false; saveFailed = false } }
                if saveFailed {
                    LearningFeedback(title: "Your idea wasn't saved", message: "Your response is still here; try again.", kind: .retry)
                }
                if saved {
                    LearningFeedback(title: "Idea saved", message: "Your response is in Notes.", kind: .success)
                } else {
                        Button {
                            Haptics.selection()
                            let text = reflection
                            guard let userID = store.me?.id else { return }
                            let day = Agenda.todayKey()
                            let progressScope = Daily5Reporter.capture(store)
                            saving = true
                            saveFailed = false
                            Task {
                                let note = await store.addNote(body: text, source: "news", ref: ["kind": "news", "id": news.id, "context": "\(news.headline)\n\n\(news.summary)\n\n\(news.url)"])
                                saving = false
                                guard store.me?.id == userID, Agenda.todayKey() == day else { return }
                                if note != nil {
                                    Daily5Reporter.report("news", "completed", store: store, scope: progressScope)
                                    if reflection == text { reflection = "" }
                                    saved = true
                                    UserDefaults.standard.set(true, forKey: DailyNewsSelection.ideaKey(userID: userID, day: day))
                                } else {
                                    saveFailed = true
                                }
                            }
                        } label: {
                            Label(saving ? "Saving…" : saveFailed ? "Retry save" : "Save response", systemImage: "square.and.arrow.down")
                                .font(Typography.body.weight(.semibold))
                                .foregroundStyle(Palette.onAccent)
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(saving || reflection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("news.save")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

}

// MARK: - Daily puzzle

private final class CrosswordUITextField: UITextField {
    var onDeleteBackward: (() -> Void)?

    override func deleteBackward() {
        onDeleteBackward?()
    }
}

private struct CrosswordCellField: UIViewRepresentable {
    let accessibilityID: String
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
        field.accessibilityIdentifier = accessibilityID
        if field.text != text { field.text = text }
        if field.font?.pointSize != fontSize { field.font = .systemFont(ofSize: fontSize, weight: .bold) }
        field.textColor = UIColor(Palette.text)
        field.onDeleteBackward = onDeleteBackward
        if isFocused, !field.isFirstResponder {
            let coordinator = context.coordinator
            DispatchQueue.main.async { [weak field, weak coordinator] in
                guard let field, field.window != nil, coordinator?.parent.isFocused == true,
                      !field.isFirstResponder else { return }
                coordinator?.isRequestingFocus = true
                field.becomeFirstResponder()
                coordinator?.isRequestingFocus = false
            }
        }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: CrosswordCellField
        var isRequestingFocus = false

        init(parent: CrosswordCellField) {
            self.parent = parent
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            // Programmatic focus follows an already-selected SwiftUI cell.
            // Publishing that selection again can race the next typed letter.
            guard !isRequestingFocus else { return }
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
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let puzzle: DailyPuzzleResponse
    private let progressIdentity: DailyPuzzleProgressIdentity
    private let progressKeys: Set<String>
    @State private var answers: [String: String]
    @State private var resultMessage: String?
    @State private var activeCrosswordEntryID: String?
    @State private var focusedCrosswordCell: String?
    @State private var showClearConfirmation = false
    @State private var didReportEdit = false
    @State private var progressScope: Daily5Reporter.Scope?

    init(puzzle: DailyPuzzleResponse, userID: String) {
        self.puzzle = puzzle
        let identity = DailyPuzzleProgressIdentity(puzzle: puzzle, userID: userID)
        progressIdentity = identity
        progressKeys = DailyPuzzleProgressStore.allowedKeys(for: puzzle)
        _answers = State(initialValue: DailyPuzzleProgressStore.load(
            for: identity,
            allowedKeys: progressKeys
        ))
        _resultMessage = State(initialValue: DailyPuzzleProgressStore.isSolved(for: identity) ? "Puzzle solved" : nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            Text(puzzle.instructions ?? "Take your time and have fun.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
            if let crossword = puzzle.crossword {
                crosswordContent(crossword)
            } else if let sudoku = puzzle.sudoku {
                sudokuView(sudoku)
            } else {
                Text("This puzzle is unavailable. Close this sheet and retry from Today.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
            }
            if let resultMessage {
                LearningFeedback(
                    title: resultMessage.hasPrefix("Puzzle solved") ? "Puzzle solved" : "Keep going",
                    message: resultMessage,
                    kind: resultMessage.hasPrefix("Puzzle solved") ? .success : .retry
                )
            }
            HStack(spacing: Space.md) {
                Button("Clear") { showClearConfirmation = true }
                .buttonStyle(.bordered)
                .tint(Palette.textSecond)
                .frame(minHeight: 44)
                .accessibilityIdentifier("puzzle.clear")
                Spacer()
                AccentButton(title: "Check puzzle", systemImage: "checkmark.circle.fill") {
                    checkPuzzle()
                }
                .accessibilityIdentifier("puzzle.check")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            progressScope = Daily5Reporter.capture(store)
            if activeCrosswordEntryID == nil, let crossword = puzzle.crossword {
                activeCrosswordEntryID = crossword.entries.first?.id
            }
        }
        .alert("Clear puzzle?", isPresented: $showClearConfirmation) {
            Button("Clear", role: .destructive) { clearPuzzle() }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This removes your saved answers for today's puzzle.")
        }
    }

    @ViewBuilder
    private func crosswordContent(_ crossword: CrosswordPuzzle) -> some View {
        if horizontalSizeClass == .regular && !dynamicTypeSize.isAccessibilitySize {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: Space.xxl) {
                    VStack(alignment: .leading, spacing: Space.md) {
                        crosswordView(crossword)
                        selectedClue(crossword)
                    }
                    crosswordClues(crossword).frame(width: 360, alignment: .leading)
                }
                .frame(minWidth: 800, alignment: .leading)
                VStack(alignment: .leading, spacing: Space.md) {
                    selectedClue(crossword)
                    crosswordView(crossword)
                    crosswordClues(crossword)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: Space.md) {
                selectedClue(crossword)
                crosswordView(crossword)
                crosswordClues(crossword)
            }
        }
    }

    private func crosswordView(_ crossword: CrosswordPuzzle) -> some View {
        let columns = max(1, crossword.cols)
        let rows = max(1, crossword.rows)
        let spacing: CGFloat = 1
        let cellSize: CGFloat = 44
        let gridWidth = CGFloat(columns) * cellSize + CGFloat(columns - 1) * spacing

        return ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: true) {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.fixed(cellSize), spacing: spacing), count: columns),
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
                            accessibilityID: crosswordCellID(row: row, col: col),
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
                                // Keyboard events can arrive before UIKit has
                                // finished moving first responder. Route them
                                // through the logical cursor, not the old field.
                                let cursor = DailyPuzzleCrosswordInput.cursor(focusedCrosswordCell, fallbackRow: row, fallbackCol: col)
                                letterBinding(row: cursor.row, col: cursor.col, crossword: crossword).wrappedValue = value
                            },
                            onDeleteBackward: {
                                let cursor = DailyPuzzleCrosswordInput.cursor(focusedCrosswordCell, fallbackRow: row, fallbackCol: col)
                                deleteCrosswordLetter(row: cursor.row, col: cursor.col, crossword: crossword)
                            }
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(crosswordCellBackground(row: row, col: col, in: crossword))
                        .overlay(Rectangle().strokeBorder(crosswordCellBorder(row: row, col: col, in: crossword), lineWidth: focusedCrosswordCell == crosswordCellKey(row: row, col: col) ? 2 : 1))
                        .accessibilityLabel("Crossword row \(row + 1), column \(col + 1)")
                        if let number = crossword.entries.first(where: { $0.row == row && $0.col == col })?.number {
                            Text("\(number)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Palette.textSecond)
                                .padding(2)
                                .accessibilityHidden(true)
                        }
                    }
                    .aspectRatio(1, contentMode: .fit)
                            .id(crosswordCellKey(row: row, col: col))
                }
                }
                }
                .frame(width: gridWidth, height: CGFloat(rows) * cellSize + CGFloat(rows - 1) * spacing)
                .accessibilityIdentifier("puzzle.grid")
            }
            .onChange(of: focusedCrosswordCell) { _, cell in
                guard let cell else { return }
                withAnimation(Motion.maybe(Motion.snappy, reduceMotion: reduceMotion)) { proxy.scrollTo(cell, anchor: .center) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityLabel("Crossword grid with \(crossword.entries.count) words")
    }

    private func crosswordCellBackground(row: Int, col: Int, in crossword: CrosswordPuzzle) -> Color {
        guard let active = selectedCrosswordEntry(in: crossword) else { return Palette.panel }
        return crosswordCells(for: active).contains(where: { $0.row == row && $0.col == col }) ? Palette.accentSoft : Palette.panel
    }

    private func crosswordCellBorder(row: Int, col: Int, in crossword: CrosswordPuzzle) -> Color {
        if focusedCrosswordCell == crosswordCellKey(row: row, col: col) { return Palette.accent }
        guard let active = selectedCrosswordEntry(in: crossword),
              crosswordCells(for: active).contains(where: { $0.row == row && $0.col == col }) else { return Palette.border }
        return Palette.accent.opacity(0.55)
    }

    @ViewBuilder
    private func selectedClue(_ crossword: CrosswordPuzzle) -> some View {
        if let entry = selectedCrosswordEntry(in: crossword) {
            HStack(alignment: .center, spacing: Space.sm) {
                Button { moveSelectedClue(by: -1, in: crossword) } label: {
                    Image(systemName: "chevron.left").frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("puzzle.clue.previous")
                .accessibilityLabel("Previous clue")
                Text("\(entry.number). \(entry.clue)")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isSelected)
                Button { moveSelectedClue(by: 1, in: crossword) } label: {
                    Image(systemName: "chevron.right").frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("puzzle.clue.next")
                .accessibilityLabel("Next clue")
            }
            .padding(Space.md)
            .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Selected clue, \(entry.number), \(entry.direction), \(entry.clue)")
        }
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
                            HStack(alignment: .top, spacing: Space.sm) {
                                Text("\(entry.number)")
                                    .font(Typography.monoSmall)
                                    .foregroundStyle(Palette.textSecond)
                                    .frame(width: 22, alignment: .leading)
                                Text(entry.clue)
                                    .font(Typography.body)
                                    .foregroundStyle(Palette.text)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.horizontal, Space.sm)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .background(activeCrosswordEntryID == entry.id ? Palette.accentSoft : Color.clear, in: RoundedRectangle(cornerRadius: Radius.chip, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(entry.number) \(direction), \(entry.clue)")
                        .accessibilityHint("Selects this answer so you can type the whole word")
                        .accessibilityValue(activeCrosswordEntryID == entry.id ? "Selected" : "Not selected")
                    }
                }
            }
        }
    }

    private func sudokuView(_ sudoku: SudokuPuzzle) -> some View {
        let spacing: CGFloat = 1
        let cellSize: CGFloat = 44
        return ScrollView(.horizontal, showsIndicators: false) {
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
            .frame(width: 9 * cellSize + 8 * spacing, height: 9 * cellSize + 8 * spacing)
            .accessibilityIdentifier("puzzle.grid")
        }
        .frame(maxWidth: .infinity, alignment: .center)
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
                resultMessage = nil
                if letters.isEmpty {
                    answers.removeValue(forKey: cellKey)
                } else if letters.count > 1 {
                    if let lastCell = DailyPuzzleCrosswordInput.distribute(
                        String(letters),
                        into: &answers,
                        entry: entry,
                        selectedCellIndex: index
                    ) { focusedCrosswordCell = lastCell }
                } else {
                    answers[cellKey] = String(letters)
                    let cells = crosswordCells(for: entry)
                    if index + 1 < cells.count {
                        focusedCrosswordCell = crosswordCellKey(row: cells[index + 1].row, col: cells[index + 1].col)
                    }
                }
                DailyPuzzleProgressStore.save(answers, for: progressIdentity, allowedKeys: progressKeys)
                reportFirstEdit()
            }
        )
    }

    private func crosswordCellKey(row: Int, col: Int) -> String {
        DailyPuzzleCrosswordInput.cellKey(row: row, col: col)
    }

    private func crosswordCellID(row: Int, col: Int) -> String {
        "puzzle.cell.\(row).\(col)"
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
        reportFirstEdit()
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

    private func selectedCrosswordEntry(in crossword: CrosswordPuzzle) -> CrosswordEntry? {
        guard let activeCrosswordEntryID else { return nil }
        return crossword.entries.first(where: { $0.id == activeCrosswordEntryID })
    }

    private func moveSelectedClue(by offset: Int, in crossword: CrosswordPuzzle) {
        guard !crossword.entries.isEmpty else { return }
        let current = crossword.entries.firstIndex(where: { $0.id == activeCrosswordEntryID }) ?? 0
        let next = (current + offset + crossword.entries.count) % crossword.entries.count
        activateCrosswordEntry(crossword.entries[next], focusFirstBlank: true)
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
                resultMessage = nil
                answers[cellKey] = String($0.filter { ("1"..."9").contains(String($0)) }.suffix(1))
                DailyPuzzleProgressStore.save(answers, for: progressIdentity, allowedKeys: progressKeys)
                reportFirstEdit()
            }
        )
    }

    private func reportFirstEdit() {
        guard !didReportEdit else { return }
        didReportEdit = true
        reportProgress("started", retract: true)
    }

    private func reportProgress(_ status: String, retract: Bool = false) {
        guard store.me?.id == progressIdentity.userID,
              progressIdentity.date == Agenda.todayKey() else { return }
        Daily5Reporter.report("puzzle", status, store: store,
                              scope: progressScope, retract: retract)
    }

    private func clearPuzzle() {
        let hadAnswers = !answers.isEmpty
        answers = [:]
        resultMessage = nil
        DailyPuzzleProgressStore.clear(for: progressIdentity)
        if hadAnswers { reportProgress("started", retract: true) }
        didReportEdit = false
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
        DailyPuzzleProgressStore.recordCheck(correct: correct, required: required.count, for: progressIdentity)
        if !required.isEmpty && correct == required.count {
            reportProgress("completed")
            resultMessage = "Puzzle solved — every answer is correct."
            Haptics.notify(.success)
        } else {
            let unanswered = required.filter { (answers[$0.0] ?? "").isEmpty }.count
            resultMessage = unanswered > 0
                ? "\(unanswered) square\(unanswered == 1 ? "" : "s") still need an answer."
                : "\(correct) of \(required.count) squares are correct — look again at the clues."
            Haptics.notify(.warning)
        }
        didReportEdit = false
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
