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
    // "Horizon" palette (2026-07 redesign) — mapped 1:1 from public/css/horizon.css
    // light (:root) / dark (.dark) custom properties, so native mirrors the web
    // exactly. Warm greige neutrals, violet accent, coral partner. Property names
    // below are kept stable from the old KidsPlanner palette so Features/ code
    // keeps compiling untouched; only the underlying hex values changed.
    static let bg         = Color.adaptive(Color(hex: 0xF1EFEC), Color(hex: 0x211F1D))   // --bg
    static let sidebar    = Color.adaptive(Color(hex: 0xF8F6F3), Color(hex: 0x262421))   // --sidebar
    static let panel      = Color.adaptive(Color(hex: 0xFFFFFF), Color(hex: 0x2C2926))   // --panel
    static let panel2     = Color.adaptive(Color(hex: 0xFAF8F5), Color(hex: 0x33302C))   // --panel-2
    static let border     = Color.adaptive(Color(hex: 0xE7E3DD), Color(hex: 0x3B3733))   // --border
    static let text       = Color.adaptive(Color(hex: 0x211E1B), Color(hex: 0xF1EFEC))   // --text
    static let textSecond = Color.adaptive(Color(hex: 0x6A655F), Color(hex: 0xA29C93))   // --text-2
    static let muted      = Color.adaptive(Color(hex: 0x6F6A63), Color(hex: 0x968F86))   // --muted
    static let accent     = Color.adaptive(Color(hex: 0x6F43D6), Color(hex: 0xB98CFF))   // --accent
    static let accentSoft = Color.adaptive(Color(hex: 0x6F43D6, alpha: 0.11), Color(hex: 0xB98CFF, alpha: 0.15)) // --accent-soft
    static let coral      = Color.adaptive(Color(hex: 0xF0704F), Color(hex: 0xFF8A66))   // --coral
    static let warn       = Color.adaptive(Color(hex: 0x8A6410), Color(hex: 0xD6A24A))   // --warn
    static let grid       = Color.adaptive(Color(hex: 0xEDEAE5), Color(hex: 0x35322E))   // --grid

    // Categorical palette (--c-*)
    static let blue   = Color.adaptive(Color(hex: 0x2563EB), Color(hex: 0x60A5FA))       // --c-blue
    static let violet = Color.adaptive(Color(hex: 0x7C3AED), Color(hex: 0xA78BFA))       // --c-violet
    static let amber  = Color.adaptive(Color(hex: 0xF59E0B), Color(hex: 0xFBBF24))       // --c-amber
    static let green  = Color.adaptive(Color(hex: 0x16A34A), Color(hex: 0x4ADE80))       // --c-green
    static let red    = Color.adaptive(Color(hex: 0xDC2626), Color(hex: 0xF87171))       // --c-red
    static let teal   = Color.adaptive(Color(hex: 0x0D9488), Color(hex: 0x2DD4BF))       // --c-teal
    static let orange = Color.adaptive(Color(hex: 0xEA580C), Color(hex: 0xFB923C))       // --c-orange
    static let orangeInk = Color.adaptive(Color(hex: 0xB8420C), Color(hex: 0xFF8A4D))    // --c-orange-ink

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

    /// Text/icon color on top of a solid `accent` fill. Adaptive: white on the
    /// darker light-mode violet, dark ink (#1c1526) on the lighter dark-mode
    /// lavender — a flat white would fail contrast in dark mode.
    static let onAccent = Color.adaptive(Color(hex: 0xFFFFFF), Color(hex: 0x1C1526))

    /// Per-kid identity color, assigned by family kid order (kid 1 = teal, kid 2 =
    /// amber, ...), cycling through the rest of the categorical palette beyond two
    /// kids so a family of any size still gets a distinct color per child.
    static func kidColor(index: Int) -> Color {
        let cycle: [Color] = [teal, amber, blue, violet, red, orange]
        return cycle[index % cycle.count]
    }
}

// MARK: - Signal gradient
//
// The Horizon coral→violet hero gradient — reserved for ONE momentum element per
// screen (e.g. a headline card or primary "run" CTA). Everything else uses flat
// palette colors so the gradient keeps its meaning.

enum Signal {
    static let start = Palette.coral    // Horizon coral
    static let end   = Palette.accent   // Horizon violet

    static func gradient(_ startPoint: UnitPoint = .leading, _ endPoint: UnitPoint = .trailing) -> LinearGradient {
        LinearGradient(colors: [start, end], startPoint: startPoint, endPoint: endPoint)
    }

    /// Angular variant for rings/gauges so the hue travels along the arc.
    static func angular(center: UnitPoint = .center) -> AngularGradient {
        AngularGradient(colors: [start, end], center: center,
                        startAngle: .degrees(-90), endAngle: .degrees(270))
    }
}

// MARK: - Fonts
//
// Horizon brand fonts, bundled as variable TTFs (UIAppFonts in Info.plist):
// Space Grotesk for UI text, JetBrains Mono for numerals/micro-labels. SwiftUI's
// `.weight()` modifier walks a bundled variable font's `wght` axis, so one file
// per family covers every weight — no per-weight font files needed.
enum Theme {
    static func font(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("SpaceGrotesk-Light", size: size).weight(weight)
    }
    static func mono(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .custom("JetBrainsMono-Regular", size: size).weight(weight)
    }
}

// MARK: - Typography
//
// Semantic roles, routed through `Theme.font`/`Theme.mono` (Space Grotesk +
// JetBrains Mono) so every shared component and screen that already reaches for
// `Typography.*` picks up the brand fonts automatically.

enum Typography {
    static func display(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        Theme.font(size, weight: weight)
    }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font {
        Theme.mono(size, weight: weight)
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
