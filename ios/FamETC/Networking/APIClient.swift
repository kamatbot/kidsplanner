import Foundation

enum APIError: Error, LocalizedError {
    case badURL
    case unauthenticated
    case http(Int, String)
    case decoding(Error)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Bad request URL."
        case .unauthenticated: return "Your session expired. Please sign in again."
        case .http(_, let msg): return msg
        case .decoding: return "Couldn't read the server response."
        case .transport(let e): return e.localizedDescription
        }
    }
}

/// Typed async client for the Fam ETC JSON API. Shares `HTTPCookieStorage.shared`
/// with `AuthService` and the WKWebView, so once the user signs in (passkey) every
/// native request carries `fam_sess` and stays in lockstep with any hybrid web tab.
final class APIClient {
    static let shared = APIClient()

    private let base = Config.baseURL
    private let decoder = JSONDecoder()
    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.httpCookieStorage = .shared
        c.httpCookieAcceptPolicy = .always
        c.httpShouldSetCookies = true
        c.timeoutIntervalForRequest = 30
        c.waitsForConnectivity = true
        // Tags every native request as the iOS app so the server keeps it free of
        // the web subscription gate (in-app purchases ship later). Carries the
        // shared-secret header when configured — see Config.clientHeaders.
        c.httpAdditionalHeaders = Config.clientHeaders
        return URLSession(configuration: c)
    }()

    // MARK: Family

    func families() async throws -> [Family] {
        let r: FamiliesResponse = try await request("/api/family")
        return r.families
    }
    func createFamily(name: String) async throws -> Family {
        let r: FamilyResponse = try await request("/api/family", method: "POST", body: ["name": name])
        return r.family
    }
    func joinFamily(code: String) async throws -> Family {
        let r: FamilyResponse = try await request("/api/family/join", method: "POST", body: ["code": code])
        return r.family
    }
    func addKid(name: String, grade: String, color: String) async throws -> FamilyKidResponse {
        try await request("/api/family/kids", method: "POST", body: ["name": name, "grade": grade, "color": color])
    }
    func updateKid(_ kidId: String, _ patch: [String: Any]) async throws -> FamilyKidResponse {
        try await request("/api/family/kids/\(kidId)", method: "PATCH", body: patch)
    }
    func deleteKid(_ kidId: String) async throws -> Family {
        let r: FamilyResponse = try await request("/api/family/kids/\(kidId)", method: "DELETE")
        return r.family
    }
    func removeMember(_ userId: String) async throws -> Family {
        let r: FamilyResponse = try await request("/api/family/members/\(userId)", method: "DELETE")
        return r.family
    }

    // MARK: Chat

    func chatMessages(since: String? = nil, limit: Int? = nil) async throws -> [ChatMessage] {
        var path = "/api/chat/messages"
        var query: [String] = []
        if let since { query.append("since=\(since)") }
        if let limit { query.append("limit=\(limit)") }
        if !query.isEmpty { path += "?" + query.joined(separator: "&") }
        let r: MessagesResponse = try await request(path)
        return r.messages
    }
    func sendChatMessage(text: String, card: [String: Any]? = nil, senderType: String, senderId: String) async throws -> ChatMessage {
        var body: [String: Any] = ["text": text, "senderType": senderType, "senderId": senderId]
        if let card { body["card"] = card }
        let r: MessageResponse = try await request("/api/chat/messages", method: "POST", body: body)
        return r.message
    }
    func deleteChatMessage(_ id: String) async throws -> ChatMessage {
        let r: MessageResponse = try await request("/api/chat/messages/\(id)", method: "DELETE")
        return r.message
    }
    func flagChatMessage(_ id: String, reason: String) async throws -> ChatMessage {
        let r: MessageResponse = try await request("/api/chat/messages/\(id)/flag", method: "POST", body: ["reason": reason])
        return r.message
    }

    // MARK: Push

    func registerPushToken(_ token: String) async throws {
        let _: OKResponse = try await request("/api/push/register", method: "POST", body: ["token": token])
    }
    func unregisterPushToken(_ token: String) async throws {
        let _: OKResponse = try await request("/api/push/unregister", method: "POST", body: ["token": token])
    }

    // MARK: Billing

    func billingStatus() async throws -> BillingStatusResponse {
        try await request("/api/billing/status")
    }
    func billingCheckout(plan: String) async throws -> BillingCheckoutResponse {
        try await request("/api/billing/checkout", method: "POST", body: ["plan": plan])
    }
    func billingPortal() async throws -> BillingPortalResponse {
        try await request("/api/billing/portal", method: "POST", body: [:])
    }

    // MARK: Misc

    func health() async throws -> HealthResponse {
        try await request("/api/health")
    }
    func me() async throws -> MeResponse {
        try await request("/api/me")
    }
    func logout() async {
        _ = try? await rawSend("/api/logout", method: "POST", body: [:])
    }

    // MARK: Analytics (fire-and-forget)

    /// Report a first-party analytics event (e.g. "app_open", "onboarding_complete").
    /// Best-effort: failures are swallowed so analytics never affects the app.
    func track(_ event: String) {
        Task { _ = try? await rawSend("/api/track", method: "POST", body: ["event": event]) }
    }

    /// Multipart upload (homework/timetable scans). Mirrors the web's FormData
    /// post with a `file` part — see POST /api/uploads.
    func uploadFile(fileURL: URL, mimeType: String = "application/octet-stream") async throws -> UploadResponse {
        guard let url = URL(string: base.absoluteString + "/api/uploads") else { throw APIError.badURL }
        let scoped = fileURL.startAccessingSecurityScopedResource()
        defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }
        let fileData = try Data(contentsOf: fileURL)

        let boundary = "fam-\(UUID().uuidString)"
        var body = Data()
        func append(_ s: String) { body.append(Data(s.utf8)) }
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileURL.lastPathComponent)\"\r\n")
        append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(fileData)
        append("\r\n--\(boundary)--\r\n")

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let (data, resp) = try await session.upload(for: req, from: body)
        guard let http = resp as? HTTPURLResponse else { throw APIError.transport(URLError(.badServerResponse)) }
        if http.statusCode == 401 { throw APIError.unauthenticated }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.http(http.statusCode, msg ?? "Upload failed (\(http.statusCode)).")
        }
        do {
            return try decoder.decode(UploadResponse.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    // MARK: Core

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        let data = try await rawSend(path, method: method, body: body)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    @discardableResult
    private func rawSend(_ path: String, method: String, body: [String: Any]?) async throws -> Data {
        guard let url = URL(string: base.absoluteString + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let data: Data, resp: URLResponse
        do {
            (data, resp) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = resp as? HTTPURLResponse else { throw APIError.transport(URLError(.badServerResponse)) }
        if http.statusCode == 401 { throw APIError.unauthenticated }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.http(http.statusCode, msg ?? "Request failed (\(http.statusCode)).")
        }
        return data
    }
}
