import Foundation

extension Array {
    /// Bounds-checked access — returns nil instead of trapping. Used by chart code
    /// that slices simulation arrays.
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
