import Foundation

/// Number formatting that mirrors the web app exactly so native and web read the
/// same. `compactUSD` == web `fmtUSD` (dollars in), `millions` == web `fmtM`
/// (millions in — the units the simulator's p10/p50/p90 arrays use).
enum Format {
    private static let grouped: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        return f
    }()

    /// Compact dollars: ≥ $1M → "$1.23M", else "$45k". Mirrors web `fmtUSD`.
    static func compactUSD(_ dollars: Double) -> String {
        abs(dollars) >= 1_000_000
            ? "$" + String(format: "%.2f", dollars / 1_000_000) + "M"
            : "$" + (grouped.string(from: NSNumber(value: (dollars / 1000).rounded())) ?? "0") + "k"
    }

    /// Compact from a value already in millions: ≥ 1 → "$1.23M", else "$450k".
    /// Mirrors web `fmtM` — use for simulator projection values.
    static func millions(_ m: Double) -> String {
        m >= 1
            ? "$" + String(format: "%.2f", m) + "M"
            : "$" + String(Int((m * 1000).rounded())) + "k"
    }

    /// Exact grouped dollars, e.g. "$1,234". For expense amounts and account values.
    static func usd(_ dollars: Double, symbol: String = "$") -> String {
        symbol + (grouped.string(from: NSNumber(value: dollars.rounded())) ?? "0")
    }

    /// 0…1 → "82%". Mirrors the success-rate display.
    static func percent(_ fraction: Double, fractionDigits: Int = 0) -> String {
        String(format: "%.\(fractionDigits)f%%", (fraction * 100))
    }

    /// Currency symbol for a 3-letter code (covers the app's common currencies).
    static func symbol(for code: String) -> String {
        switch code.uppercased() {
        case "USD": return "$"
        case "EUR": return "€"
        case "GBP": return "£"
        case "THB": return "฿"
        case "JPY", "CNY": return "¥"
        case "INR": return "₹"
        default: return code.uppercased() + " "
        }
    }
}
