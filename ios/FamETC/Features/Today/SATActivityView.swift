import SwiftUI

/// The interactive SAT-word mastery experience shown inside the dashboard's SAT
/// card. Replaces the static `WordWidget` body. Rotates the daily activity by
/// `Daily.dayOfYear % 3`, tracks mastery via `/api/wordbank`, and offers a word
/// bank browser + pop quiz + one-time placement step. Self-contained — talks to
/// `APIClient.shared` directly (no `AppStore` dependency).
struct SATActivityView: View {
    @Environment(AppStore.self) private var store
    @AppStorage("fam_sat_placement_done") private var placementDone = false

    @State private var entry: WordBankEntry? = nil
    @State private var showWordBank = false
    @State private var showQuiz = false
    @State private var showPlacement = false
    @State private var savedToNotes = false

    private let word = Daily.word

    var body: some View {
        // The enclosing WordWidget provides the DashCard chrome + homework-gating
        // overlay, so this view renders just its content.
        VStack(alignment: .leading, spacing: Space.md) {
            header
            ActivityCard(word: word, onAnswered: handleAnswered)
            masteryRow
            actionRow
        }
        .task { await loadEntry() }
        .sheet(isPresented: $showWordBank) { WordBankSheet() }
        .sheet(isPresented: $showQuiz) { WordQuizSheet() }
        .sheet(isPresented: $showPlacement) {
            PlacementSheet(onDone: {
                placementDone = true
                showPlacement = false
                Task { await loadEntry() }
            })
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(word.word).font(Typography.title).foregroundStyle(Palette.text)
            Text(word.pos).font(Typography.caption.italic()).foregroundStyle(Palette.textSecond)
            Spacer()
            if entry?.state == "mastered" {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.green)
            }
            Button {
                Haptics.selection()
                let body = "\(word.word) — \(word.def)"
                Task {
                    _ = await store.addNote(body: body, source: "sat",
                                            ref: ["kind": "sat", "id": word.word, "context": body])
                    savedToNotes = true
                    try? await Task.sleep(nanoseconds: 1_200_000_000)
                    savedToNotes = false
                }
            } label: {
                Image(systemName: savedToNotes ? "checkmark.circle.fill" : "pin")
                    .foregroundStyle(savedToNotes ? Palette.green : Palette.teal)
            }
            .accessibilityLabel("Save word to Notes")
        }
    }

    @ViewBuilder
    private var masteryRow: some View {
        let correct = entry?.correctCount ?? 0
        let target = 3
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Mastery").font(Typography.caption).foregroundStyle(Palette.textSecond)
                Spacer()
                Text(entry?.state == "mastered" ? "Mastered ✓" : "\(min(correct, target))/\(target)")
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(entry?.state == "mastered" ? Palette.green : Palette.textSecond)
            }
            ProgressView(value: Double(min(correct, target)), total: Double(target))
                .tint(Palette.teal)
        }
    }

    private var actionRow: some View {
        HStack(spacing: Space.sm) {
            Button {
                Haptics.selection()
                showWordBank = true
            } label: {
                Label("Word bank", systemImage: "books.vertical.fill")
                    .font(Typography.caption.weight(.semibold))
            }
            .buttonStyle(PillButtonStyle(tint: Palette.teal))

            Button {
                Haptics.selection()
                showQuiz = true
            } label: {
                Label("Pop quiz", systemImage: "bolt.fill")
                    .font(Typography.caption.weight(.semibold))
            }
            .buttonStyle(PillButtonStyle(tint: Palette.violet))

            // Opt-in placement — shown inline in the SAT card (not auto-presented
            // globally on launch, which would cover other tabs).
            if !placementDone {
                Button {
                    Haptics.selection()
                    showPlacement = true
                } label: {
                    Label("Words I know", systemImage: "sparkles")
                        .font(Typography.caption.weight(.semibold))
                }
                .buttonStyle(PillButtonStyle(tint: Palette.amber))
            }
        }
    }

    private func loadEntry() async {
        guard let bank = try? await APIClient.shared.wordBank() else { return }
        entry = bank.words.first { $0.word.caseInsensitiveCompare(word.word) == .orderedSame }
    }

    private func handleAnswered(_ correct: Bool) {
        Task {
            if let updated = try? await APIClient.shared.wordInteract(word: word.word, correct: correct) {
                await MainActor.run { entry = updated }
            }
        }
    }
}

// MARK: - Shared small pieces

private struct PillButtonStyle: ButtonStyle {
    let tint: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(tint)
            .padding(.horizontal, Space.md)
            .padding(.vertical, Space.sm)
            .frame(minHeight: 36)
            .background(tint.opacity(configuration.isPressed ? 0.24 : 0.15), in: Capsule())
    }
}

private struct OptionButton: View {
    let text: String
    let state: OptionState
    let action: () -> Void

    enum OptionState { case idle, correct, wrong, dimmed }

    var body: some View {
        Button(action: action) {
            HStack {
                Text(text).font(Typography.body).foregroundStyle(Palette.text)
                Spacer(minLength: Space.sm)
                switch state {
                case .correct: Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.green)
                case .wrong: Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.red)
                default: EmptyView()
                }
            }
            .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(state != .idle)
    }

    private var background: Color {
        switch state {
        case .idle: return Palette.panel
        case .correct: return Palette.green.opacity(0.18)
        case .wrong: return Palette.red.opacity(0.15)
        case .dimmed: return Palette.panel
        }
    }
}

// MARK: - Daily rotating activity

/// One of three interactive tasks, chosen by `Daily.dayOfYear % 3`, regenerated
/// (with fresh distractors/shuffle) whenever `word` changes.
private struct ActivityCard: View {
    let word: SATWord
    let onAnswered: (Bool) -> Void

    @State private var picked: Int? = nil
    @State private var task: DailyTask? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            if let task {
                Text(task.prompt).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(task.options.indices, id: \.self) { i in
                    OptionButton(text: task.options[i], state: optionState(i)) {
                        guard picked == nil else { return }
                        Haptics.selection()
                        withAnimation(.easeOut(duration: 0.2)) { picked = i }
                        onAnswered(i == task.answerIndex)
                    }
                }

                if picked != nil {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(picked == task.answerIndex ? "Correct! 🎉" : "Not quite.")
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(picked == task.answerIndex ? Palette.green : Palette.red)
                        Text(word.def).font(Typography.caption).foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("“\(word.example)”").font(Typography.caption).foregroundStyle(Palette.textSecond)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .onAppear { task = makeTask() }
        .onChange(of: word.word) { _, _ in
            picked = nil
            task = makeTask()
        }
    }

    private func optionState(_ i: Int) -> OptionButton.OptionState {
        guard let picked else { return .idle }
        guard let task else { return .idle }
        if i == task.answerIndex { return .correct }
        if i == picked { return .wrong }
        return .dimmed
    }

    private struct DailyTask {
        let prompt: String
        let options: [String]
        let answerIndex: Int
    }

    private func makeTask() -> DailyTask {
        let variant = Daily.dayOfYear % 3
        switch variant {
        case 0:
            // Pick the sentence that uses <word> correctly.
            let correct = word.example
            let distractors = Daily.words
                .filter { $0.word != word.word }
                .shuffled()
                .prefix(2)
                .map { correctSentence(for: $0.word, matching: word.word) }
            var options = [correct] + distractors
            options.shuffle()
            let idx = options.firstIndex(of: correct) ?? 0
            return DailyTask(
                prompt: "Pick the sentence that uses **\(word.word)** correctly:",
                options: options,
                answerIndex: idx
            )
        case 1:
            // Fill in the blank.
            let blanked = blank(word.example, word: word.word)
            let distractorWords = Daily.words
                .filter { $0.word != word.word }
                .shuffled()
                .prefix(3)
                .map { $0.word }
            var options = [word.word] + distractorWords
            options.shuffle()
            let idx = options.firstIndex(of: word.word) ?? 0
            return DailyTask(
                prompt: "Fill in the blank:\n\(blanked)",
                options: options,
                answerIndex: idx
            )
        default:
            // Which definition matches <word>?
            let correctDef = word.def
            let distractorDefs = Daily.words
                .filter { $0.word != word.word }
                .shuffled()
                .prefix(3)
                .map { $0.def }
            var options = [correctDef] + distractorDefs
            options.shuffle()
            let idx = options.firstIndex(of: correctDef) ?? 0
            return DailyTask(
                prompt: "Which definition matches **\(word.word)**?",
                options: options,
                answerIndex: idx
            )
        }
    }

    /// Builds a distractor sentence by swapping another word's example to reference
    /// this widget's target word incorrectly (kept simple: reuse the other word's
    /// own example so it's clearly about a different word/context).
    private func correctSentence(for otherWord: String, matching target: String) -> String {
        Daily.words.first(where: { $0.word == otherWord })?.example ?? "The word \(target) was used in a sentence."
    }

    private func blank(_ sentence: String, word: String) -> String {
        guard let range = sentence.range(of: word, options: .caseInsensitive) else { return sentence }
        return sentence.replacingCharacters(in: range, with: "_____")
    }
}

// MARK: - Word bank sheet

private struct WordBankSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var response: WordBankResponse? = nil
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let response, !response.words.isEmpty {
                    List {
                        Section {
                            HStack {
                                statChip("Learning", response.stats.learning, Palette.orange)
                                statChip("Mastered", response.stats.mastered, Palette.green)
                                statChip("Known", response.stats.known, Palette.teal)
                            }
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                        }
                        Section("Words") {
                            ForEach(response.words) { entry in
                                HStack {
                                    Text(entry.word).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                                    Spacer()
                                    if entry.state == "mastered" {
                                        Label("Mastered", systemImage: "checkmark.seal.fill")
                                            .font(Typography.caption).foregroundStyle(Palette.green)
                                    } else {
                                        Text(entry.state.capitalized)
                                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                                    }
                                }
                            }
                        }
                    }
                } else {
                    ContentUnavailableView("No words yet", systemImage: "book.closed",
                        description: Text("Answer daily SAT activities to start building your word bank."))
                }
            }
            .navigationTitle("Word Bank")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .task {
            response = try? await APIClient.shared.wordBank()
            isLoading = false
        }
    }

    private func statChip(_ label: String, _ count: Int, _ tint: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(count)").font(Typography.statNumber).foregroundStyle(tint)
            Text(label).font(Typography.caption).foregroundStyle(Palette.textSecond)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Space.sm)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
    }
}

// MARK: - Pop quiz sheet

private struct WordQuizSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var isLoading = true
    @State private var questions: [WordQuizQuestion] = []
    @State private var needMore = false
    @State private var index = 0
    @State private var picked: Int? = nil
    @State private var score = 0
    @State private var finished = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if needMore || questions.isEmpty {
                    ContentUnavailableView("Learn a few more words first", systemImage: "hourglass",
                        description: Text("Keep practicing the daily SAT word to unlock the pop quiz."))
                } else if finished {
                    VStack(spacing: Space.md) {
                        Text("🎉").font(.system(size: 48))
                        Text("You scored \(score)/\(questions.count)")
                            .font(Typography.title).foregroundStyle(Palette.text)
                        Button {
                            dismiss()
                        } label: {
                            Text("Done")
                                .font(Typography.body.weight(.bold))
                                .foregroundStyle(Palette.onAccent)
                                .padding(.horizontal, Space.xl).padding(.vertical, Space.sm)
                                .background(Palette.violet, in: Capsule())
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    let q = questions[index]
                    VStack(alignment: .leading, spacing: Space.md) {
                        Text("Question \(index + 1) of \(questions.count)")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                        Text(q.prompt).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
                        ForEach(q.options.indices, id: \.self) { i in
                            OptionButton(text: q.options[i], state: optionState(i, q)) {
                                answer(i, q)
                            }
                        }
                        Spacer()
                        if picked != nil {
                            Button {
                                Haptics.selection()
                                nextQuestion()
                            } label: {
                                Text(index == questions.count - 1 ? "See score →" : "Next question →")
                                    .font(Typography.body.weight(.bold))
                                    .foregroundStyle(Palette.violet)
                                    .padding(.vertical, Space.sm + 2)
                                    .padding(.horizontal, Space.md)
                                    .frame(minHeight: 44)
                                    .background(Palette.violet.opacity(0.15), in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(Space.lg)
                }
            }
            .navigationTitle("Pop Quiz")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .task {
            if let r = try? await APIClient.shared.wordQuiz(n: 5) {
                questions = r.questions
                needMore = (r.needMore ?? false) || r.questions.count < 2
            } else {
                needMore = true
            }
            isLoading = false
        }
    }

    private func optionState(_ i: Int, _ q: WordQuizQuestion) -> OptionButton.OptionState {
        guard let picked else { return .idle }
        if i == q.answerIndex { return .correct }
        if i == picked { return .wrong }
        return .dimmed
    }

    private func answer(_ i: Int, _ q: WordQuizQuestion) {
        guard picked == nil else { return }
        Haptics.selection()
        withAnimation(.easeOut(duration: 0.2)) { picked = i }
        let correct = i == q.answerIndex
        if correct { score += 1 }
        Task { try? await APIClient.shared.wordInteract(word: q.word, correct: correct) }
    }

    private func nextQuestion() {
        if index == questions.count - 1 {
            finished = true
        } else {
            index += 1
            picked = nil
        }
    }
}

// MARK: - Placement sheet

private struct PlacementSheet: View {
    let onDone: () -> Void

    @State private var candidates: [SATWord] = Array(Daily.words.shuffled().prefix(6))
    @State private var selected: Set<String> = []
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Space.md) {
                Text("Do you already know these?")
                    .font(Typography.title).foregroundStyle(Palette.text)
                Text("Pick any words you already know well — we'll skip straight to quizzing you on them.")
                    .font(Typography.caption).foregroundStyle(Palette.textSecond)

                ScrollView {
                    VStack(spacing: Space.sm) {
                        ForEach(candidates, id: \.word) { w in
                            Button {
                                Haptics.selection()
                                if selected.contains(w.word) { selected.remove(w.word) }
                                else { selected.insert(w.word) }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(w.word).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                                        Text(w.def).font(Typography.caption).foregroundStyle(Palette.textSecond)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                    Spacer()
                                    Image(systemName: selected.contains(w.word) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(selected.contains(w.word) ? Palette.teal : Palette.textSecond)
                                }
                                .padding(Space.md)
                                .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Button {
                    Task {
                        isSaving = true
                        if !selected.isEmpty {
                            try? await APIClient.shared.wordPlacement(known: Array(selected))
                        }
                        isSaving = false
                        onDone()
                    }
                } label: {
                    HStack {
                        if isSaving { ProgressView().tint(Palette.onAccent) }
                        Text(selected.isEmpty ? "Skip" : "Save and continue")
                    }
                    .font(Typography.body.weight(.bold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Space.sm + 2)
                    .background(Palette.teal, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                }
                .disabled(isSaving)
            }
            .padding(Space.lg)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
