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
        // BGTaskScheduler requires handlers to be registered before launch completes.
        ScreenTimeService.registerBackgroundTask()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushRegistrationService.shared.didRegister(deviceToken: deviceToken)
        // Screen Time heartbeats (incl. the monitor extension) report this token via the App Group.
        ScreenTimeEnforcer.shared.pushToken = deviceToken.map { String(format: "%02x", $0) }.joined()
    }

    /// Silent Screen Time pings from the server (`content-available`). Other
    /// payloads keep their existing handling via UNUserNotificationCenterDelegate.
    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        let famType = userInfo["famType"] as? String
        guard famType == "screen_time_sync" || famType == "screen_time_ping" else {
            completionHandler(.noData)
            return
        }
        Task { @MainActor in
            let service = ScreenTimeService.shared
            await service.sync(source: "push")
            completionHandler(service.isEnrolled && service.lastError == nil ? .newData : .noData)
        }
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
