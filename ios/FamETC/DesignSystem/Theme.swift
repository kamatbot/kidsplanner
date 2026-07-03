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
    // Fam ETC palette: primary #6C63FF (dark #5A52D5), secondary #FF6B9D, accent
    // #4ECDC4, bg #F0EEFF (light). The coral→violet signal gradient from RetireOdds
    // is replaced by a purple→pink hero gradient (see `Signal` below), reserved for
    // ONE hero element per screen; violet/primary alone is the interactive accent;
    // green/red stay semantic (good news / danger).
    // TODO: confirm dark palette during design pass
    static let bg         = Color.adaptive(Color(hex: 0xF0EEFF), Color(hex: 0x1A1830))
    static let panel      = Color.adaptive(Color(hex: 0xFFFFFF), Color(hex: 0x242140))
    static let border     = Color.adaptive(Color(hex: 0xE1DDFB), Color(hex: 0x342F57))
    static let text       = Color.adaptive(Color(hex: 0x211E1B), Color(hex: 0xF1EFEC))
    static let textSecond = Color.adaptive(Color(hex: 0x75706A), Color(hex: 0xA29C93))
    static let accent     = Color.adaptive(Color(hex: 0x6C63FF), Color(hex: 0x5A52D5))
    static let accentSoft = Color.adaptive(Color(hex: 0x6C63FF, alpha: 0.11), Color(hex: 0x5A52D5, alpha: 0.15))
    static let coral      = Color.adaptive(Color(hex: 0xFF6B9D), Color(hex: 0xFF6B9D))
    static let warn       = Color.adaptive(Color(hex: 0xB07F2E), Color(hex: 0xD6A24A))
    static let grid       = Color.adaptive(Color(hex: 0xEDEAE5), Color(hex: 0x35322E))

    // Chart series
    static let blue   = Color.adaptive(Color(hex: 0x2563EB), Color(hex: 0x60A5FA))
    static let violet = Color.adaptive(Color(hex: 0x7C3AED), Color(hex: 0xA78BFA))
    static let amber  = Color.adaptive(Color(hex: 0xF59E0B), Color(hex: 0xFBBF24))
    static let green  = Color.adaptive(Color(hex: 0x16A34A), Color(hex: 0x4ADE80))
    static let red    = Color.adaptive(Color(hex: 0xDC2626), Color(hex: 0xF87171))
    static let orange = Color.adaptive(Color(hex: 0xEA580C), Color(hex: 0xFB923C))

    // Categorical palette — exact hex from the Claude Design source ("Retire Odds App.dc.html").
    // Used identically in light & dark, like the design's hardcoded category / asset-class
    // swatches, so the native Expenses + Portfolio surfaces match the mockup precisely.
    static let dsIndigo = Color(hex: 0x6366F1)   // Housing · Bonds
    static let dsGreen  = Color(hex: 0x1E9E5C)   // Groceries · Stocks
    static let dsAmber  = Color(hex: 0xF59E0B)   // Dining · Utilities
    static let dsViolet = Color(hex: 0x8B5CF6)   // Fun · Subscriptions
    static let dsSky    = Color(hex: 0x0EA5E9)   // Transport · Cash
    static let dsRed    = Color(hex: 0xE5484D)   // negative change

    /// Secondary brand tone (#FF6B9D) — same as `coral`, kept as an alias for clarity.
    static let secondary = coral
    /// Tertiary accent (#4ECDC4) — teal, for small highlights distinct from `accent`.
    static let teal = Color.adaptive(Color(hex: 0x4ECDC4), Color(hex: 0x4ECDC4))

    /// White on a colored fill, regardless of theme (e.g. text on the accent).
    static let onAccent = Color.white
}

// MARK: - Signal gradient
//
// The purple→pink "Fam ETC" hero gradient — reserved for ONE hero element per
// screen (e.g. a headline card or primary "run" CTA). Everything else uses flat
// palette colors so the gradient keeps its meaning.

enum Signal {
    static let start = Palette.accent   // #6C63FF
    static let end   = Palette.coral    // #FF6B9D

    static func gradient(_ startPoint: UnitPoint = .leading, _ endPoint: UnitPoint = .trailing) -> LinearGradient {
        LinearGradient(colors: [start, end], startPoint: startPoint, endPoint: endPoint)
    }

    /// Angular variant for rings/gauges so the hue travels along the arc.
    static func angular(center: UnitPoint = .center) -> AngularGradient {
        AngularGradient(colors: [start, end], center: center,
                        startAngle: .degrees(-90), endAngle: .degrees(270))
    }
}

// MARK: - Typography
//
// Semantic roles. The brand uses Space Grotesk (display) + JetBrains Mono (numbers);
// until those font files are bundled (Info.plist `UIAppFonts`), we use SF Pro and
// SF Mono so nothing falls back unpredictably. Swap the two helpers below to adopt
// the brand fonts app-wide.

enum Typography {
    static func display(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    static let largeTitle = display(28, .bold)
    static let title      = display(22, .bold)
    static let cardTitle  = display(16, .semibold)
    static let body       = display(15)
    static let label      = display(12.5)
    static let caption    = display(11.5)
    static let kpiNumber   = mono(34, .bold)
    static let statNumber  = mono(20, .bold)
    static let monoSmall   = mono(11, .medium)
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
    static let card: CGFloat = 18
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
