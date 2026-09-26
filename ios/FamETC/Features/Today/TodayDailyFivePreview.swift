import SwiftUI

/// The three Daily 3 activities keep their existing sheets and completion records.
enum DailyFiveActivity: String, CaseIterable, Identifiable {
    case news
    case quote
    case word

    var id: String { rawValue }
    var progressPart: String { rawValue }

    var title: String {
        switch self {
        case .news: "News"
        case .quote: "Quote"
        case .word: "Word"
        }
    }
}

enum DailyFiveActivityStatus: Equatable {
    case loading, available, started, completed, unavailable

    var isCompleted: Bool { self == .completed }

    var shortLabel: String {
        switch self {
        case .loading: "Loading"
        case .available: "Ready"
        case .started: "In progress"
        case .completed: "Done"
        case .unavailable: "Unavailable"
        }
    }

    /// A two-step ring makes 0%, 50%, and 100% visible without a second count.
    var ringMetric: (value: Int, total: Int) {
        switch self {
        case .completed: (2, 2)
        case .started: (1, 2)
        case .loading, .available, .unavailable: (0, 2)
        }
    }
}

/// The existing daily5 progress response. It is child-scoped and only used when
/// the signed-in kid session can read the authoritative record.
struct DailyFiveProgressPayload: Decodable {
    struct Part: Decodable { let status: String }
    let date: String
    let parts: [String: Part]
}

struct TodayDailyFivePreview: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    let isKid: Bool
    let statuses: [DailyFiveActivity: DailyFiveActivityStatus]
    let challengeStatus: DailyFiveActivityStatus
    let challengeDetail: String
    let onOpen: (DailyFiveActivity) -> Void
    let onOpenChallenge: () -> Void

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: Space.sm), count: horizontalSizeClass == .regular ? 4 : 2)
    }

    var body: some View {
        Card(padding: Space.md) {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        MicroLabel(text: isKid ? "Your day" : "Daily 3")
                        Text("Daily 3")
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.frInk)
                    }
                    Spacer()
                    Text("Small steps today")
                        .font(Typography.label)
                        .foregroundStyle(Palette.frInk2)
                }

                LazyVGrid(columns: columns, spacing: Space.sm) {
                    ForEach(DailyFiveActivity.allCases) { activity in
                        DailyThreeTile(
                            id: "today.daily3.\(activity.rawValue)",
                            title: activity.title,
                            status: statuses[activity] ?? .unavailable,
                            detail: nil,
                            action: { onOpen(activity) }
                        )
                    }
                    DailyThreeTile(
                        id: "today.daily3.challenge",
                        title: "Challenge",
                        status: challengeStatus,
                        detail: challengeDetail,
                        action: onOpenChallenge
                    )
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

private struct DailyThreeTile: View {
    let id: String
    let title: String
    let status: DailyFiveActivityStatus
    let detail: String?
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            VStack(spacing: Space.sm) {
                let metric = status.ringMetric
                if status == .loading {
                    Circle().fill(Palette.frCard2).frame(width: 44, height: 44).redacted(reason: .placeholder)
                } else if status == .unavailable {
                    Image(systemName: "circle.dashed").font(.system(size: 36, weight: .light)).foregroundStyle(Palette.frInk3).frame(width: 44, height: 44).accessibilityHidden(true)
                } else {
                FamilyRing(
                    style: .mini,
                    diameter: 44,
                    metrics: [RingMetric(id: id, value: metric.value, total: metric.total, color: Palette.frD3, label: title)]
                )
                .accessibilityHidden(true)
                }

                Text(title)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.frInk)
                    .lineLimit(1)
                Text(detail ?? status.shortLabel)
                    .font(Typography.label)
                    .foregroundStyle(Palette.frInk2)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 116)
            .padding(.vertical, Space.sm)
            .background(Palette.frCard2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(scale: 0.98))
        .accessibilityIdentifier(id)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Opens today's \(title.lowercased())")
    }

    private var accessibilityLabel: String {
        "\(title), \(detail ?? status.shortLabel)"
    }
}
