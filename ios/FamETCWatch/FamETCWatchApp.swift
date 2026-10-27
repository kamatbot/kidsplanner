import SwiftUI

@main
struct FamETCWatchApp: App {
    @WKApplicationDelegateAdaptor(FamETCWatchExtensionDelegate.self) private var extensionDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = WatchStore.shared
    @State private var isPaired = false
    @State private var connectionError: String?
    @State private var isDisconnecting = false
    @StateObject private var alarms = WatchAlarmCenter.shared

    init() {
        // Reminder categories, Start/Done/Snooze actions and the foreground
        // alarm ride on the shared notification delegate's hooks.
        WatchAlarmNotifications.install()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if isPaired {
                    WatchChatView(onDisconnect: disconnect)
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
                .fullScreenCover(isPresented: Binding(get: { isPaired && alarms.presentation != nil },
                                                      set: { if !$0 { alarms.dismiss() } })) {
                    WatchAlarmHost().environmentObject(store)
                }
                // While the app is in front, show a reminder the moment it is due
                // (covers a missed willPresent and a reopened app after a buzz).
                .task(id: scenePhase == .active && isPaired) {
                    guard scenePhase == .active, isPaired else { return }
                    while !Task.isCancelled {
                        alarms.presentDueIfNeeded()
                        do { try await Task.sleep(for: .seconds(15)) } catch { return }
                    }
                }
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
                        Task {
                            await store.refreshForForeground()
                            // Smart alarms can only be scheduled while the app is
                            // in front; re-plan so the soonest reminder is armed.
                            if isPaired { _ = await WatchReminders.shared.refresh(snapshot: store.snapshot, focus: store.focusSession) }
                        }
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
