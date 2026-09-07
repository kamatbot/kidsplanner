import SwiftUI

@main
struct FamETCWatchApp: App {
    @WKApplicationDelegateAdaptor(FamETCWatchExtensionDelegate.self) private var extensionDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = WatchStore.shared
    @State private var isPaired = false
    @State private var connectionError: String?
    @State private var isDisconnecting = false

    var body: some Scene {
        WindowGroup {
            Group {
                if isPaired {
                    MyNextView(onDisconnect: disconnect)
                } else {
                    WatchPairingView {
                        isPaired = true
                        WatchPushRegistrationService.shared.registerIfAuthorized()
                        Task { await store.refresh() }
                    }
                }
            }
                .environmentObject(store)
                .disabled(isDisconnecting)
                .alert("Could not disconnect", isPresented: Binding(get: { connectionError != nil }, set: { if !$0 { connectionError = nil } })) {
                    Button("OK") { connectionError = nil }
                } message: { Text(connectionError ?? "") }
                .onChange(of: store.needsConnection) { _, needsConnection in
                    if needsConnection { clearLocalConnection() }
                }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        if isPaired { WatchPushRegistrationService.shared.registerIfAuthorized() }
                        Task { await store.refreshForForeground() }
                    case .inactive, .background:
                        store.endForegroundSession()
                    @unknown default:
                        break
                    }
                }
                .onAppear {
                    WatchCompanion.shared.onParentChanged = clearLocalConnection
                    WatchCompanion.shared.activate()
                    isPaired = ((try? KeychainWatchCredentialStore().credential()) ?? nil) != nil
                    if isPaired {
                        WatchPushRegistrationService.shared.registerIfAuthorized()
                        Task { await store.refreshForForeground() }
                    }
                }
        }
    }
    private func disconnect() {
        guard !isDisconnecting else { return }
        isDisconnecting = true
        Task {
            defer { isDisconnecting = false }
            do {
                try await URLSessionWatchAPIClient().disconnectWatch()
                clearLocalConnection()
            } catch WatchAPIError.unauthenticated {
                clearLocalConnection()
            } catch {
                connectionError = "Connect to Wi-Fi or cellular to disconnect this watch securely, then try again."
            }
        }
    }

    private func clearLocalConnection() {
        do {
            try KeychainWatchCredentialStore().clear()
            store.resetLocalState()
            isPaired = false
        } catch { connectionError = "The watch could not clear its saved connection. Please try again." }
    }
}
