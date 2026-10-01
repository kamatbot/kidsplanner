import SwiftUI

// "Sticker adventure" — the playful layer of onboarding. Parents get the calm version (a small
// sticker and a step bar on each setup step); kids get the full one (a big sticker hero on a
// colour wash, centred type). The art is the app's own sticker set (Assets: Corner-<id>), so
// it matches My Corner; every sticker here is decorative and hidden from VoiceOver — the
// headings and buttons carry the meaning. Colours are the Family Rings hues only.

/// A sticker picked for what a screen is about (sleep, waiting, being brave…).
enum OnbSticker: String, CaseIterable {
    case sleepyCat = "sleepy-cat"
    case readingBear = "reading-bear"
    case cyclingBunny = "cycling-bunny"
    case gratefulOtter = "grateful-otter"
    case rainbow
    case sunshine
    case happyCapybara = "happy-capybara"
    case joyfulPanda = "joyful-panda"
    case leafUmbrella = "leaf-umbrella"
    case paperPlane = "paper-plane"
    case spaceRocket = "space-rocket"
    case curiousOwl = "curious-owl"
    case braveLion = "brave-lion"
    case shyBunny = "shy-bunny"
    case tiredSloth = "tired-sloth"
    case smallStar = "small-star"
    case proudPeacock = "proud-peacock"
    case focusedRobot = "focused-robot"
    case gameController = "game-controller"
    case paintingPalette = "painting-palette"
    case dancingDino = "dancing-dino"

    var image: Image { Image("Corner-" + rawValue) }
}

/// The hue a screen is painted in — always one of the Family Rings colours.
enum OnbHue: CaseIterable {
    case violet, orange, pink, teal, gold

    var strong: Color {
        switch self {
        case .violet: return Palette.frYou
        case .orange: return Palette.frHw
        case .pink: return Palette.frHab
        case .teal: return Palette.frD3
        case .gold: return Palette.frFams
        }
    }
    /// Text and icons on `soft` (≥ 4.5:1 in light and dark).
    var ink: Color {
        switch self {
        case .violet: return Palette.frYouInk
        case .orange: return Palette.frHwInk
        case .pink: return Palette.frHabInk
        case .teal: return Palette.frD3Ink
        case .gold: return Palette.frFamsInk
        }
    }
    var soft: Color {
        switch self {
        case .violet: return Palette.frYouSoft
        case .orange: return Palette.frHwSoft
        case .pink: return Palette.frHabSoft
        case .teal: return Palette.frD3Soft
        case .gold: return Palette.frFamsSoft
        }
    }
}

// MARK: - Shapes

/// A soft organic blob (a smooth closed curve through jittered points on an ellipse). Used
/// behind stickers and as the page wash — never as a mask over the art.
struct OnbBlob: Shape {
    /// Picks one of a few hand-tuned outlines so neighbouring blobs don't look stamped.
    var variant: Int = 0

    private static let outlines: [[CGFloat]] = [
        [1.00, 0.90, 1.06, 0.94, 1.02, 0.88, 1.05, 0.93],
        [0.94, 1.05, 0.90, 1.02, 0.96, 1.07, 0.89, 1.01],
        [1.04, 0.92, 0.98, 1.06, 0.90, 1.00, 1.03, 0.91],
    ]

    func path(in rect: CGRect) -> Path {
        let radii = Self.outlines[abs(variant) % Self.outlines.count]
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let points: [CGPoint] = radii.enumerated().map { index, scale in
            let angle = Double(index) / Double(radii.count) * 2 * .pi - .pi / 2
            return CGPoint(x: center.x + cos(angle) * rect.width / 2 * scale,
                           y: center.y + sin(angle) * rect.height / 2 * scale)
        }
        // Catmull-Rom through the points, closed, as cubic Béziers.
        var path = Path()
        let count = points.count
        path.move(to: points[0])
        for i in 0..<count {
            let p0 = points[(i - 1 + count) % count], p1 = points[i]
            let p2 = points[(i + 1) % count], p3 = points[(i + 2) % count]
            let c1 = CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6)
            let c2 = CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6)
            path.addCurve(to: p2, control1: c1, control2: c2)
        }
        path.closeSubpath()
        return path
    }
}

// MARK: - Stickers

/// One big sticker on a soft blob, tilted as if just stuck on. It lands once with a small
/// spring when the screen appears; Reduce Motion shows it in place. Shrinks at accessibility
/// text sizes so the words stay on screen.
struct OnbStickerHero: View {
    let sticker: OnbSticker
    var hue: OnbHue = .violet
    var size: CGFloat = 168
    var tilt: Double = -6

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var landed = false

    private var side: CGFloat { typeSize.isAccessibilitySize ? size * 0.6 : size }

    var body: some View {
        ZStack {
            OnbBlob(variant: Int(tilt.magnitude) % 3)
                .fill(hue.soft)
                .frame(width: side * 1.18, height: side * 1.04)
                .rotationEffect(.degrees(tilt * -1.5))
            sticker.image
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: side, height: side)
                .shadow(color: Color.black.opacity(0.10), radius: 10, x: 0, y: 6)
                .rotationEffect(.degrees(landed || reduceMotion ? tilt : tilt - 10))
                .scaleEffect(landed || reduceMotion ? 1 : 0.86)
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion, !landed else { return }
            withAnimation(.spring(response: 0.45, dampingFraction: 0.62)) { landed = true }
        }
    }
}

/// A few stickers stuck onto one blob at different sizes and angles — the welcome hero and
/// the "deal done" moment. Offsets are fractions of the frame so it scales with the width.
struct OnbStickerCollage: View {
    struct Item {
        let sticker: OnbSticker
        /// Share of the collage height.
        let size: CGFloat
        /// Centre, as fractions of the frame (0…1).
        let x: CGFloat, y: CGFloat
        let tilt: Double
    }

    let items: [Item]
    var hue: OnbHue = .violet
    var height: CGFloat = 200

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var landed = false

    private var side: CGFloat { typeSize.isAccessibilitySize ? height * 0.6 : height }

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack {
                OnbBlob(variant: 0)
                    .fill(hue.soft)
                    .frame(width: min(width, side * 1.6), height: side * 0.98)
                    .position(x: width / 2, y: side / 2)
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    item.sticker.image
                        .resizable()
                        .interpolation(.high)
                        .scaledToFit()
                        .frame(width: side * item.size, height: side * item.size)
                        .shadow(color: Color.black.opacity(0.10), radius: 8, x: 0, y: 5)
                        .rotationEffect(.degrees(landed || reduceMotion ? item.tilt : item.tilt - 12))
                        .scaleEffect(landed || reduceMotion ? 1 : 0.8)
                        .animation(reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 0.6).delay(Double(index) * 0.08), value: landed)
                        .position(x: width / 2 + (item.x - 0.5) * min(width, side * 1.6), y: side * item.y)
                }
            }
        }
        .frame(height: side)
        .accessibilityHidden(true)
        .onAppear { if !reduceMotion { landed = true } }
    }
}

/// A small sticker on a tinted disc, for reason rows and plan cards.
struct OnbStickerBadge: View {
    let sticker: OnbSticker
    var hue: OnbHue = .violet
    var size: CGFloat = 56

    var body: some View {
        sticker.image
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .padding(size * 0.12)
            .frame(width: size, height: size)
            .background(hue.soft, in: OnbBlob(variant: 1))
            .accessibilityHidden(true)
    }
}

/// One reason, sticker first: a bold short title and one plain line.
struct OnbReasonRow: View {
    let sticker: OnbSticker
    var hue: OnbHue = .violet
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .center, spacing: Space.lg) {
            OnbStickerBadge(sticker: sticker, hue: hue, size: 60)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Theme.font(17, weight: .bold, relativeTo: .headline))
                    .foregroundStyle(Palette.text)
                Text(detail)
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Progress

/// The parent setup steps as rounded segments; done and current ones are violet.
struct OnbStepProgress: View {
    /// 1-based.
    let current: Int
    let total: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...max(total, 1), id: \.self) { index in
                Capsule()
                    .fill(index <= current ? Palette.frYou : Palette.frRule)
                    .frame(height: 6)
                    .frame(maxWidth: index == current ? 34 : 18)
            }
        }
        .animation(.easeOut(duration: 0.3), value: current)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(current) of \(total)")
    }
}

// MARK: - Celebration

/// The one celebration in onboarding: a confetti burst when the deal is signed. Plays once
/// from the top; Reduce Motion skips it. Does not take touches.
struct OnbConfettiBurst: View {
    var pieces = 70
    var duration: Double = 2.2

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    /// Made once on appear, so a parent redraw mid-burst can't reshuffle the pieces.
    @State private var all: [Piece] = []

    private struct Piece {
        let x: CGFloat, drift: CGFloat, speed: CGFloat, spin: Double, size: CGFloat
        let color: Color, round: Bool, delay: Double
    }

    private let palette: [Color] = [Palette.frYou, Palette.frHw, Palette.frHab, Palette.frD3, Palette.frFams]

    private func makePieces() -> [Piece] {
        var generator = SystemRandomNumberGenerator()
        return (0..<pieces).map { index in
            Piece(x: .random(in: 0...1, using: &generator),
                  drift: .random(in: -0.12...0.12, using: &generator),
                  speed: .random(in: 0.75...1.25, using: &generator),
                  spin: .random(in: -540...540, using: &generator),
                  size: .random(in: 7...12, using: &generator),
                  color: palette[index % palette.count],
                  round: index % 3 == 0,
                  delay: .random(in: 0...0.35, using: &generator))
        }
    }

    var body: some View {
        if reduceMotion {
            EmptyView()
        } else {
            TimelineView(.animation) { context in
                let elapsed = context.date.timeIntervalSince(start)
                Canvas { canvas, size in
                    guard elapsed < duration + 0.5 else { return }
                    for piece in all {
                        let t = max(0, elapsed - piece.delay)
                        let progress = min(1, t / duration)
                        let y = -20 + (size.height + 40) * progress * progress * piece.speed
                        let x = size.width * (piece.x + piece.drift * CGFloat(progress))
                        let opacity = 1 - max(0, (progress - 0.8) / 0.2)
                        var piecesContext = canvas
                        piecesContext.opacity = opacity
                        piecesContext.translateBy(x: x, y: y)
                        piecesContext.rotate(by: .degrees(piece.spin * progress))
                        let rect = CGRect(x: -piece.size / 2, y: -piece.size / 4, width: piece.size, height: piece.size / 2)
                        let shape = piece.round ? Path(ellipseIn: rect.insetBy(dx: 1, dy: -1)) : Path(rect)
                        piecesContext.fill(shape, with: .color(piece.color))
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear { all = makePieces(); start = Date() }
        }
    }
}

// MARK: - Page wash

/// The colour behind a playful (kid) page: the hue's soft tint with two large blobs, so the
/// screen reads as colour without a flat fill. Calm pages use the plain app background.
struct OnbWash: View {
    var hue: OnbHue

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Palette.frBg
                hue.soft.opacity(0.55)
                OnbBlob(variant: 0)
                    .fill(hue.soft)
                    .frame(width: geo.size.width * 1.1, height: geo.size.width * 0.9)
                    .position(x: geo.size.width * 0.82, y: geo.size.height * 0.08)
                OnbBlob(variant: 2)
                    .fill(hue.soft)
                    .frame(width: geo.size.width * 0.9, height: geo.size.width * 0.8)
                    .position(x: geo.size.width * 0.1, y: geo.size.height * 0.96)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}
