import SwiftUI

/// The Trips webview surface (docs/TRIPS-PLAN.md "iOS" §3): itinerary,
/// flights, lodging, invites, and the trips list live on the web at `/trips`
/// (see the plan's "Web UI" section) — only trip CHAT (a
/// `ChatScreen(roomId: "trip:<tripId>")` room, reached from the Chat tab's
/// room list) and trip CALENDAR events (merged into the existing native
/// calendar via `GET /api/calendar/events`) are native. This tab is a thin
/// `HybridWebView` host.
struct TripsScreen: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        HybridWebView(path: "/trips", isEmbedded: true)
            // `HybridWebView` sets `contentInsetAdjustmentBehavior = .always`,
            // so — the same trick `SurfaceScaffold` uses via `.contentMargins`
            // (SurfaceScaffold.swift:41) — a bottom `safeAreaInset` here becomes
            // a matching `contentInset` on the WKWebView's own scroll view,
            // keeping page content clear of the floating tab bar without
            // shrinking the visible viewport.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: Layout.tabBarClearance)
            }
            // Trip calendar rows are synthesized by the server rather than
            // persisted as editable appointments. The embedded web surface can
            // create, edit, or delete Trips without touching native AppStore
            // state, so refresh that projection whenever the user leaves Trips.
            .onDisappear {
                Task { await store.loadCalendarAndHomework() }
            }
    }
}
