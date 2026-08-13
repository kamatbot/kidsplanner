import Foundation

// App-specific notification content logic — mirrors the split between the
// server's generic `apns-sender` (payload delivery, no domain knowledge) and
// app-specific `lib/fam-notifications.js` (which builds `famType`-tagged
// payloads for chat_message / homework_reminder). `PushRegistrationService` is
// the client-side apns-sender equivalent; this file is the client-side
// fam-notifications equivalent.

extension Notification.Name {
    /// Posted when a `chat_message` push is received/tapped. `userInfo["familyId"]`
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
    /// Posted when a `trip_chat_message` or `trip_update` push is received/
    /// tapped (lib/fam-notifications.js `notifyTripChatMessage`/
    /// `notifyTripEvent`, docs/TRIPS-PLAN.md). `userInfo["tripId"]` carries the
    /// trip to deep-link into. The app opens the Chat tab and selects that
    /// exact Trip room once the room list is available.
    static let famDeepLinkToTripChat = Notification.Name("famDeepLinkToTripChat")
}

/// Reference payload shapes (lib/fam-notifications.js):
///
///   // chat_message
///   { aps: { alert: { title: senderName, body: text }, sound: "default",
///            "thread-id": "chat-<familyId>" },
///     famType: "chat_message", familyId }
///
///   // homework_reminder
///   { aps: { alert: { title: "<kidName>: Homework due soon", body: title },
///            sound: "default" },
///     famType: "homework_reminder", homeworkId, dueDate }
///
///   // trip_chat_message / trip_update (docs/TRIPS-PLAN.md) — `tripId` read
///   // as a top-level field to match the existing convention above (familyId/
///   // homeworkId), not nested under a "data" key.
///   { aps: { alert: { title: senderName, body: text }, sound: "default",
///            "thread-id": "trip-<tripId>" },
///     famType: "trip_chat_message" | "trip_update", tripId, url }
final class NotificationHandler {
    static let shared = NotificationHandler()

    private let pendingRouteLock = NSLock()
    private var pendingChatRoomId: String?

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

    private func routeToChat(roomId: String, notification: Notification.Name, userInfo: [AnyHashable: Any]) {
        pendingRouteLock.lock()
        pendingChatRoomId = roomId
        pendingRouteLock.unlock()
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
        case "chat_message":
            guard let familyId = userInfo["familyId"] as? String else { return }
            routeToChat(roomId: familyRoomId,
                        notification: .famDeepLinkToChat,
                        userInfo: ["familyId": familyId])
        case "homework_reminder":
            guard let homeworkId = userInfo["homeworkId"] as? String else { return }
            NotificationCenter.default.post(name: .famDeepLinkToHomework, object: nil, userInfo: ["homeworkId": homeworkId])
        case "kid_access_request":
            let familyId = (userInfo["familyId"] as? String) ?? ""
            NotificationCenter.default.post(name: .famDeepLinkToKidApproval, object: nil, userInfo: ["familyId": familyId])
        case "trip_chat_message", "trip_update":
            guard let tripId = userInfo["tripId"] as? String else { return }
            routeToChat(roomId: "trip:\(tripId)",
                        notification: .famDeepLinkToTripChat,
                        userInfo: ["tripId": tripId])
        default:
            break
        }
    }
}
