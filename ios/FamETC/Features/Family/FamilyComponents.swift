import SwiftUI

// Small shared pieces for the native Family & account screens. Family Rings tokens only:
// violet for actions, cards on the grey canvas, Geist type, 44 pt touch targets.

/// The look of a capsule action. `prominent` is the one primary action of a card;
/// `secondary` is an outlined capsule; `quiet` is text only.
struct PlanButtonLabel: View {
    let title: String
    var systemImage: String? = nil
    var style: PlanButton.Style = .secondary
    var busy = false
    /// Stretch to the card width (the primary action of a card).
    var fullWidth = false

    private var ink: Color {
        switch style {
        case .prominent: return Palette.frOnYou
        case .secondary, .quiet: return Palette.frYouInk
        case .destructive: return Palette.frDanger
        }
    }

    var body: some View {
        HStack(spacing: Space.sm) {
            if busy {
                ProgressView().tint(ink)
            } else if let systemImage {
                Image(systemName: systemImage).accessibilityHidden(true)
            }
            Text(title).fixedSize(horizontal: false, vertical: true)
        }
        .font(Typography.body.weight(.semibold))
        .foregroundStyle(ink)
        .padding(.horizontal, style == .quiet ? Space.sm : Space.lg)
        .frame(minHeight: 44)
        .frame(maxWidth: fullWidth ? CGFloat.infinity : nil)
        .background {
            switch style {
            case .prominent: Capsule().fill(Palette.frYou)
            case .secondary: Capsule().strokeBorder(Palette.frYou, lineWidth: 1)
            case .destructive: Capsule().strokeBorder(Palette.frDanger.opacity(0.6), lineWidth: 1)
            case .quiet: Color.clear
            }
        }
        .contentShape(Capsule())
    }
}

/// A capsule action button.
struct PlanButton: View {
    enum Style { case prominent, secondary, quiet, destructive }

    let title: String
    var systemImage: String? = nil
    var style: Style = .secondary
    var busy = false
    var fullWidth = false
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            PlanButtonLabel(title: title, systemImage: systemImage, style: style, busy: busy, fullWidth: fullWidth)
        }
        .buttonStyle(PressableStyle())
        .disabled(busy)
    }
}

/// An inline, calm error line (never red-alarm wording; the message comes from the caller).
struct PlanErrorLine: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(Typography.label)
            .foregroundStyle(Palette.frDanger)
            .fixedSize(horizontal: false, vertical: true)
    }
}


/// How a kid sign-in code is shown: one character per tile, plus a countdown.
enum SetupCodeDisplay {
    /// "ABC123" -> ["A", "B", "C", "1", "2", "3"]; spaces and dashes are never part of a code.
    static func characters(_ code: String) -> [String] {
        code.filter { !$0.isWhitespace && $0 != "-" }.map { String($0).uppercased() }
    }

    /// "28:41" — never negative; an hour or more reads "1:02:03".
    static func countdown(remaining: TimeInterval) -> String {
        let total = max(0, Int(remaining.rounded(.down)))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

enum FamETCLinks {
    /// The public App Store listing (same link as fametc.com's landing page).
    static let appStore = URL(string: "https://apps.apple.com/us/app/fam-etc-family-planner-chat/id6787317215")!
}
