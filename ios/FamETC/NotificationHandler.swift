import Foundation

// App-specific notification content logic — mirrors the split between the
// server's generic `apns-sender` (payload delivery, no domain knowledge) and
// app-specific `lib/fam-notifications.js` (which builds `famType`-tagged
// payloads for chat_message / homework_reminder). `PushRegistrationService` is
// the client-side apns-sender equivalent; this file is the client-side
// fam-notifications equivalent.

extension Notification.Name {
    /// Posted when a `chat_message` or `chat_buzz` push is received/tapped. `userInfo["familyId"]`
    /// carries the family to deep-link into.
    static let famDeepLinkToChat = Notification.Name("famDeepLinkToChat")
    /// Posted when a `homework_reminder` push is received/tapped.
    /// `userInfo["homeworkId"]` carries the homework item to deep-link into.
    static let famDeepLinkToHomework = Notification.Name("famDeepLinkToHomework")
    /// Posted when a `kid_access_request` push is received/tapped — a kid asked to
    /// sign in on a device and a parent needs to approve. `userInfo["familyId"]`
    /// carries the family. (Approval UI is currently a web surface; the push at
    /// least brings the parent into the app.)
    static let famDeepLinkToKidApproval = Notification.Name("famDeepLinkToKidApproval")
    /// Posted when a `trip_chat_message`, `trip_chat_buzz`, or `trip_update` push is received/
    /// tapped (lib/fam-notifications.js `notifyTripChatMessage`/
    /// `notifyTripEvent`, docs/TRIPS-PLAN.md). `userInfo["tripId"]` carries the
    /// trip to deep-link into. The app opens the Chat tab and selects that
    /// exact Trip room once the room list is available.
    static let famDeepLinkToTripChat = Notification.Name("famDeepLinkToTripChat")
    /// Posted when a `meal_prep` push is received/tapped. There is no
    /// Planning→Meals deep-link mechanism yet (unlike chat rooms/homework),
    /// so this just brings the user to Today, same as a cold launch.
    static let famDeepLinkToToday = Notification.Name("famDeepLinkToToday")
    /// Posted when a `screen_time_alert` push is received/tapped (a kid's
    /// device turned Screen Time off, stopped checking in, etc. —
    /// docs/SCREEN-TIME-PLAN.md), or when the in-app alert banner's Review is
    /// tapped. `userInfo["kidId"]` carries the child whose Screen Time sheet opens.
    static let famDeepLinkToScreenTime = Notification.Name("famDeepLinkToScreenTime")
}

/// Reference payload shapes (lib/fam-notifications.js):
///
///   // chat_message / chat_buzz
///   { aps: { alert: { title: senderName, body: text }, sound: "default",
///            "thread-id": "chat-<familyId>" },
///     famType: "chat_message" | "chat_buzz", familyId, messageId? }
///
///   // homework_reminder
///   { aps: { alert: { title: "<kidName>: Homework due soon", body: title },
///            sound: "default" },
///     famType: "homework_reminder", homeworkId, dueDate }
///
///   // trip_chat_message / trip_chat_buzz / trip_update (docs/TRIPS-PLAN.md) — `tripId` read
///   // as a top-level field to match the existing convention above (familyId/
///   // homeworkId), not nested under a "data" key.
///   { aps: { alert: { title: senderName, body: text }, sound: "default",
///            "thread-id": "trip-<tripId>" },
///     famType: "trip_chat_message" | "trip_chat_buzz" | "trip_update", tripId, url }
///
///   // screen_time_alert (docs/SCREEN-TIME-PLAN.md "Pushes") — parents only
///   { aps: { alert: { title, body }, sound: "default",
///            "thread-id": "screen-time-<familyId>" },
///     famType: "screen_time_alert", familyId, kidId }
///
///   // screen_time_request (parents: a kid asked for more time) — same route as an alert
///   { aps: { alert: { title, body } }, famType: "screen_time_request", familyId, kidId }
///
///   // screen_time_request_result (the kid: approved / declined)
///   { aps: { alert: { title, body } }, famType: "screen_time_request_result", kidId }
final class NotificationHandler {
    static let shared = NotificationHandler()

    private let pendingRouteLock = NSLock()
    private var pendingChatRoomId: String?
    private var pendingScreenTimeKidId: String?

    private init() {}

    /// Notification responses can arrive before SwiftUI has installed
    /// RootView's observers (notably on a cold launch). Keep the latest chat
    /// destination until the app shell consumes it.
    func consumePendingChatRoomId() -> String? {
        pendingRouteLock.lock()
        defer { pendingRouteLock.unlock() }
        let roomId = pendingChatRoomId
        pendingChatRoomId = nil
        return roomId
    }

    /// Same cold-launch concern as chat: keep the kid until RootView consumes it.
    func consumePendingScreenTimeKidId() -> String? {
        pendingRouteLock.lock()
        defer { pendingRouteLock.unlock() }
        let kidId = pendingScreenTimeKidId
        pendingScreenTimeKidId = nil
        return kidId
    }

    private func routeToChat(roomId: String, notification: Notification.Name, userInfo: [AnyHashable: Any]) {
        pendingRouteLock.lock()
        pendingChatRoomId = roomId
        pendingRouteLock.unlock()

        // Start the network request NOW, while RootView/ChatScreen are still
        // switching tabs. ChatScreen consumes this task on appearance, so a
        // notification tap does not spend its first visible frame waiting for
        // the normal chat polling loop to wake up.
        Task { await ChatNotificationPrefetcher.shared.start(roomId: roomId) }

        DispatchQueue.main.async {
            NotificationCenter.default.post(name: notification, object: nil, userInfo: userInfo)
        }
    }

    /// Dispatches a push payload's `userInfo` to the right deep link, based on
    /// the app-specific `famType` tag. No coordinator pattern — just
    /// NotificationCenter signaling; screens observe the names above and
    /// navigate themselves.
    func handle(userInfo: [AnyHashable: Any]) {
        guard let famType = userInfo["famType"] as? String else { return }
        switch famType {
        case "chat_message", "chat_buzz":
            guard let familyId = userInfo["familyId"] as? String else { return }
            var routeInfo: [AnyHashable: Any] = ["familyId": familyId]
            if let messageId = userInfo["messageId"] as? String { routeInfo["messageId"] = messageId }
            routeToChat(roomId: familyRoomId,
                        notification: .famDeepLinkToChat,
                        userInfo: routeInfo)
        case "homework_reminder":
            guard let homeworkId = userInfo["homeworkId"] as? String else { return }
            NotificationCenter.default.post(name: .famDeepLinkToHomework, object: nil, userInfo: ["homeworkId": homeworkId])
        case "kid_access_request":
            let familyId = (userInfo["familyId"] as? String) ?? ""
            NotificationCenter.default.post(name: .famDeepLinkToKidApproval, object: nil, userInfo: ["familyId": familyId])
        case "trip_chat_message", "trip_chat_buzz", "trip_update":
            guard let tripId = userInfo["tripId"] as? String else { return }
            var routeInfo: [AnyHashable: Any] = ["tripId": tripId]
            if let messageId = userInfo["messageId"] as? String { routeInfo["messageId"] = messageId }
            routeToChat(roomId: "trip:\(tripId)",
                        notification: .famDeepLinkToTripChat,
                        userInfo: routeInfo)
        case "hermes_thread":
            // docs/HERMES-THREADS-CONTRACT.md §4: routes exactly like a family
            // chat push, just into the private "hermes" room — `routeToChat`
            // stashes the room id before posting, so reusing the family chat
            // notification name still lands on the Hermes room, not Family.
            guard let familyId = userInfo["familyId"] as? String else { return }
            var routeInfo: [AnyHashable: Any] = ["familyId": familyId]
            if let messageId = userInfo["messageId"] as? String { routeInfo["messageId"] = messageId }
            routeToChat(roomId: "hermes",
                        notification: .famDeepLinkToChat,
                        userInfo: routeInfo)
        case "meal_prep":
            // No Planning→Meals push route exists yet (see famDeepLinkToToday) —
            // open Today, same as everywhere else that lacks a deep link today.
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .famDeepLinkToToday, object: nil, userInfo: [:])
            }
        case "screen_time_request_result":
            // Sync now so an approved bonus is enforced without waiting for the silent ping.
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .famDeepLinkToToday, object: nil, userInfo: [:])
                Task { @MainActor in await ScreenTimeService.shared.sync(source: "push") }
            }
        case "screen_time_alert", "screen_time_request":
            guard let kidId = userInfo["kidId"] as? String else { return }
            pendingRouteLock.lock()
            pendingScreenTimeKidId = kidId
            pendingRouteLock.unlock()
            let familyId = (userInfo["familyId"] as? String) ?? ""
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .famDeepLinkToScreenTime, object: nil,
                                                userInfo: ["kidId": kidId, "familyId": familyId])
            }
        default:
            break
        }
    }
}