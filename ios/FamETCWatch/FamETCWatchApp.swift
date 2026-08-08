import SwiftUI

@main
struct FamETCWatchApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = WatchStore()

    var body: some Scene {
        WindowGroup {
            MyNextView()
                .environmentObject(store)
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        Task { await store.refreshForForeground() }
                    case .inactive, .background:
                        store.endForegroundSession()
                    @unknown default:
                        break
                    }
                }
        }
    }
}
