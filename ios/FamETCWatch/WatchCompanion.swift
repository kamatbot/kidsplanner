import Foundation
import WatchConnectivity

/// Optional convenience for a parent's own paired watch. Child code setup and
/// all normal reads/writes remain direct HTTPS, even with the iPhone switched off.
@MainActor
final class WatchCompanion: NSObject, WCSessionDelegate {
    static let shared = WatchCompanion()
    var onParentChanged: (() -> Void)?

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func connect() async throws -> WatchCredential {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else {
            throw WatchAPIError.transport("Open Fam ETC on your paired iPhone, then try again. You can also use a FamETC code.")
        }
        let reply: [String: Any] = try await withCheckedThrowingContinuation { continuation in
            session.sendMessage(["famWatchRequest": "parentConnect"], replyHandler: { continuation.resume(returning: $0) }, errorHandler: { continuation.resume(throwing: $0) })
        }
        if let error = reply["error"] as? String { throw WatchAPIError.transport(error) }
        guard let code = reply["code"] as? String, let expectedUser = reply["parentUserID"] as? String else {
            throw WatchAPIError.decoding("Missing connection response")
        }
        let credential = try await URLSessionWatchAPIClient().claimPairing(code: code, deviceLabel: "Parent's paired watch")
        guard credential.role == "parent", credential.userId == expectedUser else {
            throw WatchAPIError.forbidden
        }
        if let currentUser = session.receivedApplicationContext["famParentUserID"] as? String, currentUser != expectedUser {
            throw WatchAPIError.transport("The iPhone account changed. Please reconnect.")
        }
        return credential
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.checkParent(session.receivedApplicationContext) }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.checkParent(applicationContext) }
    }
    private func checkParent(_ context: [String: Any]) {
        guard let expected = context["famParentUserID"] as? String,
              let credential = try? KeychainWatchCredentialStore().credential(),
              credential.role == "parent", let owner = credential.userId, owner != expected else { return }
        let api = URLSessionWatchAPIClient(credentials: CapturedWatchCredential(value: credential))
        onParentChanged?()
        Task { try? await api.disconnectWatch() }
    }
}

private struct CapturedWatchCredential: WatchCredentialStore {
    let value: WatchCredential
    func credential() throws -> WatchCredential? { value }
}
