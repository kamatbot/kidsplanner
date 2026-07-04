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
final class NotificationHandler {
    static let shared = NotificationHandler()

    private init() {}

    /// Dispatches a push payload's `userInfo` to the right deep link, based on
    /// the app-specific `famType` tag. No coordinator pattern — just
    /// NotificationCenter signaling; screens observe the names above and
    /// navigate themselves.
    func handle(userInfo: [AnyHashable: Any]) {
        guard let famType = userInfo["famType"] as? String else { return }
        switch famType {
        case "chat_message":
            guard let familyId = userInfo["familyId"] as? String else { return }
            NotificationCenter.default.post(name: .famDeepLinkToChat, object: nil, userInfo: ["familyId": familyId])
        case "homework_reminder":
            guard let homeworkId = userInfo["homeworkId"] as? String else { return }
            NotificationCenter.default.post(name: .famDeepLinkToHomework, object: nil, userInfo: ["homeworkId": homeworkId])
        case "kid_access_request":
            let familyId = (userInfo["familyId"] as? String) ?? ""
            NotificationCenter.default.post(name: .famDeepLinkToKidApproval, object: nil, userInfo: ["familyId": familyId])
        default:
            break
        }
    }
}
