import SwiftUI

@main
struct FamETCWatchApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = WatchStore()
    @State private var isPaired = false

    var body: some Scene {
        WindowGroup {
            Group {
                if isPaired {
                    MyNextView()
                } else {
                    WatchPairingView {
                        isPaired = true
                    }
                }
            }
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
                .onAppear {
                    isPaired = ((try? KeychainWatchCredentialStore().credential()) ?? nil) != nil
                }
        }
    }
}
