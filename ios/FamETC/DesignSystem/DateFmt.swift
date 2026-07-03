import Foundation

/// Shared, pre-built date formatters. `DateFormatter` is expensive to allocate, so
/// creating one per call (e.g. per list row) is a real scrolling cost — these are
/// built once. Formatting/parsing on a `DateFormatter` is thread-safe as long as it
/// isn't reconfigured, which these never are.
enum DateFmt {
    static let ym = make("yyyy-MM")          // 2026-06
    static let ymd = make("yyyy-MM-dd")      // 2026-06-21
    static let monthYear = make("MMMM yyyy") // June 2026
    static let month = make("MMMM")          // June
    static let monthDay = make("MMM d")      // Jun 21

    private static func make(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.dateFormat = pattern
        return f
    }
}
