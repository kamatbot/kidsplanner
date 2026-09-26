import SwiftUI

struct RingMetric: Equatable, Identifiable {
    let id: String
    let value: Int
    let total: Int
    let color: Color
    let label: String

    var fraction: CGFloat {
        guard total > 0 else { return 0 }
        return min(1, max(0, CGFloat(value) / CGFloat(total)))
    }

    var accessibilityValue: String {
        total > 0 ? "\(value) of \(total)" : "none yet"
    }
}

/// Flat, count-based Family Rings. Callers own identity so a changed family, child,
/// or day remounts this view instead of animating one person's data into another's.
struct FamilyRing: View {
    enum Style { case kid, parent, mini }

    let style: Style
    let diameter: CGFloat
    /// Outer to inner. A nil slot retains its radius but deliberately draws nothing.
    let metrics: [RingMetric?]
    var accessibilityText: String? = nil
    var isButtonContent = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var stroke: CGFloat {
        switch style {
        case .kid: diameter * 14 / 156
        case .parent: diameter * 18 / 188
        case .mini: 5
        }
    }

    private var gap: CGFloat { style == .kid ? diameter * 4 / 156 : 0 }

    private var inset: CGFloat {
        switch style {
        case .kid: diameter * 5 / 156
        case .parent: diameter * 5 / 188
        case .mini: 1
        }
    }

    private func radius(for index: Int) -> CGFloat {
        diameter / 2 - stroke / 2 - inset - CGFloat(index) * (stroke + gap)
    }

    private var generatedAccessibilityText: String {
        metrics.enumerated().map { index, metric in
            guard let metric else {
                return metrics.count == 3 && index == 1 ? "Daily 4: unavailable." : "Unavailable."
            }
            return "\(metric.label): \(metric.accessibilityValue)."
        }.joined(separator: " ")
    }

    var body: some View {
        ZStack {
            ForEach(Array(metrics.enumerated()), id: \.offset) { index, metric in
                if let metric {
                    FamilyRingLayer(
                        metric: metric,
                        radius: radius(for: index),
                        stroke: stroke,
                        dashScale: diameter / 156,
                        reduceMotion: reduceMotion
                    )
                }
            }
        }
        .frame(width: diameter, height: diameter)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText ?? generatedAccessibilityText)
        .accessibilityAddTraits(isButtonContent ? [] : .isImage)
    }
}

private struct FamilyRingLayer: View {
    let metric: RingMetric
    let radius: CGFloat
    let stroke: CGFloat
    let dashScale: CGFloat
    let reduceMotion: Bool

    @Environment(\.colorScheme) private var colorScheme
    @State private var previousFraction: CGFloat?
    @State private var sparkVisible = false
    @State private var glowing = false

    private var fraction: CGFloat { metric.fraction }
    private var trackOpacity: Double {
        glowing ? 0.35 : Palette.trackOpacity(colorScheme)
    }

    var body: some View {
        ZStack {
            track
            Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(metric.color, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: radius * 2, height: radius * 2)
                    .opacity(fraction > 0 ? 1 : 0)
                    .animation(Motion.maybe(Motion.ring, reduceMotion: reduceMotion), value: fraction)
            if !reduceMotion { spark }
        }
        .task(id: fraction) {
            let oldFraction = previousFraction
            previousFraction = fraction
            guard let oldFraction, fraction > oldFraction, !reduceMotion else { return }
            sparkVisible = true
            await Task.yield()
            withAnimation(Motion.spark) { sparkVisible = false }
            if fraction >= 1 && oldFraction < 1 {
                withAnimation(Motion.glow) { glowing = true }
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                withAnimation(Motion.glow) { glowing = false }
            }
        }
        .onChange(of: reduceMotion) { _, enabled in
            if enabled { sparkVisible = false; glowing = false }
        }
    }

    @ViewBuilder private var track: some View {
        if metric.total == 0 {
            Circle()
                .stroke(metric.color.opacity(trackOpacity), style: StrokeStyle(lineWidth: stroke, dash: [4 * dashScale, 7 * dashScale]))
                .frame(width: radius * 2, height: radius * 2)
        } else {
            Circle()
                .stroke(metric.color.opacity(trackOpacity), lineWidth: stroke)
                .frame(width: radius * 2, height: radius * 2)
        }
    }

    private var spark: some View {
        let angle = -Double.pi / 2 + Double(fraction) * 2 * Double.pi
        let x = cos(angle) * Double(radius)
        let y = sin(angle) * Double(radius)
        return ZStack {
            Circle().fill(Palette.frCard).frame(width: 4, height: 4)
            Circle().stroke(metric.color, lineWidth: 2).frame(width: 18, height: 18)
        }
        .offset(x: x, y: y)
        .opacity(sparkVisible ? 1 : 0)
    }
}

#Preview("Partial") {
    FamilyRing(style: .kid, diameter: 156, metrics: [
        RingMetric(id: "homework", value: 3, total: 5, color: Palette.frHw, label: "Homework"),
        RingMetric(id: "daily3", value: 2, total: 4, color: Palette.frD3, label: "Daily 4"),
        RingMetric(id: "habits", value: 1, total: 2, color: Palette.frHab, label: "Habits")
    ])
    .padding()
    .background(Palette.frBg)
}

#Preview("Empty") {
    FamilyRing(style: .kid, diameter: 156, metrics: [
        RingMetric(id: "homework", value: 0, total: 0, color: Palette.frHw, label: "Homework"),
        RingMetric(id: "daily3", value: 0, total: 0, color: Palette.frD3, label: "Daily 4"),
        RingMetric(id: "habits", value: 0, total: 0, color: Palette.frHab, label: "Habits")
    ])
    .padding()
    .background(Palette.frBg)
}

#Preview("Full, Daily 4 unavailable") {
    FamilyRing(style: .kid, diameter: 156, metrics: [
        RingMetric(id: "homework", value: 5, total: 5, color: Palette.frHw, label: "Homework"),
        nil,
        RingMetric(id: "habits", value: 2, total: 2, color: Palette.frHab, label: "Habits")
    ])
    .padding()
    .background(Palette.frBg)
    .preferredColorScheme(.dark)
}

#Preview("Mini") {
    FamilyRing(style: .mini, diameter: 44, metrics: [
        RingMetric(id: "daily3", value: 1, total: 2, color: Palette.frD3, label: "Daily 4")
    ])
    .padding()
    .background(Palette.frBg)
}
