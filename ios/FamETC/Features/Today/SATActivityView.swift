import SwiftUI

/// Server-selected daily context challenge, with the existing word-bank tools.
struct SATActivityView: View {
    @Environment(AppStore.self) private var store
    @AppStorage("fam_sat_placement_done") private var placementDone = false
    @State private var response: DailyVocabularyResponse?
    @State private var loading = true
    @State private var showWordBank = false
    @State private var showQuiz = false
    @State private var showPlacement = false
    @State private var savedToNotes = false
    @State private var noteFailed = false
    @State private var savingNote = false
    @State private var picked: Int?
    @State private var savingAnswer = false
    @State private var failedAnswer: Int?
    @State private var answerError: String?
    @State private var loadError: String?
    @State private var showExplanations = false
    @State private var showWeek = false

    private var scope: String { "\(store.me?.id ?? "")|\(Agenda.todayKey())" }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            if loading {
                ProgressView("Loading today's word…")
            } else if let response {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(response.word.word).font(Typography.title).foregroundStyle(Palette.text)
                    Text(response.word.pos).font(Typography.caption.italic()).foregroundStyle(Palette.textSecond)
                    Text(response.challenge.prompt).font(Typography.body.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(spacing: Space.sm) {
                    ForEach(response.challenge.options.indices, id: \.self) { index in
                        LearningOption(text: response.challenge.options[index].text, index: index, state: optionState(index, response)) {
                            guard picked == nil, !savingAnswer else { return }
                            Haptics.selection()
                            savingAnswer = true
                            failedAnswer = nil
                            answerError = nil
                            Task { await submitAnswer(index, response: response) }
                        }
                        .disabled(savingAnswer)
                        .accessibilityIdentifier("word.option.\(index)")
                    }
                }
                if savingAnswer {
                    HStack(spacing: Space.sm) {
                        ProgressView()
                        Text("Saving your answer…").font(Typography.caption).foregroundStyle(Palette.textSecond)
                    }
                } else if let picked {
                    LearningFeedback(
                        title: picked == response.challenge.answerIndex ? "You found the impostor." : "The highlighted sentence is the misapplication.",
                        message: response.challenge.options[response.challenge.answerIndex].explanation,
                        kind: picked == response.challenge.answerIndex ? .success : .retry
                    )
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text(response.word.def).font(Typography.body).foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("“\(response.word.example)”").font(Typography.caption).foregroundStyle(Palette.textSecond)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    DisclosureGroup("Review all explanations", isExpanded: $showExplanations) {
                        VStack(alignment: .leading, spacing: Space.sm) {
                            ForEach(response.challenge.options.indices, id: \.self) { index in
                                Text(response.challenge.options[index].explanation)
                                    .font(Typography.caption)
                                    .foregroundStyle(Palette.textSecond)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.top, Space.sm)
                    }
                    .frame(minHeight: 44)
                } else if let failedAnswer, let answerError {
                    LearningFeedback(title: "That answer wasn't recorded.", message: answerError, kind: .retry)
                    Button("Retry answer") {
                        savingAnswer = true
                        self.failedAnswer = nil
                        self.answerError = nil
                        Task { await submitAnswer(failedAnswer, response: response) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.accent)
                    .frame(minHeight: 44)
                    .disabled(savingAnswer)
                    .accessibilityIdentifier("word.retrySave")
                }
                DisclosureGroup("This week's seven words", isExpanded: $showWeek) {
                    VStack(alignment: .leading, spacing: Space.sm) {
                        ForEach(response.weekWords, id: \.word) { word in
                            Text("\(word.word) (\(word.pos)) — \(word.def)")
                                .font(Typography.caption).fixedSize(horizontal: false, vertical: true)
                        }
                    }.padding(.top, Space.sm)
                }
                .frame(minHeight: 44)
                Button {
                    let userID = store.me?.id
                    let body = "\(response.word.word) (\(response.word.pos)) — \(response.word.def)\n\nExample: \(response.word.example)"
                    savingNote = true
                    noteFailed = false
                    Task {
                        let note = await store.addNote(body: body, source: "sat",
                            ref: ["kind": "sat", "id": response.word.word, "context": body])
                        guard store.me?.id == userID else { return }
                        savingNote = false
                        savedToNotes = note != nil
                        noteFailed = note == nil
                    }
                } label: {
                    Label(savingNote ? "Saving word…" : savedToNotes ? "Word saved" : "Save word to Notes", systemImage: savedToNotes ? "checkmark.circle" : "pin")
                        .font(Typography.caption.weight(.semibold)).frame(minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Palette.accent)
                .disabled(savedToNotes || savingNote)
                .accessibilityIdentifier("word.save")
                if noteFailed { LearningFeedback(title: "The word wasn't saved.", message: "Try saving it again when you're ready.", kind: .retry) }
                actionRow
            } else {
                LearningFeedback(title: "Today's word challenge couldn't load.", message: loadError, kind: .retry)
                Button("Try again") { Task { await loadChallenge() } }
                    .buttonStyle(.borderedProminent).tint(Palette.accent).frame(minHeight: 44)
            }
        }
        .task(id: scope) { await loadChallenge() }
        .sheet(isPresented: $showWordBank) { WordBankSheet() }
        .sheet(isPresented: $showQuiz) { WordQuizSheet() }
        .sheet(isPresented: $showPlacement) {
            PlacementSheet(onDone: { placementDone = true; showPlacement = false })
        }
    }

    private var actionRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Space.sm) { actionButtons }
            VStack(alignment: .leading, spacing: Space.sm) { actionButtons }
        }
    }

    @ViewBuilder private var actionButtons: some View {
        Button { showWordBank = true } label: { Label("Word bank", systemImage: "books.vertical.fill").font(Typography.caption.weight(.semibold)) }
            .buttonStyle(.bordered).tint(Palette.accent).frame(minHeight: 44)
        Button { showQuiz = true } label: { Label("Pop quiz", systemImage: "bolt.fill").font(Typography.caption.weight(.semibold)) }
            .buttonStyle(.bordered).tint(Palette.accent).frame(minHeight: 44)
        if !placementDone {
            Button { showPlacement = true } label: { Label("Words I know", systemImage: "sparkles").font(Typography.caption.weight(.semibold)) }
                .buttonStyle(.bordered).tint(Palette.accent).frame(minHeight: 44)
        }
    }

    private func optionState(_ index: Int, _ response: DailyVocabularyResponse) -> LearningOption.State {
        guard let picked else { return .idle }
        if index == response.challenge.answerIndex { return .correct }
        return index == picked ? .incorrect : .dimmed
    }

    private func submitAnswer(_ answer: Int, response: DailyVocabularyResponse) async {
        let userID = store.me?.id
        let day = Agenda.todayKey()
        let progressScope = Daily5Reporter.capture(store)
        guard store.me?.id == userID, Agenda.todayKey() == day else { return }
        do {
            _ = try await APIClient.shared.wordInteract(
                word: response.word.word, correct: answer == response.challenge.answerIndex)
            guard !Task.isCancelled, store.me?.id == userID, Agenda.todayKey() == day else { return }
            picked = answer
            Daily5Reporter.report("word", "completed", store: store, scope: progressScope)
        } catch {
            guard !Task.isCancelled, store.me?.id == userID, Agenda.todayKey() == day else { return }
            failedAnswer = answer
            answerError = error.localizedDescription
        }
        guard store.me?.id == userID, Agenda.todayKey() == day else { return }
        savingAnswer = false
    }

    private func loadChallenge() async {
        let requestedScope = scope
        let day = Agenda.todayKey()
        loading = true
        response = nil
        picked = nil
        savingAnswer = false
        failedAnswer = nil
        answerError = nil
        loadError = nil
        showExplanations = false
        savedToNotes = false
        noteFailed = false
        savingNote = false
        showWeek = false
        showWordBank = false
        showQuiz = false
        showPlacement = false
        do {
            let loaded = try await APIClient.shared.dailyVocabulary(date: day)
            guard !Task.isCancelled, scope == requestedScope else { return }
            guard loaded.date == day, loaded.challenge.options.count == 3,
                  loaded.challenge.options.indices.contains(loaded.challenge.answerIndex) else {
                loadError = "Today's challenge data isn't ready yet. Please try again."
                loading = false
                return
            }
            response = loaded
            Daily5Reporter.report("word", "started", store: store, scope: Daily5Reporter.capture(store))
        } catch {
            guard !Task.isCancelled, scope == requestedScope else { return }
            loadError = error.localizedDescription
        }
        loading = false
    }
}


// MARK: - Word bank sheet

private struct WordBankSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var response: WordBankResponse? = nil
    @State private var isLoading = true
    @State private var loadError: String? = nil

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
                } else if let loadError {
                    VStack(alignment: .leading, spacing: Space.lg) {
                        LearningFeedback(title: "Word bank couldn't load.", message: loadError, kind: .retry)
                        Button("Try again") { Task { await load() } }
                            .buttonStyle(.borderedProminent).tint(Palette.accent).frame(minHeight: 44)
                    }
                    .padding(Space.lg)
                } else {
                    ContentUnavailableView("No words yet", systemImage: "book.closed",
                        description: Text("Answer daily SAT activities to start building your word bank."))
                }
            }
            .navigationTitle("Word Bank")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.accessibilityIdentifier("secondaryClose")
                }
            }
        }
        .task {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        loadError = nil
        do {
            response = try await APIClient.shared.wordBank()
        } catch {
            response = nil
            loadError = error.localizedDescription
        }
        isLoading = false
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
    @State private var loadError: String? = nil

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let loadError {
                    VStack(alignment: .leading, spacing: Space.lg) {
                        LearningFeedback(title: "Pop quiz couldn't load.", message: loadError, kind: .retry)
                        Button("Try again") { Task { await load() } }
                            .buttonStyle(.borderedProminent).tint(Palette.accent).frame(minHeight: 44)
                    }
                    .padding(Space.lg)
                } else if needMore || questions.isEmpty {
                    ContentUnavailableView("Learn a few more words first", systemImage: "hourglass",
                        description: Text("Keep practicing the daily SAT word to unlock the pop quiz."))
                } else if finished {
                    VStack(spacing: Space.md) {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 42)).foregroundStyle(Palette.green)
                        Text("You scored \(score)/\(questions.count)")
                            .font(Typography.title).foregroundStyle(Palette.text)
                        Button {
                            dismiss()
                        } label: {
                            Text("Done")
                                .font(Typography.body.weight(.bold))
                                .foregroundStyle(Palette.onAccent)
                                .padding(.horizontal, Space.xl).padding(.vertical, Space.sm)
                                .background(Palette.accent, in: Capsule())
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    let q = questions[index]
                    ScrollView {
                    VStack(alignment: .leading, spacing: Space.md) {
                        Text("Question \(index + 1) of \(questions.count)")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                        Text(q.prompt).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
                        ForEach(q.options.indices, id: \.self) { i in
                            LearningOption(text: q.options[i], index: i, state: optionState(i, q)) {
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
                                    .background(Palette.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(Space.lg)
                    .frame(maxWidth: 680, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .center)
                    }
                }
            }
            .navigationTitle("Pop Quiz")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.accessibilityIdentifier("secondaryClose")
                }
            }
        }
        .task {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        loadError = nil
        do {
            let response = try await APIClient.shared.wordQuiz(n: 5)
            questions = response.questions
            needMore = (response.needMore ?? false) || response.questions.count < 2
        } catch {
            questions = []
            needMore = false
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func optionState(_ i: Int, _ q: WordQuizQuestion) -> LearningOption.State {
        guard let picked else { return .idle }
        if i == q.answerIndex { return .correct }
        if i == picked { return .incorrect }
        return .dimmed
    }

    private func answer(_ i: Int, _ q: WordQuizQuestion) {
        guard picked == nil else { return }
        Haptics.selection()
        picked = i
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
    @Environment(\.dismiss) private var dismiss
    let onDone: () -> Void

    @State private var candidates: [SATWord] = Array(Daily.words.shuffled().prefix(6))
    @State private var selected: Set<String> = []
    @State private var isSaving = false
    @State private var saveError: String? = nil

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
                                guard !isSaving else { return }
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
                            .disabled(isSaving)
                        }
                    }
                }

                Button {
                    Task {
                        isSaving = true
                        saveError = nil
                        if !selected.isEmpty {
                            do {
                                try await APIClient.shared.wordPlacement(known: Array(selected))
                            } catch {
                                isSaving = false
                                saveError = error.localizedDescription
                                return
                            }
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
                    .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                }
                .disabled(isSaving)
                .accessibilityIdentifier("word.save")
                if let saveError {
                    LearningFeedback(title: "Your choices weren't saved.", message: saveError, kind: .retry)
                }
            }
            .padding(Space.lg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.accessibilityIdentifier("secondaryClose")
                }
            }
        }
    }
}
