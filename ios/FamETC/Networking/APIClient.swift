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

    // MARK: Kid access requests (parent approval)

    func kidAccessRequests() async throws -> [KidAccessRequest] {
        let r: KidAccessRequestsResponse = try await request("/api/family/access-requests")
        return r.requests
    }
    func approveKidAccess(_ id: String) async throws -> Family {
        let r: FamilyKidResponse = try await request("/api/family/access-requests/\(id)/approve", method: "POST", body: [:])
        return r.family
    }
    func denyKidAccess(_ id: String) async throws {
        let _: OKResponse = try await request("/api/family/access-requests/\(id)/deny", method: "POST", body: [:])
    }

    // MARK: Calendar + Homework (Today / Calendar tabs)

    /// Sync + fetch school-feed events. The server throttles the actual remote
    /// fetch, so calling this on load is cheap; pass force from a manual refresh.
    func calendarEvents(force: Bool = false) async throws -> [CalendarEvent] {
        let r: CalendarSyncResponse = try await request("/api/calendar/sync", method: "POST", body: ["force": force])
        return r.events ?? []
    }
    func familyEvents(from: String? = nil, to: String? = nil) async throws -> [FamilyEvent] {
        var path = "/api/calendar/events"
        var q: [String] = []
        if let from { q.append("from=\(from)") }
        if let to { q.append("to=\(to)") }
        if !q.isEmpty { path += "?" + q.joined(separator: "&") }
        let r: FamilyEventsResponse = try await request(path)
        return r.events
    }
    func addFamilyEvent(title: String, date: String, time: String?, notes: String?, category: String?, kidId: String?) async throws -> FamilyEvent {
        var body: [String: Any] = ["title": title, "date": date]
        if let time, !time.isEmpty { body["time"] = time }
        if let notes, !notes.isEmpty { body["notes"] = notes }
        if let category { body["category"] = category }
        if let kidId { body["kidId"] = kidId }
        let r: FamilyEventResponse = try await request("/api/calendar/events", method: "POST", body: body)
        return r.event
    }
    func homework(kidId: String? = nil) async throws -> [HomeworkItem] {
        var path = "/api/homework"
        if let kidId { path += "?kidId=" + kidId }
        let r: HomeworkResponse = try await request(path)
        return r.homework
    }
    func setHomeworkStatus(_ id: String, status: String) async throws -> HomeworkItem {
        let r: HomeworkItemResponse = try await request("/api/homework/\(id)", method: "PATCH", body: ["status": status])
        return r.homework
    }
    /// Reschedule homework to a new due date (parent-only server-side; a kid's
    /// dueDate patch is ignored by the server).
    func setHomeworkDueDate(_ id: String, dueDate: String) async throws -> HomeworkItem {
        let r: HomeworkItemResponse = try await request("/api/homework/\(id)", method: "PATCH", body: ["dueDate": dueDate])
        return r.homework
    }

    // MARK: Notes

    func notes(authorId: String? = nil, from: String? = nil, to: String? = nil) async throws -> [Note] {
        var path = "/api/notes"
        var q: [String] = []
        if let authorId { q.append("authorId=\(authorId)") }
        if let from { q.append("from=\(from)") }
        if let to { q.append("to=\(to)") }
        if !q.isEmpty { path += "?" + q.joined(separator: "&") }
        let r: NotesResponse = try await request(path)
        return r.notes
    }
    func addNote(body: String, date: String? = nil, source: String = "manual", ref: [String: Any]? = nil) async throws -> Note {
        var payload: [String: Any] = ["body": body, "source": source]
        if let date { payload["date"] = date }
        if let ref { payload["ref"] = ref }
        let r: NoteResponse = try await request("/api/notes", method: "POST", body: payload)
        return r.note
    }
    func updateNote(_ id: String, body: String) async throws -> Note {
        let r: NoteResponse = try await request("/api/notes/\(id)", method: "PATCH", body: ["body": body])
        return r.note
    }
    func deleteNote(_ id: String) async throws {
        let _: OKResponse = try await request("/api/notes/\(id)", method: "DELETE")
    }

    // MARK: Word bank

    func wordBank(kidId: String? = nil) async throws -> WordBankResponse {
        var path = "/api/wordbank"
        if let kidId { path += "?kidId=" + kidId }
        return try await request(path)
    }
    func wordInteract(word: String, correct: Bool) async throws -> WordBankEntry {
        let r: WordEntryResponse = try await request("/api/wordbank/interact", method: "POST", body: ["word": word, "correct": correct])
        return r.entry
    }
    func wordPlacement(known: [String]) async throws {
        let _: OKResponse = try await request("/api/wordbank/placement", method: "POST", body: ["known": known])
    }
    func wordQuiz(n: Int = 5) async throws -> WordQuizResponse {
        try await request("/api/wordbank/quiz?n=\(n)")
    }

    // MARK: Brain teaser

    func brainTeaserToday() async throws -> BrainTeaserTodayResponse {
        try await request("/api/brainteaser/today")
    }
    func brainTeaserAnswer(qid: String, correct: Bool) async throws {
        let _: OKResponse = try await request("/api/brainteaser/answer", method: "POST", body: ["qid": qid, "correct": correct])
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
    func sendChatMessage(text: String, card: [String: Any]? = nil, media: [String: Any]? = nil, senderType: String, senderId: String) async throws -> ChatMessage {
        var body: [String: Any] = ["text": text, "senderType": senderType, "senderId": senderId]
        if let card { body["card"] = card }
        if let media { body["media"] = media }
        let r: MessageResponse = try await request("/api/chat/messages", method: "POST", body: body)
        return r.message
    }
    func trendingGifs(limit: Int = 24) async throws -> [GifResult] {
        let r: GifsResponse = try await request("/api/gifs/trending?limit=\(limit)")
        return r.gifs
    }
    func searchGifs(_ query: String, limit: Int = 24) async throws -> [GifResult] {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let r: GifsResponse = try await request("/api/gifs/search?q=\(q)&limit=\(limit)")
        return r.gifs
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
