import Foundation
import WatchConnectivity
import UIKit

/// Apple-paired transport only provisions a narrowly scoped parent watch code.
/// Never copies web cookies, child credentials, or family data to a paired peer.
@MainActor
final class ParentWatchCompanion: NSObject, WCSessionDelegate {
    static let shared = ParentWatchCompanion()
    private var connecting = false
    private var identityResolved = false
    private var parentID: String?

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func updateIdentity(_ user: User?) {
        identityResolved = true
        parentID = user?.role == "kid" ? nil : user?.id
        publishIdentity()
    }

    private func publishIdentity() {
        let session = WCSession.default
        guard identityResolved, session.activationState == .activated, session.isPaired else { return }
        try? session.updateApplicationContext(["famParentUserID": parentID ?? ""])
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.publishIdentity() }
    }
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard message["famWatchRequest"] as? String == "parentConnect" else {
            replyHandler(["error": "Unknown watch request."]); return
        }
        Task { @MainActor in
            guard UIApplication.shared.applicationState == .active, !self.connecting else {
                replyHandler(["error": "Open Fam ETC on your iPhone, then try again."]); return
            }
            self.connecting = true
            defer { self.connecting = false }
            do {
                guard let user = try await APIClient.shared.me().user, user.role != "kid" else {
                    replyHandler(["error": "Sign in as a parent on your iPhone."]); return
                }
                self.updateIdentity(user)
                var request = URLRequest(url: Config.baseURL.appendingPathComponent("api/watch/pairing/start"))
                request.httpMethod = "POST"
                request.timeoutInterval = 15
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                for (key, value) in Config.clientHeaders { request.setValue(value, forHTTPHeaderField: key) }
                request.httpBody = try JSONSerialization.data(withJSONObject: ["target": "self"])
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let pairing = object["pairing"] as? [String: Any], let code = pairing["code"] as? String else {
                    replyHandler(["error": "Open your family in Fam ETC on iPhone, then retry."]); return
                }
                guard let current = try await APIClient.shared.me().user, current.id == user.id, current.role != "kid" else {
                    replyHandler(["error": "The iPhone account changed. Please reconnect."]); return
                }
                replyHandler(["code": code, "parentUserID": user.id])
            } catch {
                replyHandler(["error": "Could not connect. Check your iPhone connection and retry."])
            }
        }
    }
}
