import SwiftUI

/// The five Daily 5 activities share one compact entry point on Today. The
/// preview intentionally owns only presentation: each activity still opens its
/// existing native experience through the callback supplied by `DailyFiveCard`.
enum DailyFiveActivity: String, CaseIterable, Identifiable {
    case news
    case word
    case quote
    case puzzle
    case brain

    var id: String { rawValue }

    var progressPart: String {
        switch self {
        case .news: return "news"
        case .word: return "word"
        case .quote: return "quote"
        case .puzzle: return "puzzle"
        case .brain: return "bt"
        }
    }

    var title: String {
        switch self {
        case .news: return "News"
        case .word: return "Word"
        case .quote: return "Quote"
        case .puzzle: return "Puzzle"
        case .brain: return "Brain"
        }
    }

    var systemImage: String {
        switch self {
        case .news: return "newspaper"
        case .word: return "textformat.abc"
        case .quote: return "quote.bubble"
        case .puzzle: return "puzzlepiece"
        case .brain: return "brain.head.profile"
        }
    }
}

enum DailyFiveActivityStatus: Equatable {
    case loading
    case available
    case started
    case completed
    case unavailable

    var isCompleted: Bool {
        self == .completed
    }

    var shortLabel: String {
        switch self {
        case .loading: return "Loading"
        case .available: return "Ready"
        case .started: return "In progress"
        case .completed: return "Done"
        case .unavailable: return "Unavailable"
        }
    }
}

/// The existing daily5 progress response. It is child-scoped and is only used
/// when the signed-in kid's session can read the authoritative record.
struct DailyFiveProgressPayload: Decodable {
    struct Part: Decodable {
        let status: String
    }

    let date: String
    let parts: [String: Part]
}

struct TodayDailyFivePreview: View {
    @Environment(\.dynamicTypeSize) private var textSize
    let isKid: Bool
    let statuses: [DailyFiveActivity: DailyFiveActivityStatus]
    let newsChoices: [DailyNewsChoice]
    let selectedNews: RecentNewsItem?
    let isLoading: Bool
    let progressKnown: Bool
    let canRetry: Bool
    let onOpen: (DailyFiveActivity) -> Void
    let onSelectNews: (RecentNewsItem) -> Void
    let onRetry: () -> Void

    private var completedCount: Int {
        DailyFiveActivity.allCases.reduce(into: 0) { count, activity in
            if statuses[activity]?.isCompleted == true { count += 1 }
        }
    }

    private var nextActivity: DailyFiveActivity {
        DailyFiveActivity.allCases.first(where: {
            let status = statuses[$0] ?? .available
            return !status.isCompleted && status != .unavailable && status != .loading
        }) ?? DailyFiveActivity.allCases.first(where: { statuses[$0]?.isCompleted != true }) ?? .news
    }

    private var availableNewsCount: Int {
        newsChoices.reduce(into: 0) { count, choice in
            if choice.article != nil { count += 1 }
        }
    }

    var body: some View {
        Card(padding: Space.md) {
            VStack(alignment: .leading, spacing: Space.md) {
                momentumHeader
                newsPreview
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var momentumHeader: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            headerLayout {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Daily 5")
                        .font(Typography.cardTitle.weight(.bold))
                        .foregroundStyle(Palette.onAccent)
                    Text(isKid ? "One small win at a time" : "Explore together")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.onAccent.opacity(0.86))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: Space.sm)
                Button {
                    Haptics.selection()
                    onOpen(nextActivity)
                } label: {
                    Label("Open", systemImage: "arrow.up.right")
                        .fixedSize(horizontal: true, vertical: false)
                        .font(Typography.caption.weight(.bold))
                        .foregroundStyle(Palette.onAccent)
                        .padding(.horizontal, Space.sm)
                        .frame(minHeight: 44)
                        .background(Palette.onAccent.opacity(0.16), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("today.daily5.open")
                .accessibilityHint("Open the next Daily 5 activity")
            }

            if isLoading {
                Text("Progress updating…")
                    .font(Typography.monoSmall.weight(.bold))
                    .foregroundStyle(Palette.onAccent.opacity(0.9))
                    .accessibilityLabel("Daily 5 progress is updating")
            } else if !progressKnown {
                Text("Progress updates as you go")
                    .font(Typography.monoSmall.weight(.bold))
                    .foregroundStyle(Palette.onAccent.opacity(0.9))
                    .accessibilityLabel("Daily 5 progress is not available yet")
            } else {
                Text("\(completedCount) of \(DailyFiveActivity.allCases.count) complete")
                    .font(Typography.monoSmall.weight(.bold))
                    .foregroundStyle(Palette.onAccent)
                    .accessibilityLabel("\(completedCount) of \(DailyFiveActivity.allCases.count) activities complete")
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Space.sm), count: textSize.isAccessibilitySize ? 2 : 5), spacing: Space.md) {
                    ForEach(DailyFiveActivity.allCases) { activity in
                        DailyFiveProgressButton(
                            activity: activity,
                            status: statuses[activity] ?? .available,
                            onGradient: true,
                            action: { onOpen(activity) }
                        )
                    }
            }
        }
        .padding(Space.lg)
        .background(Signal.gradient(), in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    private var headerLayout: AnyLayout {
        textSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.sm))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: Space.sm))
    }

    @ViewBuilder
    private var newsPreview: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pick your story")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                }
                Spacer(minLength: Space.sm)
                if !isLoading && !newsChoices.isEmpty {
                    Text("\(availableNewsCount) of \(newsChoices.count) available")
                        .font(Typography.monoSmall)
                        .foregroundStyle(Palette.textSecond)
                }
                if statuses[.news]?.isCompleted == true {
                    Label("Reflection saved", systemImage: "checkmark.circle.fill")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.green)
                }
            }

            if isLoading {
                HStack(spacing: Space.sm) {
                    ProgressView()
                    Text("Finding today's stories…")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
                .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
            } else if newsChoices.isEmpty || availableNewsCount == 0 {
                VStack(alignment: .leading, spacing: Space.sm) {
                    Label("No recent stories available", systemImage: "newspaper")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                    Text("The three categories will return when today's edition is ready.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                    if canRetry {
                        Button("Retry stories") { onRetry() }
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(Palette.accent)
                            .frame(minHeight: 44)
                    }
                }
            } else {
                GeometryReader { geometry in
                    let tileWidth = max(88, (geometry.size.width - Space.sm * 2) / 3)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Space.sm) {
                            ForEach(newsChoices) { choice in
                                Button {
                                    guard let article = choice.article else { return }
                                    Haptics.selection()
                                    onSelectNews(article)
                                } label: {
                                    DailyFiveNewsChoiceTile(
                                        choice: choice,
                                        isSelected: choice.article?.id == selectedNews?.id,
                                        width: tileWidth
                                    )
                                }
                                .buttonStyle(.plain)
                                .disabled(choice.article == nil)
                                .accessibilityIdentifier("today.daily5.news.\(choice.category)")
                                .accessibilityLabel(newsAccessibilityLabel(choice))
                                .accessibilityHint(choice.article == nil ? "No recent story is available" : "Preview this story")
                            }
                        }
                        .padding(.vertical, Space.xs)
                    }
                }
                .frame(height: 96)

                if let selectedNews {
                    Button {
                        Haptics.selection()
                        onOpen(.news)
                    } label: {
                        HStack(alignment: .top, spacing: Space.sm) {
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Text(selectedNews.headline)
                                    .font(Typography.body.weight(.bold))
                                    .foregroundStyle(Palette.text)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(DailyNewsSelection.publisherLine(selectedNews))
                                    .font(Typography.caption)
                                    .foregroundStyle(Palette.textSecond)
                            }
                            Spacer(minLength: Space.sm)
                            Image(systemName: "arrow.up.right.circle.fill")
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundStyle(Palette.accent)
                                .accessibilityHidden(true)
                        }
                        .padding(Space.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                                .strokeBorder(Palette.accent.opacity(0.28), lineWidth: 1)
                        )
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityIdentifier("today.daily5.news")
                    .accessibilityHint("Open the selected story, reading companion, and reflection")
                } else {
                    Text("Choose a story to preview its headline, then open the full story.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(minHeight: 44, alignment: .leading)
                }
            }
        }
    }

    private func newsAccessibilityLabel(_ choice: DailyNewsChoice) -> String {
        guard let article = choice.article else {
            return "\(shortNewsLabel(choice)). No recent story available."
        }
        return "\(shortNewsLabel(choice)). Illustration. \(article.headline)"
    }

    private func shortNewsLabel(_ choice: DailyNewsChoice) -> String {
        switch choice.category {
        case "regional": return "Local"
        case "science": return "Science"
        case "culture": return "Culture"
        default: return choice.label
        }
    }
}

private struct DailyFiveProgressButton: View {
    let activity: DailyFiveActivity
    let status: DailyFiveActivityStatus
    var onGradient = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: Space.xs) {
                ZStack {
                    Circle()
                        .fill(circleFill)
                        .frame(width: 48, height: 48)
                    Circle()
                        .strokeBorder(circleStroke, lineWidth: status.isCompleted ? 0 : 1)
                        .frame(width: 48, height: 48)
                    if status == .loading {
                        ProgressView()
                            .tint(onGradient ? Palette.onAccent : Palette.accent)
                    } else {
                        Image(systemName: iconName)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(iconColor)
                    }
                }
                Text(activity.title)
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(onGradient ? Palette.onAccent : Palette.text)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(minHeight: 30, alignment: .top)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 70, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.96))
        .accessibilityLabel("\(activity.title), \(status.shortLabel)")
        .accessibilityHint("Opens today's \(activity.title.lowercased()) activity")
    }

    private var circleFill: Color {
        if status.isCompleted { return onGradient ? Palette.panel : Palette.accent }
        return onGradient ? Palette.onAccent.opacity(0.12) : Palette.panel2
    }

    private var circleStroke: Color {
        onGradient ? Palette.onAccent.opacity(0.78) : Palette.border
    }

    private var iconColor: Color {
        if status == .unavailable { return Palette.warn }
        return status.isCompleted
            ? (onGradient ? Palette.accent : Palette.onAccent)
            : (onGradient ? Palette.onAccent : Palette.accent)
    }

    private var iconName: String {
        if status.isCompleted { return "checkmark" }
        if status == .unavailable { return "exclamationmark.circle" }
        return activity.systemImage
    }
}

private struct DailyFiveNewsChoiceTile: View {
    let choice: DailyNewsChoice
    let isSelected: Bool
    let width: CGFloat

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Image(imageName)
                .resizable()
                .scaledToFill()
                .frame(width: width, height: 96)
                .clipped()
                .overlay(Color.black.opacity(choice.article == nil ? 0.42 : 0.06))

            LinearGradient(
                colors: [.clear, .black.opacity(0.78)],
                startPoint: .center,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: 2) {
                Text("Illustration")
                    .font(Typography.monoSmall.weight(.bold))
                    .foregroundStyle(.white.opacity(0.82))
                Text(categoryLabel)
                    .font(Typography.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
            }
            .padding(Space.sm)
        }
        .frame(width: width, height: 96)
        .clipShape(RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                .strokeBorder(isSelected ? Palette.accent : Palette.border, lineWidth: isSelected ? 2 : 1)
        )
        .opacity(choice.article == nil ? 0.62 : 1)
    }

    private var imageName: String {
        switch choice.category {
        case "regional": return "TodayJourneyArt"
        case "science": return "TodayNewsArt"
        case "culture": return "TodayStudyArt"
        default: return "TodayNewsArt"
        }
    }

    private var categoryLabel: String {
        switch choice.category {
        case "regional": return "Local"
        case "science": return "Science"
        case "culture": return "Culture"
        default: return choice.label
        }
    }
}
