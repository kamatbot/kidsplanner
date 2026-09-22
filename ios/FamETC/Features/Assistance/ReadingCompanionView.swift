import SwiftUI

struct ReadingCompanionView: View {
    let article: RecentNewsItem
    let vocabulary: VocabularyWord?
    var assistant: any LocalLearningAssisting = LocalLearningAssistant.shared

    private enum ViewState {
        case idle
        case loading
        case result(LocalLearningResponse)
        case unavailable(LocalLearningAvailability)
        case failed(String)
    }

    @State private var selectedParagraph = ""
    @State private var state: ViewState = .idle
    @State private var generationTask: Task<Void, Never>?

    private var request: LocalLearningRequest {
        let paragraph = selectedParagraph.trimmingCharacters(in: .whitespacesAndNewlines)
        return LocalLearningRequest(
            intent: .readingCompanion,
            title: article.headline,
            sourceText: paragraph.isEmpty ? article.summary : paragraph,
            sourceKind: paragraph.isEmpty ? .articleSummary : .selectedParagraph,
            vocabulary: vocabulary.map {
                LocalVocabularyContext(word: $0.word, partOfSpeech: $0.pos, definition: $0.def)
            }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Divider().overlay(Palette.border)

            Label("Reading companion", systemImage: "text.book.closed")
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.text)

            Text("Use the article summary, or paste one paragraph you want help understanding. Nothing is sent to a cloud AI.")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: Space.xs) {
                Text("Paragraph to explore (optional)")
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.text)
                TextField("Paste or type one paragraph", text: $selectedParagraph, axis: .vertical)
                    .lineLimit(3...7)
                    .font(Typography.body)
                    .padding(Space.sm)
                    .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                    .disabled(isLoading)
                    .onChange(of: selectedParagraph) { _, _ in resetGeneratedResult() }
                Text(request.sourceKind.disclosure)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }

            controls
            resultContent
        }
        .onDisappear { generationTask?.cancel() }
    }

    @ViewBuilder
    private var controls: some View {
        switch state {
        case .loading:
            HStack(spacing: Space.sm) {
                ProgressView()
                Text("Building on this device…")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                Spacer()
                Button("Cancel") { cancel() }
                    .frame(minWidth: 44, minHeight: 44)
            }
        case .result:
            Button("Build again") { start() }
                .buttonStyle(.bordered)
                .tint(Palette.accent)
                .frame(minHeight: 44)
        case .failed, .unavailable:
            VStack(alignment: .leading, spacing: Space.sm) {
                Button("Try on-device again") { start() }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.accent)
                    .frame(minHeight: 44)
                Button("Use simple guide") { useDeterministicGuide() }
                    .buttonStyle(.bordered)
                    .tint(Palette.accent)
                    .frame(minHeight: 44)
            }
        case .idle:
            VStack(alignment: .leading, spacing: Space.sm) {
                Button("Start on-device guide") { start() }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.accent)
                    .frame(minHeight: 44)
                Button("Use a simple guide without AI") { useDeterministicGuide() }
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.accent)
                    .frame(minHeight: 44)
            }
        }
    }

    @ViewBuilder
    private var resultContent: some View {
        switch state {
        case .result(let response):
            VStack(alignment: .leading, spacing: Space.md) {
                Text(response.sourceKind.disclosure)
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.textSecond)
                if response.method == .onDeviceModel {
                    Label("Created privately on this device", systemImage: "iphone.and.arrow.forward")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.accent)
                } else {
                    Label("Simple guide — no AI used", systemImage: "list.bullet.rectangle")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
                responseSection("In plain language", response.overview, symbol: "text.alignleft")
                responseSection("Vocabulary connection", response.connection, symbol: "character.book.closed")
                responseSection("Talk about it", response.question, symbol: "bubble.left.and.bubble.right")
                if response.method == .onDeviceModel {
                    Text("On-device AI can make mistakes. Check the supplied text before relying on an explanation.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
            }
        case .unavailable(let availability):
            statusMessage("On-device guide unavailable", availability.explanation, symbol: "iphone.slash")
        case .failed(let message):
            statusMessage("The guide stopped", message, symbol: "exclamationmark.triangle")
        case .idle, .loading:
            EmptyView()
        }
    }

    private func responseSection(_ title: String, _ body: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Label(title, systemImage: symbol)
                .font(Typography.caption.weight(.bold))
                .foregroundStyle(Palette.text)
            Text(body)
                .font(Typography.body)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func statusMessage(_ title: String, _ body: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Label(title, systemImage: symbol)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.text)
            Text(body)
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var isLoading: Bool {
        if case .loading = state { return true }
        return false
    }

    private func start() {
        generationTask?.cancel()
        state = .loading
        let currentRequest = request
        generationTask = Task {
            let availability = await assistant.availability
            guard !Task.isCancelled else { return }
            guard availability == .available else {
                state = .unavailable(availability)
                return
            }
            do {
                let response = try await assistant.respond(to: currentRequest)
                guard !Task.isCancelled else { return }
                state = .result(response)
            } catch is CancellationError {
                guard !Task.isCancelled else { return }
                state = .idle
            } catch {
                guard !Task.isCancelled else { return }
                state = .failed((error as? LocalizedError)?.errorDescription ?? "No text left this device. Try again or use the simple guide.")
            }
        }
    }

    private func cancel() {
        generationTask?.cancel()
        generationTask = nil
        state = .idle
    }

    private func useDeterministicGuide() {
        generationTask?.cancel()
        do {
            state = .result(try DeterministicLearningGuide.reading(for: request))
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private func resetGeneratedResult() {
        guard !isLoading else { return }
        if case .result = state { state = .idle }
    }
}
