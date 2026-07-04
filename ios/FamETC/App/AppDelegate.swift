import UIKit
import UserNotifications

/// Minimal UIKit shim required for remote-notification registration callbacks,
/// which SwiftUI's `App` protocol doesn't expose directly. Delegates immediately
/// to the generic/app-specific push split (`PushRegistrationService` /
/// `NotificationHandler`) — this file owns no push logic of its own.
///
/// The registration trigger lives in `RootView` (and `ReauthOverlay`): once the
/// store confirms an authenticated session, it calls
/// `PushRegistrationService.shared.requestAuthorizationAndRegister()`, so the
/// device token is only requested/uploaded when there's a session to attach it to.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                      didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushRegistrationService.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushRegistrationService.shared.didFailToRegister(error: error)
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                 didReceive response: UNNotificationResponse,
                                 withCompletionHandler completionHandler: @escaping () -> Void) {
        NotificationHandler.shared.handle(userInfo: response.notification.request.content.userInfo)
        completionHandler()
    }

    /// Show banners even while the app is foregrounded.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                 willPresent notification: UNNotification,
                                 withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .badge, .sound])
    }
}
