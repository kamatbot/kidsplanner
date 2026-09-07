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
    @State private var picked: Int?
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
                ForEach(response.challenge.options.indices, id: \.self) { index in
                    VStack(alignment: .leading, spacing: Space.xs) {
                        OptionButton(text: response.challenge.options[index].text, state: optionState(index, response)) {
                            guard picked == nil else { return }
                            Haptics.selection()
                            picked = index
                            let userID = store.me?.id
                            Task {
                                guard store.me?.id == userID else { return }
                                _ = try? await APIClient.shared.wordInteract(
                                    word: response.word.word, correct: index == response.challenge.answerIndex)
                            }
                        }
                        if picked != nil {
                            Text(index == response.challenge.answerIndex ? "Misapplication" : "Correct usage")
                                .font(Typography.caption.weight(.bold)).foregroundStyle(Palette.text)
                            Text(response.challenge.options[index].explanation)
                                .font(Typography.caption).foregroundStyle(Palette.textSecond)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                if let picked {
                    Text(picked == response.challenge.answerIndex ? "You found the impostor." : "The marked misapplication is the impostor.")
                        .font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                    Text(response.word.def).font(Typography.body).fixedSize(horizontal: false, vertical: true)
                    Text("“\(response.word.example)”").font(Typography.caption).foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
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
                    Task {
                        let note = await store.addNote(body: body, source: "sat",
                            ref: ["kind": "sat", "id": response.word.word, "context": body])
                        guard store.me?.id == userID else { return }
                        savedToNotes = note != nil
                        noteFailed = note == nil
                    }
                } label: {
                    Label(savedToNotes ? "Word saved" : "Save word to Notes", systemImage: savedToNotes ? "checkmark.circle" : "pin")
                        .font(Typography.caption.weight(.semibold)).frame(minHeight: 44)
                }
                .disabled(savedToNotes)
                if noteFailed { Text("Couldn't save the word. Try again.").font(Typography.caption).foregroundStyle(Palette.red) }
                actionRow
            } else {
                Text("Today's word challenge is unavailable.").font(Typography.body)
                Button("Retry") { Task { await loadChallenge() } }.frame(minHeight: 44)
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
            .buttonStyle(PillButtonStyle(tint: Palette.teal))
        Button { showQuiz = true } label: { Label("Pop quiz", systemImage: "bolt.fill").font(Typography.caption.weight(.semibold)) }
            .buttonStyle(PillButtonStyle(tint: Palette.violet))
        if !placementDone {
            Button { showPlacement = true } label: { Label("Words I know", systemImage: "sparkles").font(Typography.caption.weight(.semibold)) }
                .buttonStyle(PillButtonStyle(tint: Palette.amber))
        }
    }

    private func optionState(_ index: Int, _ response: DailyVocabularyResponse) -> OptionButton.OptionState {
        guard let picked else { return .idle }
        if index == response.challenge.answerIndex { return .correct }
        return index == picked ? .wrong : .dimmed
    }

    private func loadChallenge() async {
        let requestedScope = scope
        let day = Agenda.todayKey()
        loading = true
        response = nil
        picked = nil
        savedToNotes = false
        noteFailed = false
        showWeek = false
        showWordBank = false
        showQuiz = false
        showPlacement = false
        let loaded = try? await APIClient.shared.dailyVocabulary(date: day)
        guard !Task.isCancelled, scope == requestedScope else { return }
        if let loaded, loaded.date == day, loaded.challenge.options.count == 3,
           loaded.challenge.options.indices.contains(loaded.challenge.answerIndex) {
            response = loaded
        }
        loading = false
    }
}

private struct PillButtonStyle: ButtonStyle {
    let tint: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(tint)
            .padding(.horizontal, Space.md)
            .padding(.vertical, Space.sm)
            .frame(minHeight: 44)
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
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: Space.sm)
                switch state {
                case .correct: Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.green)
                case .wrong: Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.red)
                default: EmptyView()
                }
            }
            .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
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
