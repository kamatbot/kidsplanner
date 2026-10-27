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

    func registerIfAuthorized() {
        guard hasCredential() else { return }
        center.getNotificationSettings { [weak self] settings in
            guard [.authorized, .provisional].contains(settings.authorizationStatus) else { return }
            self?.registerWithAPNs()
        }
    }

    func requestAuthorizationAndRegister() {
        guard hasCredential() else { return }
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            switch settings.authorizationStatus {
            case .authorized, .provisional:
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
    func didReceiveRemoteNotification(_ userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (WKBackgroundFetchResult) -> Void) {
        Task { @MainActor in
            await WatchStore.shared.refresh(replayMutations: false)
            completionHandler(WatchStore.shared.connection == .connected ? .newData : .failed)
        }
    }

    func applicationDidEnterBackground() {
        scheduleRefresh()
    }

    private func scheduleRefresh() {
        WKApplication.shared().scheduleBackgroundRefresh(withPreferredDate: Date().addingTimeInterval(30 * 60), userInfo: nil) { _ in }
    }

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            guard task is WKApplicationRefreshBackgroundTask else {
                task.setTaskCompletedWithSnapshot(false)
                continue
            }
            Task { @MainActor in
                await WatchStore.shared.refresh(replayMutations: false)
                scheduleRefresh()
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }

    func applicationDidFinishLaunching() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // Chat alerts (category set by the server) offer 👍 🏃 ❤️, Talk (opens
        // straight into recording) and an inline reply with dictation. Merge
        // rather than replace, so other categories (reminders) survive.
        let chat = WatchChatNotificationActions.category()
        let extra = Self.additionalCategories()
        center.getNotificationCategories { existing in
            let replaced = Set([chat.identifier] + extra.map(\.identifier))
            center.setNotificationCategories(existing.filter { !replaced.contains($0.identifier) }.union([chat]).union(extra))
        }
    }

    static let chatReplyAction = WatchChatNotificationActions.reply

    /// Hook for other notification owners (reminders): categories to register
    /// alongside FAM_CHAT, and a response handler tried before the chat one.
    /// Return true when the response was handled.
    static var additionalCategories: () -> Set<UNNotificationCategory> = { [] }
    static var additionalResponseHandler: (@MainActor (UNNotificationResponse) async -> Bool)?
    /// Foreground presentation hook (reminders show the full-screen alarm).
    /// Return nil to fall back to the default banner.
    static var additionalPresentationHandler: (@MainActor (UNNotification) -> UNNotificationPresentationOptions?)?

    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        WatchPushRegistrationService.shared.didRegister(deviceToken: deviceToken)
    }

    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        WatchPushRegistrationService.shared.didFailToRegister(error: error)
    }
}

extension FamETCWatchExtensionDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let reply = (response as? UNTextInputNotificationResponse)?.userText
        let companion = WatchCompanionRoute.isCompanion(response.notification.request.content.userInfo)
        let isChat = response.notification.request.content.categoryIdentifier == WatchChatNotificationActions.categoryID
        let quickReply = isChat ? WatchChatNotificationActions.quickReply(for: response.actionIdentifier) : nil
        let talk = isChat && response.actionIdentifier == WatchChatNotificationActions.talk
        Task { @MainActor in
            if let handler = Self.additionalResponseHandler, await handler(response) {
                completionHandler()
                return
            }
            // A private helper alert must never write an inline reply to the
            // family room, even if an old payload carries the FAM_CHAT category.
            if !companion, let reply { await WatchStore.shared.sendChat(reply) }
            if !companion, let quickReply { await WatchStore.shared.sendChat(quickReply) }
            if !companion, talk { WatchChatRoute.shared.talkRequested = true }
            await WatchStore.shared.refresh()
            if companion, WatchStore.shared.snapshot.context?.profile.role == "kid" {
                WatchCompanionRoute.shared.requested = true
            }
            completionHandler()
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        Task { @MainActor in
            completionHandler(Self.additionalPresentationHandler?(notification) ?? [.banner, .sound, .badge])
        }
    }
}

/// FAM_CHAT notification actions (BRIEF screen 5).
enum WatchChatNotificationActions {
    static let categoryID = "FAM_CHAT"
    static let reply = "FAM_CHAT_REPLY"
    static let talk = "FAM_CHAT_TALK"
    /// Action identifier → the reply it sends, in display order.
    static let quickReplies: [(id: String, text: String)] = [
        ("FAM_CHAT_THUMBS", "👍"),
        ("FAM_CHAT_ON_MY_WAY", "🏃"),
        ("FAM_CHAT_HEART", "❤️"),
    ]

    static func quickReply(for actionIdentifier: String) -> String? {
        quickReplies.first { $0.id == actionIdentifier }?.text
    }

    static func category() -> UNNotificationCategory {
        // Emoji replies send in the background; Talk opens the app into recording.
        let emoji = quickReplies.map { UNNotificationAction(identifier: $0.id, title: $0.text, options: []) }
        let talkAction = UNNotificationAction(identifier: talk, title: "🎤 Talk", options: [.foreground])
        let replyAction = UNTextInputNotificationAction(identifier: reply, title: "Reply", options: [],
                                                        textInputButtonTitle: "Send", textInputPlaceholder: "Reply")
        return UNNotificationCategory(identifier: categoryID, actions: emoji + [talkAction, replyAction],
                                      intentIdentifiers: [], options: [])
    }
}
