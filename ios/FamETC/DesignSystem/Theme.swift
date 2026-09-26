import SwiftUI
import UIKit

// MARK: - Color tokens
//
// Values mirror the web app's CSS custom properties (public/css/styles.css) so the
// native surfaces match the brand exactly in both light and dark. Colors resolve
// per-trait, so a single `.preferredColorScheme` at the root flips the whole palette.

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }

    /// A color that resolves light/dark at render time (driven by the trait
    /// collection, i.e. by `.preferredColorScheme` at the root).
    static func adaptive(_ light: Color, _ dark: Color) -> Color {
        Color(uiColor: UIColor { trait in
            UIColor(trait.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

enum Palette {
    // MARK: Family Rings — values from docs/design/family-rings/BRIEF.md §3.1
    static let frBg = Color.adaptive(Color(hex: 0xF4F5F7), Color(hex: 0x121318))
    static let frCard = Color.adaptive(Color(hex: 0xFFFFFF), Color(hex: 0x1B1D24))
    static let frCard2 = Color.adaptive(Color(hex: 0xF7F8FA), Color(hex: 0x22252D))
    static let frRule = Color.adaptive(Color(hex: 0xE7E9EE), Color(hex: 0x2C2F38))
    static let frInk = Color.adaptive(Color(hex: 0x15171C), Color(hex: 0xF2F3F5))
    static let frInk2 = Color.adaptive(Color(hex: 0x6B7280), Color(hex: 0xA1A7B3))
    static let frInk3 = Color.adaptive(Color(hex: 0x9CA3AF), Color(hex: 0x6E7582))
    static let frYou = Color.adaptive(Color(hex: 0x7B4DFF), Color(hex: 0xA68CFF))
    static let frYouInk = Color.adaptive(Color(hex: 0x5B2EE6), Color(hex: 0xC3B1FF))
    static let frYouSoft = Color.adaptive(Color(hex: 0xEFEAFF), Color(hex: 0xA68CFF, alpha: 0.16))
    static let frOnYou = Color.adaptive(Color(hex: 0xFFFFFF), Color(hex: 0x15121F))
    static let frHw = Color.adaptive(Color(hex: 0xE8467C), Color(hex: 0xFF6F9D))
    static let frHwInk = Color.adaptive(Color(hex: 0xB8205A), Color(hex: 0xFF9CBB))
    static let frHwSoft = Color.adaptive(Color(hex: 0xFDE8EF), Color(hex: 0xFF6F9D, alpha: 0.14))
    static let frHab = Color.adaptive(Color(hex: 0x0EA58C), Color(hex: 0x2FD3B4))
    static let frHabInk = Color.adaptive(Color(hex: 0x0B7866), Color(hex: 0x74E6CF))
    static let frHabSoft = Color.adaptive(Color(hex: 0xDDF4EF), Color(hex: 0x2FD3B4, alpha: 0.14))
    static let frD3 = Color.adaptive(Color(hex: 0x4B7BF5), Color(hex: 0x7EA3FF))
    static let frD3Ink = Color.adaptive(Color(hex: 0x2A57C9), Color(hex: 0xA9C1FF))
    static let frD3Soft = Color.adaptive(Color(hex: 0xE7EEFE), Color(hex: 0x7EA3FF, alpha: 0.14))
    static let frFams = Color.adaptive(Color(hex: 0xD99A00), Color(hex: 0xFFC53D))
    static let frFamsInk = Color.adaptive(Color(hex: 0x8A5A00), Color(hex: 0xFFD978))
    static let frFamsSoft = Color.adaptive(Color(hex: 0xFFF3D6), Color(hex: 0xFFC53D, alpha: 0.14))
    static let frDanger = Color.adaptive(Color(hex: 0xC8283F), Color(hex: 0xFF7A8A))
    static let frDangerSoft = Color.adaptive(Color(hex: 0xC8283F, alpha: 0.10), Color(hex: 0xFF7A8A, alpha: 0.10))
    static func trackOpacity(_ scheme: ColorScheme) -> Double { scheme == .dark ? 0.22 : 0.15 }

    // Legacy names keep the existing native screens source-compatible.
    static let bg = frBg
    static let sidebar = frCard
    static let panel = frCard
    static let panel2 = frCard2
    static let border = frRule
    static let grid = frRule
    static let text = frInk
    static let textSecond = frInk2
    static let muted = frInk2
    static let accent = frYou
    static let accentSoft = frYouSoft
    static let onAccent = frOnYou
    static let coral = frHw
    static let orange = frHw
    static let orangeInk = frHwInk
    static let warn = frFamsInk
    static let blue = frD3
    static let teal = frHab
    static let violet = frYou
    static let amber = frFams
    static let red = frDanger
    static let green = Color.adaptive(Color(hex: 0x16824F), Color(hex: 0x55D88D))

    // Categorical palette — exact hex from the Claude Design source ("Retire Odds App.dc.html").
    // Used identically in light & dark, like the design's hardcoded category / asset-class
    // swatches, so the native Expenses + Portfolio surfaces match the mockup precisely.
    static let dsIndigo = Color(hex: 0x6366F1)   // Housing · Bonds
    static let dsGreen  = Color(hex: 0x1E9E5C)   // Groceries · Stocks
    static let dsAmber  = Color(hex: 0xF59E0B)   // Dining · Utilities
    static let dsViolet = Color(hex: 0x8B5CF6)   // Fun · Subscriptions
    static let dsSky    = Color(hex: 0x0EA5E9)   // Transport · Cash
    static let dsRed    = Color(hex: 0xE5484D)   // negative change

    /// Secondary brand tone — same as `coral`, kept as an alias for clarity.
    static let secondary = coral

    /// Per-kid identity color, assigned by family kid order (kid 1 = teal, kid 2 =
    /// amber, ...), cycling through the rest of the categorical palette beyond two
    /// kids so a family of any size still gets a distinct color per child.
    static func kidColor(index: Int) -> Color {
        let cycle: [Color] = [teal, amber, blue, violet, red, orange]
        return cycle[index % cycle.count]
    }
}

// MARK: - Fonts
//
// Geist variable font, bundled as `Geist.ttf` (Geist[wght].ttf, v1.5.1).
enum Theme {
    static let fontName = "Geist-Regular"
    static func font(
        _ size: CGFloat,
        weight: Font.Weight = .regular,
        relativeTo textStyle: Font.TextStyle = .body
    ) -> Font {
        .custom(fontName, size: size, relativeTo: textStyle).weight(weight)
    }
    static func mono(
        _ size: CGFloat,
        weight: Font.Weight = .medium,
        relativeTo textStyle: Font.TextStyle = .body
    ) -> Font {
        .custom(fontName, size: size, relativeTo: textStyle).weight(weight)
    }
}

// MARK: - Typography
//
// Semantic roles routed through Geist so existing screens inherit the visual system.

enum Typography {
    static func display(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        Theme.font(size, weight: weight)
    }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        Theme.mono(size, weight: weight)
    }

    static let largeTitle = Theme.font(28, weight: .bold, relativeTo: .largeTitle)
    static let title      = Theme.font(22, weight: .bold, relativeTo: .title2)
    static let greeting = Theme.font(26, weight: .bold, relativeTo: .largeTitle)
    static let greetingRegular = Theme.font(30, weight: .bold, relativeTo: .largeTitle)
    static let heroNumeral = Theme.font(52, weight: .heavy, relativeTo: .largeTitle)
    static let heroNumeralRegular = Theme.font(64, weight: .heavy, relativeTo: .largeTitle)
    static let statNumeral = Theme.font(26, weight: .heavy, relativeTo: .title)
    static let statNumeralRegular = Theme.font(30, weight: .heavy, relativeTo: .title)
    static let kidName = Theme.font(20, weight: .bold, relativeTo: .title3)
    static let itemTitle = Theme.font(17, weight: .semibold, relativeTo: .headline)
    static let cardTitle  = Theme.font(17, weight: .semibold, relativeTo: .headline)
    static let body       = Theme.font(15, relativeTo: .body)
    static let label      = Theme.font(13, relativeTo: .footnote)
    static let caption    = Theme.font(12, relativeTo: .caption)
    static let sectionLabel = Theme.font(12, weight: .semibold, relativeTo: .caption)
    static let chip = Theme.font(12, weight: .semibold, relativeTo: .caption)
    static let kpiNumber  = Theme.font(34, weight: .heavy, relativeTo: .largeTitle)
    static let statNumber = Theme.font(20, weight: .heavy, relativeTo: .title3)
    static let monoSmall  = Theme.mono(11, weight: .medium, relativeTo: .caption)
}

// MARK: - Spacing / radius

enum Space {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 24
}

enum Radius {
    static let card: CGFloat = 20
    static let cardLarge: CGFloat = 24
    static let field: CGFloat = 12
    static let pill: CGFloat = 11
    static let chip: CGFloat = 9
}

enum Layout {
    /// Vertical space the floating tab bar occupies above the bottom safe area
    /// (62pt capsule + 12pt bottom margin + breathing room). Scroll content and
    /// bottom-anchored controls (FABs) must clear it by this much themselves —
    /// the TabView-level safeAreaInset does not propagate into the UIKit-hosted
    /// tab children.
    static let tabBarClearance: CGFloat = 88

    /// Native adaptive navigation now reserves its own safe area on every
    /// display. Extra phone-only padding would leave a gap after unfolding.
    static var bottomNavigationClearance: CGFloat {
        0
    }
}

// MARK: - Motion
//
// One spring vocabulary so every screen moves the same way. `interactive` tracks a
// finger; `snappy` is the default UI response; `gentle` is for large/ambient moves;
// `chart` draws data in. Respect Reduce Motion at call sites via `Motion.maybe`.

enum Motion {
    static let interactive = Animation.interactiveSpring(response: 0.28, dampingFraction: 0.82, blendDuration: 0.1)
    static let snappy      = Animation.spring(response: 0.34, dampingFraction: 0.86)
    static let gentle      = Animation.spring(response: 0.55, dampingFraction: 0.9)
    static let chart       = Animation.easeOut(duration: 0.6)
    /// Hero moments (success ring/gauge fill): a touch of overshoot so the value lands alive.
    static let overshoot   = Animation.spring(response: 0.6, dampingFraction: 0.72)
    static let ring = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.7)
    static let glow = Animation.easeInOut(duration: 0.3)
    static let spark = Animation.easeOut(duration: 1.2)

    /// Staggered entrance for the Nth card on a screen (60ms cascade).
    static func entrance(_ index: Int) -> Animation {
        gentle.delay(Double(index) * 0.06)
    }

    /// Returns `nil` when Reduce Motion is on, so callers can disable animation.
    static func maybe(_ animation: Animation, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : animation
    }
}

// MARK: - Haptics

enum Haptics {
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }
    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
    static func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }
}

// Shared child identity. Saved family settings take precedence over ordering.
extension Kid {
    var profileColor: Color {
        let hex = color.hasPrefix("#") ? String(color.dropFirst()) : ""
        guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return Palette.accent }
        return Color(hex: value)
    }
}

struct KidProfileAvatar: View {
    let kid: Kid
    var size: CGFloat = 28

    private static let imageCache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 40
        return cache
    }()

    private var image: UIImage? {
        guard let photo = kid.photo, photo.count <= 90000,
              photo.hasPrefix("data:image/jpeg;base64,") else { return nil }
        // Prefix/suffix fingerprint changes when a profile photo changes while
        // avoiding a full base64 hash on every SwiftUI body evaluation.
        let key = "\(kid.id):\(photo.count):\(photo.prefix(32)):\(photo.suffix(32))" as NSString
        if let cached = Self.imageCache.object(forKey: key) { return cached }
        guard let data = Data(base64Encoded: String(photo.dropFirst(23))),
              let decoded = UIImage(data: data) else { return nil }
        Self.imageCache.setObject(decoded, forKey: key)
        return decoded
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Text(String(kid.name.prefix(1)).uppercased())
                    .font(Theme.font(size * 0.4, weight: .semibold))
                    .foregroundStyle(Palette.text)
            }
        }
        .frame(width: size, height: size)
        .background(Palette.panel)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(kid.profileColor, lineWidth: 2))
        .accessibilityHidden(true)
    }
}
