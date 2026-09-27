import SwiftUI

// How the parent Screen Time controls are presented (docs/SCREEN-TIME-UX.md §3).
// Decided by the presenting view's horizontal size class, never by device idiom:
// regular width (iPad full screen / ⅔) → full-screen cover with the kid sidebar;
// compact (iPhone, narrow iPad Split View) → a large sheet.
// Used by every presenter of `ScreenTimeParentSheet`: RootView (banner Review, push),
// ScreenTimeSummaryCard and ScreenTimePromoCard.

extension View {
    /// Presents the parent Screen Time controls for `item`: `.fullScreenCover` at regular
    /// width, `.sheet` with the large detent at compact width. Both presenters are attached
    /// and each is bound to `item` only while its style is active. The style is latched when
    /// the controls open, so a transient size-class flip (iPad app-switcher snapshots,
    /// Split View resizing) never tears the controls down mid-edit; the next open re-decides.
    func screenTimeControlsCover<Item: Identifiable, Controls: View>(
        item: Binding<Item?>,
        @ViewBuilder content: @escaping (Item) -> Controls
    ) -> some View {
        modifier(ScreenTimeControlsCover(item: item, controls: content))
    }
}

struct ScreenTimeControlsCover<Item: Identifiable, Controls: View>: ViewModifier {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Binding var item: Item?
    let controls: (Item) -> Controls
    /// The style chosen when the controls opened (nil while closed).
    @State private var latchedCover: Bool? = nil

    private var useCover: Bool { latchedCover ?? (sizeClass == .regular) }

    func body(content: Content) -> some View {
        content
            .fullScreenCover(item: binding(active: useCover)) { controls($0) }
            .sheet(item: binding(active: !useCover)) { presented in
                controls(presented).presentationDetents([.large])
            }
            .onChange(of: item == nil) { _, closed in
                latchedCover = closed ? nil : (sizeClass == .regular)
            }
    }

    /// `item` while this presenter's style is active, else always nil (and writes ignored).
    private func binding(active: Bool) -> Binding<Item?> {
        Binding(
            get: { active ? item : nil },
            set: { newValue in if active { item = newValue } }
        )
    }
}
