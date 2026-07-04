import SwiftUI

/// Server-driven day-ramped brain teaser, shown inside the dashboard's brain-teaser
/// card (`DashCard` from `DashboardWidgets.swift`). Replaces the old static
/// `QuizWidget` that cycled through the hardcoded `Daily.quiz` array. The server
/// (`lib/brainteaser.js`) ramps the question count by weekday (Mon 1 ... Fri 5,
/// weekend 3) and resurfaces previously-wrong questions with shuffled options —
/// this view only renders + reports what `/api/brainteaser/today` returns.
struct BrainTeaserView: View {
    private enum LoadState {
        case loading
        case error(String)
        case loaded(BrainTeaserTodayResponse)
    }

    @State private var state: LoadState = .loading
    @State private var index = 0
    @State private var picked: Int? = nil
    @State private var answeredCount = 0

    var body: some View {
        // The enclosing WordWidget/QuizWidget provides the DashCard chrome + the
        // homework-gating overlay, so this view renders just its content.
        content
            .task {
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
                Text("No brain teasers today — check back tomorrow! 🌙")
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
                    Text("🔁 Seen before — try again")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.warn)
                        .padding(.horizontal, Space.sm)
                        .padding(.vertical, 3)
                        .background(Palette.warn.opacity(0.15), in: Capsule())
                }
            }

            Text(q.q)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(q.options.indices, id: \.self) { i in
                Button {
                    guard picked == nil else { return }
                    Haptics.selection()
                    withAnimation(.easeOut(duration: 0.2)) { picked = i }
                    Task { await report(qid: q.qid, correct: i == q.answerIndex) }
                } label: {
                    HStack {
                        Text(q.options[i]).font(Typography.body).foregroundStyle(Palette.text)
                        Spacer(minLength: Space.sm)
                        if picked != nil && i == q.answerIndex {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.green)
                        } else if picked == i {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.red)
                        }
                    }
                    .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(optionBackground(q, i), in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(picked != nil)
            }

            if let picked {
                HStack(spacing: Space.xs) {
                    Image(systemName: picked == q.answerIndex ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(picked == q.answerIndex ? Palette.green : Palette.red)
                    Text(picked == q.answerIndex ? "Correct!" : "Not quite — the right answer is highlighted above.")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.textSecond)
                }
                .fixedSize(horizontal: false, vertical: true)

                nextButton(total: total)
            }
        }
    }

    private func optionBackground(_ q: BrainTeaserQ, _ i: Int) -> Color {
        guard picked != nil else { return Palette.panel }
        if i == q.answerIndex { return Palette.green.opacity(0.18) }
        if i == picked { return Palette.red.opacity(0.15) }
        return Palette.panel
    }

    private func nextButton(total: Int) -> some View {
        Button {
            Haptics.selection()
            withAnimation {
                answeredCount += 1
                index += 1
                picked = nil
            }
        } label: {
            Text(index + 1 < total ? "Next question →" : "See results →")
                .font(Typography.body.weight(.bold))
                .foregroundStyle(Palette.onAccent)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Palette.violet, in: RoundedRectangle(cornerRadius: Radius.pill, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: Done state

    private func doneState(total: Int) -> some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Text("🎉 Brain fully teased!")
                .font(Typography.body.weight(.bold))
                .foregroundStyle(Palette.text)
            Text("\(answeredCount)/\(total) today")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
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
                .background(Palette.violet, in: RoundedRectangle(cornerRadius: Radius.pill, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: Networking

    private func load() async {
        state = .loading
        index = 0
        picked = nil
        answeredCount = 0
        do {
            let response = try await APIClient.shared.brainTeaserToday()
            state = .loaded(response)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    private func report(qid: String, correct: Bool) async {
        try? await APIClient.shared.brainTeaserAnswer(qid: qid, correct: correct)
    }
}
