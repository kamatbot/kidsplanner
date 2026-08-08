import Foundation
import UserNotifications
import WatchKit

/// Registers the watch's APNs token only after pairing has placed a bearer
/// credential in Keychain. The token is never stored in the watch UI or sent
/// to the server without that scoped credential.
final class WatchPushRegistrationService {
    static let shared = WatchPushRegistrationService()

    private let defaults: UserDefaults
    private let center: UNUserNotificationCenter
    private let apiFactory: () -> WatchPushAPIClient
    private let credentialStore: WatchCredentialStore

    init(defaults: UserDefaults = .standard,
         center: UNUserNotificationCenter = .current(),
         apiFactory: @escaping () -> WatchPushAPIClient = { URLSessionWatchAPIClient() },
         credentialStore: WatchCredentialStore = KeychainWatchCredentialStore()) {
        self.defaults = defaults
        self.center = center
        self.apiFactory = apiFactory
        self.credentialStore = credentialStore
    }

    func requestAuthorizationAndRegister() {
        guard hasCredential() else { return }
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                self.registerWithAPNs()
            case .notDetermined:
                self.center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                    guard granted else { return }
                    self.registerWithAPNs()
                }
            case .denied:
                break
            @unknown default:
                break
            }
        }
    }

    func didRegister(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        guard !token.isEmpty, hasCredential() else { return }
        Task {
            do {
                try await apiFactory().registerWatchPushToken(token)
                defaults.set(token, forKey: Self.registeredTokenKey)
            } catch {
                // Registration is retried on the next foreground activation;
                // the watch remains fully usable from its durable cache/outbox.
            }
        }
    }

    func didFailToRegister(error: Error) {
        // APNs can be unavailable in a simulator or during a transient network
        // outage. Keep the failure non-fatal; the next activation retries.
        _ = error
    }

    private func registerWithAPNs() {
        WKExtension.shared().registerForRemoteNotifications()
    }

    private func hasCredential() -> Bool {
        do {
            guard let credential = try credentialStore.credential() else { return false }
            return !credential.value.isEmpty
        } catch {
            return false
        }
    }

    private static let registeredTokenKey = "fametc.watch.apnsToken"
}

final class FamETCWatchExtensionDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
    }

    func application(_ application: WKExtension,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        WatchPushRegistrationService.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: WKExtension,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        WatchPushRegistrationService.shared.didFailToRegister(error: error)
    }
}

extension FamETCWatchExtensionDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }
}
