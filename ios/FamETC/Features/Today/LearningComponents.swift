import SwiftUI

/// Shared vocabulary for focused learning activities, not the Today preview.
struct LearningActivityHeading: View {
    let title: String
    let subtitle: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Image(systemName: systemImage)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Palette.accent)
                .frame(width: 52, height: 52)
                .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field))
                .accessibilityHidden(true)
            Text(title).font(Typography.largeTitle).foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            Text(subtitle).font(Typography.body).foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct LearningFeedback: View {
    enum Kind { case success, retry, info }
    let title: String
    var message: String? = nil
    var kind: Kind = .info

    private var symbol: String {
        switch kind {
        case .success: "checkmark.circle.fill"
        case .retry: "arrow.clockwise.circle"
        case .info: "lightbulb"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: Space.md) {
            Image(systemName: symbol).font(.title3)
                .foregroundStyle(kind == .success ? Palette.green : Palette.accent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(title).font(Typography.cardTitle).foregroundStyle(Palette.text)
                if let message {
                    Text(message).font(Typography.body).foregroundStyle(Palette.textSecond)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Space.lg)
        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field))
        .accessibilityElement(children: .combine)
    }
}

struct LearningOption: View {
    enum State { case idle, correct, incorrect, dimmed }
    let text: String
    let index: Int
    let state: State
    let action: () -> Void

    private var status: String {
        switch state {
        case .idle, .dimmed: ""
        case .correct: "Correct answer"
        case .incorrect: "Your answer, not quite"
        }
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: Space.md) {
                Group {
                    switch state {
                    case .correct: Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.green)
                    case .incorrect: Image(systemName: "arrow.uturn.backward.circle").foregroundStyle(Palette.warn)
                    default: Text(String(index + 1)).font(Typography.monoSmall).foregroundStyle(Palette.accent)
                    }
                }
                .frame(width: 28, height: 28)
                .background(Palette.panel2, in: Circle())
                .accessibilityHidden(true)
                Text(text).font(Typography.body).foregroundStyle(Palette.text)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 3)
            }
            .padding(Space.lg)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field))
            .overlay(RoundedRectangle(cornerRadius: Radius.field)
                .strokeBorder(state == .correct ? Palette.green : state == .incorrect ? Palette.warn : Palette.border,
                              lineWidth: state == .idle || state == .dimmed ? 1 : 2))
            .contentShape(RoundedRectangle(cornerRadius: Radius.field))
        }
        .buttonStyle(.plain)
        .disabled(state != .idle)
        .accessibilityLabel(text)
        .accessibilityValue(status)
    }
}
