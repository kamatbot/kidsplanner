import SwiftUI

/// Server-driven day-ramped brain teaser, shown inside the dashboard's brain-teaser
/// card (`DashCard` from `DashboardWidgets.swift`). Replaces the old static
/// `QuizWidget` that cycled through the hardcoded `Daily.quiz` array. The server
/// (`lib/brainteaser.js`) ramps the question count by weekday (Mon 1 ... Fri 5,
/// weekend 3) and resurfaces previously-wrong questions with shuffled options —
/// this view only renders + reports what `/api/brainteaser/today` returns.
struct BrainTeaserView: View {
    @Environment(AppStore.self) private var store
    @State private var progressScope: Daily5Reporter.Scope?
    private enum LoadState {
        case loading
        case error(String)
        case loaded(BrainTeaserTodayResponse)
    }

    @State private var state: LoadState = .loading
    @State private var index = 0
    @State private var picked: Int? = nil
    @State private var answeredCount = 0
    @State private var isSavingAnswer = false
    @State private var failedAnswer: Int? = nil
    @State private var answerError: String? = nil
    @AppStorage(Daily5Done.teaserKey) private var teaserDoneStamp = ""

    var body: some View {
        // The enclosing WordWidget/QuizWidget provides the DashCard chrome, so
        // this view renders just its content.
        content
            .task(id: "\(store.me?.id ?? "")|\(Agenda.todayKey())") {
                await load()
            }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            HStack(spacing: Space.sm) {
                ProgressView()
                Text("Loading today's teaser…")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
            }

        case .error(let message):
            VStack(alignment: .leading, spacing: Space.sm) {
                Text("Couldn't load the brain teaser.")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                Text(message)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                retryButton
            }

        case .loaded(let response):
            if response.questions.isEmpty {
                Text("No brain teasers today — check back tomorrow.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
            } else if index >= response.questions.count {
                doneState(total: response.questions.count)
            } else {
                questionView(response.questions[index], total: response.questions.count)
            }
        }
    }

    // MARK: Question

    @ViewBuilder
    private func questionView(_ q: BrainTeaserQ, total: Int) -> some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            HStack {
                Text("Question \(index + 1) of \(total)")
                    .font(Typography.caption.weight(.bold))
                    .foregroundStyle(Palette.violet)
                Spacer()
                if q.resurfaced == true {
                    Label("Seen before — try again", systemImage: "arrow.clockwise")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.warn)
                        .padding(.horizontal, Space.sm)
                        .padding(.vertical, 3)
                        .background(Palette.warn.opacity(0.15), in: Capsule())
                }
            }

            ProgressView(value: Double(answeredCount), total: Double(total))
                .tint(Palette.accent)
                .accessibilityLabel("Question progress")
                .accessibilityValue("\(answeredCount) of \(total) answered")

            Text(q.q)
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(q.options.indices, id: \.self) { i in
                LearningOption(text: q.options[i], index: i, state: optionState(q, i)) {
                    guard picked == nil, !isSavingAnswer else { return }
                    Haptics.selection()
                    isSavingAnswer = true
                    failedAnswer = nil
                    answerError = nil
                    Task { await report(qid: q.qid, answer: i, correct: i == q.answerIndex) }
                }
                .disabled(isSavingAnswer)
                .accessibilityIdentifier("brain.option.\(i)")
            }

            if isSavingAnswer {
                HStack(spacing: Space.sm) {
                    ProgressView()
                    Text("Saving your answer…")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
            } else if let picked {
                LearningFeedback(
                    title: picked == q.answerIndex ? "Correct." : "Not quite — the right answer is highlighted above.",
                    message: q.exp?.trimmingCharacters(in: .whitespacesAndNewlines),
                    kind: picked == q.answerIndex ? .success : .retry
                )

                nextButton(total: total)
            } else if let failedAnswer, let answerError {
                LearningFeedback(title: "That answer wasn't saved.", message: answerError, kind: .retry)
                Button("Retry answer") {
                    isSavingAnswer = true
                    self.failedAnswer = nil
                    self.answerError = nil
                    Task { await report(qid: q.qid, answer: failedAnswer, correct: failedAnswer == q.answerIndex) }
                }
                .buttonStyle(.borderedProminent)
                .tint(Palette.accent)
                .frame(minHeight: 44)
                .disabled(isSavingAnswer)
                .accessibilityIdentifier("brain.retrySave")
            }
        }
    }

    private func optionState(_ q: BrainTeaserQ, _ i: Int) -> LearningOption.State {
        guard picked != nil else { return .idle }
        if i == q.answerIndex { return .correct }
        if i == picked { return .incorrect }
        return .dimmed
    }

    private func nextButton(total: Int) -> some View {
        Button {
            Haptics.selection()
            answeredCount += 1
            index += 1
            picked = nil
            failedAnswer = nil
            answerError = nil
        } label: {
            Text(index + 1 < total ? "Next question" : "Finish")
                .font(Typography.body.weight(.bold))
                .foregroundStyle(Palette.onAccent)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.pill, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier("brain.next")
    }

    // MARK: Done state

    private func doneState(total: Int) -> some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Label("Brain teaser complete", systemImage: "checkmark.circle.fill")
                .font(Typography.body.weight(.bold))
                .foregroundStyle(Palette.text)
            Text("\(answeredCount)/\(total) today")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
        }
        .onAppear {
            teaserDoneStamp = Daily5Done.todayStamp
            Daily5Reporter.report("bt", "completed", store: store, scope: progressScope)
        }
    }

    private var retryButton: some View {
        Button {
            Task { await load() }
        } label: {
            Text("Try again")
                .font(Typography.body.weight(.bold))
                .foregroundStyle(Palette.onAccent)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.pill, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: Networking

    private func load() async {
        let userID = store.me?.id
        let day = Agenda.todayKey()
        progressScope = Daily5Reporter.capture(store)
        state = .loading
        index = 0
        picked = nil
        answeredCount = 0
        isSavingAnswer = false
        failedAnswer = nil
        answerError = nil
        do {
            let response = try await APIClient.shared.brainTeaserToday()
            guard !Task.isCancelled, store.me?.id == userID, Agenda.todayKey() == day else { return }
            guard response.date == day,
                  response.count == response.questions.count,
                  response.questions.allSatisfy({ question in
                      question.options.count >= 2 && question.options.indices.contains(question.answerIndex)
                  }) else {
                state = .error("Today's teaser data isn't ready yet. Please try again.")
                return
            }
            state = .loaded(response)
            if !response.questions.isEmpty {
                Daily5Reporter.report("bt", "started", store: store, scope: progressScope)
            }
        } catch {
            guard !Task.isCancelled, store.me?.id == userID, Agenda.todayKey() == day else { return }
            state = .error(error.localizedDescription)
        }
    }

    private func report(qid: String, answer: Int, correct: Bool) async {
        let userID = store.me?.id
        let day = Agenda.todayKey()
        do {
            try await APIClient.shared.brainTeaserAnswer(qid: qid, correct: correct)
            guard !Task.isCancelled, store.me?.id == userID, Agenda.todayKey() == day else { return }
            picked = answer
        } catch {
            guard !Task.isCancelled, store.me?.id == userID, Agenda.todayKey() == day else { return }
            failedAnswer = answer
            answerError = error.localizedDescription
        }
        guard store.me?.id == userID, Agenda.todayKey() == day else { return }
        isSavingAnswer = false
    }
}
