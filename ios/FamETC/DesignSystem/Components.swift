import SwiftUI

// MARK: - Card

/// The app's panel surface: rounded, bordered, soft two-layer shadow (mirrors the
/// web `--shadow`). The base building block for every screen.
struct Card<Content: View>: View {
    var padding: CGFloat = Space.xl
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                    .strokeBorder(Palette.border, lineWidth: 1)
            )
            .cardShadow()
    }
}

extension View {
    /// Two-layer soft shadow matching the web `--shadow` token.
    func cardShadow() -> some View {
        self
            .shadow(color: .black.opacity(0.04), radius: 1, x: 0, y: 1)
            .shadow(color: .black.opacity(0.06), radius: 14, x: 0, y: 10)
    }
}

// MARK: - Animated number

/// A number that smoothly rolls between values using the iOS 17 numeric content
/// transition — for net worth, success %, and other KPIs that change live.
struct AnimatedNumber: View {
    let value: Double
    var font: Font = Typography.kpiNumber
    var color: Color = Palette.text
    var format: (Double) -> String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(format(value))
            .font(font)
            .foregroundStyle(color)
            .contentTransition(.numericText(value: value))
            .animation(Motion.maybe(Motion.snappy, reduceMotion: reduceMotion), value: value)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.5)   // never wrap a KPI number (e.g. "$12.11M") to 2 lines
    }
}

// MARK: - KPI label

/// Small uppercase mono caption above a KPI value (mirrors web `KPI_LABEL`).
struct KPILabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(Typography.monoSmall)
            .tracking(0.7)
            .foregroundStyle(Palette.textSecond)
    }
}

// MARK: - KPI card

/// A tappable KPI tile: label, animated value, optional caption. Used across the
/// dashboard; the tap closure powers drill-through to a tab.
struct KPICard: View {
    let label: String
    let value: Double
    var valueColor: Color = Palette.text
    var caption: String? = nil
    var format: (Double) -> String
    var onTap: (() -> Void)? = nil

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                KPILabel(text: label)
                AnimatedNumber(value: value, color: valueColor, format: format)
                if let caption {
                    Text(caption)
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .lineLimit(1)
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard let onTap else { return }
            Haptics.selection()
            onTap()
        }
    }
}

// MARK: - Screen background

/// Standard screen background fill, edge to edge.
struct ScreenBackground: View {
    var body: some View {
        Palette.bg.ignoresSafeArea()
    }
}

// MARK: - Interaction & motion helpers

/// Press feedback for card-like surfaces: a subtle scale-down + dim while held, on
/// a quick spring. Being a ButtonStyle keeps it scroll-safe — the system handles
/// tap-vs-scroll disambiguation, unlike a raw drag gesture. Honors Reduce Motion.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.97
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(reduceMotion ? 1 : (configuration.isPressed ? scale : 1))
            .opacity(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.72), value: configuration.isPressed)
    }
}

extension View {
    /// Turn a card surface into a tappable, press-springy button with a selection
    /// haptic — the standard way to make a whole card feel alive on touch.
    func cardButton(_ action: @escaping () -> Void) -> some View {
        Button { Haptics.selection(); action() } label: { self }
            .buttonStyle(PressableStyle())
    }
}

/// Staggered entrance: fade + 14pt rise, delayed by the card's index so a screen's
/// cards cascade in (60ms apart) when the tab appears. Instant under Reduce Motion.
private struct EntranceModifier: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 14)
            .onAppear {
                guard !shown else { return }
                if reduceMotion { shown = true } else {
                    withAnimation(Motion.entrance(index)) { shown = true }
                }
            }
    }
}

extension View {
    /// Cascade this view in as the `index`-th card on its screen.
    func entrance(_ index: Int) -> some View {
        modifier(EntranceModifier(index: index))
    }
}

/// Primary "run" call-to-action carrying the signal gradient — the one button
/// style allowed to use the purple→pink brand gradient.
struct SignalButton: View {
    let title: String
    var systemImage: String? = nil
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.impact(.light)
            action()
        } label: {
            HStack(spacing: Space.sm) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
            }
            .font(Typography.body.weight(.semibold))
            .foregroundStyle(Palette.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Space.md)
            .background(Signal.gradient(), in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }
}

/// A small dot that gently breathes — a "live" status indicator (mirrors the
/// design's pulsing dot). Loops once it appears; static under Reduce Motion.
struct PulsingDot: View {
    var color: Color
    var size: CGFloat = 7

    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .scaleEffect(on ? 1 : 0.72)
            .opacity(on ? 1 : 0.55)
            .shadow(color: color.opacity(on ? 0.5 : 0), radius: on ? 4 : 0)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { on = true }
            }
    }
}
