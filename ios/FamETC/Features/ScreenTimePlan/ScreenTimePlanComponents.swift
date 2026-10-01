import SwiftUI

// Small shared pieces for the Screen Time plan screens (Home, setup checklist, Family,
// kid home). Family Rings tokens only: violet for actions, cards on the grey canvas,
// Geist type, 44 pt touch targets. Nothing here is plan logic.

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

/// Page scaffold for the plan's native screens: the grey canvas, a readable column on wide
/// screens (never a stretched phone layout) and a 16 pt gutter on phones.
struct PlanPage<Content: View>: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    var maxWidth: CGFloat = 720
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: sizeClass == .regular ? Space.xl : Space.lg) {
                content()
            }
            .padding(.horizontal, sizeClass == .regular ? Space.xxl : Space.lg)
            .padding(.vertical, Space.lg)
            .frame(maxWidth: maxWidth)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(ScreenBackground())
    }
}
