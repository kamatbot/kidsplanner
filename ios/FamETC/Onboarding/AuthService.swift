import AuthenticationServices
import UIKit
import WebKit

enum AuthError: Error {
    case unsupported, options, registration, verify(String), cancelled
    var isCancellation: Bool { if case .cancelled = self { return true }; return false }
}

// Native passkey sign-up that interoperates with the server's WebAuthn endpoints
// (POST /api/webauthn/signup/options → /verify). The session cookie (fam_sess)
// carries the challenge between the two calls and then becomes the auth session,
// so we run both over one cookie jar and sync that cookie into the WKWebView's
// store — leaving the user logged in when the shell loads the dashboard.
final class AuthService: NSObject {
    static let shared = AuthService()

    // RP ID must match the server (parentDomain → apex) and the app's
    // webcredentials:fametc.com associated domain.
    private let rpID = "fametc.com"
    private var apiBase: String { Config.baseURL.absoluteString } // https://www.fametc.com

    // One cookie jar shared across options→verify so fam_sess persists.
    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.httpCookieStorage = .shared
        c.httpCookieAcceptPolicy = .always
        c.httpShouldSetCookies = true
        // Identify the iOS app so signup grandfathers the account (free, in-app
        // purchases ship later) and the subscription gate never blocks it. Carries
        // the shared-secret header when configured — see Config.clientHeaders.
        c.httpAdditionalHeaders = Config.clientHeaders
        return URLSession(configuration: c)
    }()

    private var authContinuation: CheckedContinuation<ASAuthorization, Error>?

    /// Create a passwordless account with a passkey and establish a web session.
    /// Recovery codes are NOT minted here — they're issued + shown later, once the
    /// account is worth protecting (after onboarding), via `issueBackupCodesIfNeeded`.
    func signUpWithPasskey() async throws {
        // 1) registration options
        let options = try await postJSON("/api/webauthn/signup/options", body: [:])
        guard
            let challengeB64 = options["challenge"] as? String,
            let challenge = Data(base64URLEncoded: challengeB64),
            let user = options["user"] as? [String: Any],
            let userIdB64 = user["id"] as? String,
            let userID = Data(base64URLEncoded: userIdB64)
        else { throw AuthError.options }
        let userName = (user["name"] as? String) ?? "Fam ETC parent"

        // 2) platform passkey registration (Face ID / Touch ID)
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request = provider.createCredentialRegistrationRequest(challenge: challenge, name: userName, userID: userID)
        let auth = try await perform(request)
        guard let reg = auth.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let attestation = reg.rawAttestationObject else { throw AuthError.registration }

        // 3) verify → server creates the user and signs in (sets fam_sess.uid)
        let body: [String: Any] = [
            "id": reg.credentialID.base64URLEncodedString(),
            "rawId": reg.credentialID.base64URLEncodedString(),
            "type": "public-key",
            "response": [
                "clientDataJSON": reg.rawClientDataJSON.base64URLEncodedString(),
                "attestationObject": attestation.base64URLEncodedString(),
            ],
            "clientExtensionResults": [String: Any](),
        ]
        _ = try await postJSON("/api/webauthn/signup/verify", body: body)

        // 4) hand the session cookie to the WebView so the shell is authenticated
        await syncCookiesToWebView()
    }

    /// Lazily mint the recovery codes the first time the account is worth
    /// protecting (called when onboarding finishes). Returns the one-time plaintext
    /// codes if they were just generated, or nil if they already existed / on
    /// failure — the caller simply skips the codes screen in that case.
    func issueBackupCodesIfNeeded() async -> [String]? {
        guard let json = try? await postJSON("/api/auth/backup/issue", body: [:]) else { return nil }
        guard (json["issued"] as? Bool) == true, let codes = json["backupCodes"] as? [String], !codes.isEmpty else { return nil }
        return codes
    }

    /// Issue a fresh set of recovery codes for the signed-in member, invalidating
    /// all prior codes. Authenticated via the shared fam_sess cookie. Returns the
    /// new 10 plaintext codes (shown once); empty array on an older server.
    func regenerateBackupCodes() async throws -> [String] {
        let json = try await postJSON("/api/auth/backup/regenerate", body: [:])
        return (json["backupCodes"] as? [String]) ?? []
    }

    /// How many recovery codes are still unused, read from /api/me's publicProfile.
    /// Best-effort: returns nil if not signed in, offline, or on an older server —
    /// callers should just hide the count rather than surface an error.
    func backupCodesRemaining() async -> Int? {
        guard let url = URL(string: apiBase + "/api/me") else { return nil }
        var req = URLRequest(url: url)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        guard
            let (data, resp) = try? await session.data(for: req),
            let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode),
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let user = json["user"] as? [String: Any],
            let n = user["backupCodesRemaining"] as? Int
        else { return nil }
        return n
    }

    /// Recovery sign-in for a member who has lost their passkey: redeem one of the
    /// single-use backup codes minted at sign-up. On success the fam_sess session
    /// cookie is established and synced to the WebView, exactly like a passkey
    /// sign-in. Throws `AuthError.verify` with the server's generic message when
    /// the code doesn't match.
    func signInWithBackupCode(_ code: String) async throws {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        _ = try await postJSON("/api/auth/backup/verify", body: ["code": trimmed])
        await syncCookiesToWebView()
    }

    /// Sign in an existing member with a discoverable passkey (no username — iOS
    /// shows the passkeys it holds for fametc.com), then establish the session.
    func signInWithPasskey() async throws {
        // 1) authentication options (challenge)
        let options = try await postJSON("/api/webauthn/auth/options", body: [:])
        guard
            let challengeB64 = options["challenge"] as? String,
            let challenge = Data(base64URLEncoded: challengeB64)
        else { throw AuthError.options }

        // 2) platform passkey assertion
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        let auth = try await perform(request)
        guard let assertion = auth.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw AuthError.registration
        }

        // 3) verify → server matches the credential and signs in
        var response: [String: Any] = [
            "clientDataJSON": assertion.rawClientDataJSON.base64URLEncodedString(),
            "authenticatorData": assertion.rawAuthenticatorData.base64URLEncodedString(),
            "signature": assertion.signature.base64URLEncodedString(),
        ]
        if let userHandle = assertion.userID { response["userHandle"] = userHandle.base64URLEncodedString() }
        let body: [String: Any] = [
            "id": assertion.credentialID.base64URLEncodedString(),
            "rawId": assertion.credentialID.base64URLEncodedString(),
            "type": "public-key",
            "response": response,
            "clientExtensionResults": [String: Any](),
        ]
        _ = try await postJSON("/api/webauthn/auth/verify", body: body)

        // 4) hand the session cookie to the WebView
        await syncCookiesToWebView()
    }

    // MARK: - Family onboarding (authenticated after sign-up)
    // Fam ETC has no financial onboarding — a brand-new parent either creates a
    // family or joins one via invite code, then optionally adds kid profiles.
    // These call the same /api/family* routes server.js exposes to the web app.

    /// Create a new family (this parent becomes its first/only parent member).
    @discardableResult
    func createFamily(name: String) async throws -> [String: Any] {
        let json = try await postJSON("/api/family", body: ["name": name])
        return (json["family"] as? [String: Any]) ?? [:]
    }

    /// Join an existing family as the second parent, via its invite code.
    @discardableResult
    func joinFamily(code: String) async throws -> [String: Any] {
        let json = try await postJSON("/api/family/join", body: ["code": code])
        return (json["family"] as? [String: Any]) ?? [:]
    }

    /// Add a kid profile to the signed-in parent's family. Minimal fields only —
    /// name, grade, color — no email, no login, per APP-BRIEF.md.
    @discardableResult
    func addKid(name: String, grade: String, color: String?) async throws -> [String: Any] {
        var body: [String: Any] = ["name": name, "grade": grade]
        if let color { body["color"] = color }
        let json = try await postJSON("/api/family/kids", body: body)
        return (json["family"] as? [String: Any]) ?? [:]
    }

    // MARK: - HTTP

    private func postJSON(_ path: String, method: String = "POST", body: [String: Any]) async throws -> [String: Any] {
        guard let url = URL(string: apiBase + path) else { throw AuthError.options }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await session.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw AuthError.verify((json["error"] as? String) ?? "Request failed")
        }
        return json
    }

    // MARK: - ASAuthorization bridge

    private func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { cont in
            self.authContinuation = cont
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    @MainActor
    private func syncCookiesToWebView() async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        // Exact-host match (not substring — `contains` would also match
        // fametc.com.evil.com) and only the session cookie pair
        // (fam_sess + fam_sess.sig), so we never over-share other cookies.
        let allowedDomains: Set<String> = ["fametc.com", "www.fametc.com", ".fametc.com"]
        let cookies = (HTTPCookieStorage.shared.cookies ?? [])
            .filter { allowedDomains.contains($0.domain) && $0.name.hasPrefix("fam_sess") }
        for cookie in cookies {
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                store.setCookie(cookie) { cont.resume() }
            }
        }
    }
}

extension AuthService: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    func authorizationController(controller: ASAuthorizationController,
                                didCompleteWithAuthorization authorization: ASAuthorization) {
        authContinuation?.resume(returning: authorization)
        authContinuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if let asError = error as? ASAuthorizationError, asError.code == .canceled {
            authContinuation?.resume(throwing: AuthError.cancelled)
        } else {
            authContinuation?.resume(throwing: error)
        }
        authContinuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        return window ?? ASPresentationAnchor()
    }
}

// base64url <-> Data (WebAuthn uses base64url, no padding).
extension Data {
    init?(base64URLEncoded s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
