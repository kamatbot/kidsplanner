import SwiftUI

/// A focused, disposable play session. No Daily 4 reporter, persisted answers,
/// timers, rewards or answer API calls belong in this view.
struct PuzzlePracticeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var mode = "circuit"
    @State private var requestNumber = 0
    @State private var questions: [BrainTeaserQ] = []
    @State private var questionIndex = 0
    @State private var picked: Int?
    @State private var loading = false
    @State private var loadError: String?

    private var accountScope: String {
        "\(store.me?.id ?? "")|\(store.me?.role ?? "")|\(store.me?.kidId ?? "")|\(store.family?.id ?? "")|\(store.needsAuth)"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.lg) {
                    Text("Follow an idea. See where it goes.")
                        .font(Typography.cardTitle).foregroundStyle(Palette.text)
                    Text("Optional practice, whenever you feel like it. No clock or points, and separate from your Daily 4.")
                        .font(Typography.body).foregroundStyle(Palette.textSecond)
                    Group {
                        if dynamicTypeSize.isAccessibilitySize { modePicker.pickerStyle(.menu) }
                        else { modePicker.pickerStyle(.segmented) }
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("practice.mode")

                    if mode == "circuit" { CircuitTrailView() }
                    else { reasoning }
                }
                .frame(maxWidth: 680, alignment: .leading)
                .frame(maxWidth: .infinity)
                .padding(Space.lg)
            }
            .background(ScreenBackground())
            .navigationTitle("Puzzle practice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.frame(minHeight: 44)
                }
            }
        }
        .task(id: "\(accountScope)|\(mode)|\(requestNumber)") {
            guard mode == "reasoning", !store.needsAuth, store.me != nil else { return }
            await loadReasoning()
        }
        .onChange(of: accountScope) { _, _ in
            questions = []
            picked = nil
            dismiss()
        }
        .presentationSizing(.page)
    }

    private var modePicker: some View {
        Picker("Practice game", selection: $mode) {
            Text("Circuit trail").tag("circuit")
            Text("Visual reasoning").tag("reasoning")
        }
    }

    @ViewBuilder private var reasoning: some View {
        if loading {
            HStack { ProgressView(); Text("Finding a fresh set of ideas…").font(Typography.body) }
        } else if let loadError {
            LearningFeedback(title: "Practice couldn't load.", message: loadError, kind: .retry)
            Button("Try again") { requestNumber += 1 }
                .buttonStyle(.borderedProminent).frame(minHeight: 44)
        } else if questions.indices.contains(questionIndex) {
            let question = questions[questionIndex]
            VStack(alignment: .leading, spacing: Space.md) {
                Text("Idea \(questionIndex + 1) of \(questions.count)")
                    .font(Typography.caption.weight(.semibold)).foregroundStyle(Palette.textSecond)
                if let visual = question.visual { VisualPuzzleView(visual: visual) }
                Text(question.q).font(Typography.cardTitle).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(question.options.indices, id: \.self) { index in
                    LearningOption(text: question.options[index], index: index, state: optionState(index, question)) {
                        guard picked == nil else { return }
                        Haptics.selection()
                        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { picked = index }
                    }
                    .accessibilityIdentifier("practice.option.\(index)")
                }
                if let picked {
                    LearningFeedback(title: picked == question.answerIndex ? "That fits." : "A different route to the answer.", message: question.exp,
                                     kind: picked == question.answerIndex ? .success : .info)
                    Button(questionIndex + 1 < questions.count ? "Next idea" : "Finish this set") {
                        self.picked = nil
                        questionIndex += 1
                    }
                    .buttonStyle(.borderedProminent).frame(minHeight: 44)
                    .accessibilityIdentifier("practice.next")
                }
            }
        } else {
            LearningFeedback(title: questions.isEmpty ? "No ideas available just now." : "A good place to pause.",
                             message: "Try another set, make a circuit, or come back whenever you like.")
            Button("New set of ideas") { requestNumber += 1 }
                .buttonStyle(.borderedProminent).frame(minHeight: 44)
        }
    }

    private func optionState(_ index: Int, _ question: BrainTeaserQ) -> LearningOption.State {
        guard let picked else { return .idle }
        if index == question.answerIndex { return .correct }
        return index == picked ? .incorrect : .dimmed
    }

    private func loadReasoning() async {
        let scope = accountScope
        loading = true
        loadError = nil
        questions = []
        questionIndex = 0
        picked = nil
        do {
            let response = try await APIClient.shared.getBrainTeaserPractice()
            guard !Task.isCancelled, accountScope == scope, mode == "reasoning" else { return }
            guard response.count == response.questions.count, response.questions.count <= 12,
                  response.questions.allSatisfy({ $0.options.count == 4 && $0.options.indices.contains($0.answerIndex) }) else {
                loadError = "This set isn't ready yet. Please try again."
                loading = false
                return
            }
            questions = response.questions
        } catch {
            guard !Task.isCancelled, accountScope == scope, mode == "reasoning" else { return }
            loadError = error.localizedDescription
        }
        loading = false
    }
}

private struct CircuitTrailView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var seed = 1
    @State private var board = CircuitTrail.make()
    @State private var moves = 0
    @State private var hintMessage: String?

    var body: some View {
        let trace = board.trace()
        VStack(alignment: .leading, spacing: Space.md) {
            Text("Turn the tiles to connect IN on the left of the top-left tile to OUT on the right of the bottom-right tile. Touching paths must line up.")
                .font(Typography.body).foregroundStyle(Palette.textSecond)
            Text("IN →").font(Typography.body.weight(.bold)).foregroundStyle(Palette.accent)
                .accessibilityHidden(true)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Space.sm), count: 4), spacing: Space.sm) {
                ForEach(board.tiles.indices, id: \.self) { index in
                    tile(index, powered: trace.powered.contains(index))
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Circuit trail, four rows and four columns")
            Text("→ OUT").font(Typography.body.weight(.bold)).foregroundStyle(Palette.accent)
                .frame(maxWidth: .infinity, alignment: .trailing).accessibilityHidden(true)
            Text(trace.solved ? "Connected! You found a path." : "\(moves) turns · \(trace.powered.count) tiles connected")
                .font(Typography.cardTitle).foregroundStyle(trace.solved ? Palette.green : Palette.text)
                .accessibilityIdentifier("practice.circuit.status")
            if let hintMessage { Text(hintMessage).font(Typography.body).foregroundStyle(Palette.textSecond) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130))], alignment: .leading, spacing: Space.sm) {
                Button("Show a hint") {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
                        if let index = board.hint() { hintMessage = "Tile at row \(index / 4 + 1), column \(index % 4 + 1) now fits a path. Follow its ends." }
                    }
                }
                .disabled(trace.solved)
                Button("Start over") { board = .make(seed: seed); moves = 0; hintMessage = nil }
                Button("New circuit") { seed += 1; board = .make(seed: seed); moves = 0; hintMessage = nil }
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }
    }

    private func tile(_ index: Int, powered: Bool) -> some View {
        let tile = board.tiles[index]
        let directions = tile.ports().sorted().map { ["up", "right", "down", "left"][$0] }.joined(separator: " and ")
        return Button {
            Haptics.selection()
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { board.rotate(index); moves += 1 }
            hintMessage = nil
        } label: {
            CircuitTrack(curved: tile.curved)
                .stroke(powered ? Palette.accent : Palette.textSecond, style: StrokeStyle(lineWidth: powered ? 8 : 6, lineCap: .round))
                .rotationEffect(.degrees(Double(tile.turns) * 90))
                .padding(8)
                .frame(minWidth: 44, minHeight: 44)
                .aspectRatio(1, contentMode: .fit)
                .background(powered ? Palette.accentSoft : Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field))
                .overlay(alignment: .center) {
                    if powered { Circle().fill(Palette.accent).frame(width: 8, height: 8) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Row \(index / 4 + 1), column \(index % 4 + 1). \(directions).\(index == 0 ? " IN." : index == 15 ? " OUT." : "")")
        .accessibilityValue(powered ? "Connected to IN" : "Not connected to IN")
        .accessibilityHint("Turns this tile one quarter-turn clockwise")
        .accessibilityIdentifier("practice.circuit.tile.\(index)")
    }
}

private struct CircuitTrack: Shape {
    let curved: Bool
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        if curved {
            path.addLine(to: CGPoint(x: rect.midX, y: rect.midY - rect.height * 0.16))
            path.addQuadCurve(to: CGPoint(x: rect.midX + rect.width * 0.16, y: rect.midY), control: CGPoint(x: rect.midX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        } else { path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY)) }
        return path
    }
}
