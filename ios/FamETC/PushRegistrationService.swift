import Foundation
import UIKit
import UserNotifications

/// Generic push-registration client — mirrors the server's apns-sender philosophy
/// of "zero app-specific logic": this file only knows how to ask for notification
/// permission and hand APNs device tokens to the server. It has no idea what a
/// "chat_message" or "homework_reminder" payload looks like — see
/// `NotificationHandler` for the app-specific half of the split.
final class PushRegistrationService {
    static let shared = PushRegistrationService()

    private init() {}

    static let tokenKey = "fam_apns_token"

    /// Detaches this device from the signed-in account. Must run while the
    /// session cookie is still valid (i.e. before `APIClient.logout()`), so the
    /// next account on a shared device does not inherit the previous user's
    /// pushes. Best-effort: bounded by `timeout` so sign-out never hangs. The
    /// token is kept locally; the next sign-in re-registers it via
    /// `requestAuthorizationAndRegister()`.
    func unregisterStoredToken(timeout: Duration = .seconds(3)) async {
        guard let token = UserDefaults.standard.string(forKey: Self.tokenKey), !token.isEmpty else { return }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { try? await APIClient.shared.unregisterPushToken(token) }
            group.addTask { try? await Task.sleep(for: timeout) }
            await group.next()
            group.cancelAll()
        }
    }

    /// Requests notification authorization and, if granted, registers for remote
    /// notifications. Call this after sign-in (see FamETCApp / RootView TODO).
    func requestAuthorizationAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Called from `AppDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    /// Hex-encodes the APNs token and POSTs it to /api/push/register, using the
    /// same cookie-jar/session pattern as AuthService (the shared `fam_sess`
    /// cookie rides along automatically via `HTTPCookieStorage.shared`).
    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(hex, forKey: Self.tokenKey)
        Task {
            do {
                try await APIClient.shared.registerPushToken(hex)
            } catch {
                print("[push] failed to register device token: \(error.localizedDescription)")
            }
        }
    }

    /// Called from `AppDelegate.application(_:didFailToRegisterForRemoteNotificationsWithError:)`.
    func didFailToRegister(error: Error) {
        print("[push] registration failed: \(error.localizedDescription)")
    }
}
