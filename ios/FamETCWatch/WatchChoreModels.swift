import Foundation

/// A Fams chore from `GET /api/fams` (kid watch tokens only; parents get 403).
/// Chores carry no due time: a `pending` chore stays open until the child
/// submits it, and a parent's approval pays the Fams.
struct WatchChore: Codable, Equatable, Identifiable {
    let id: String
    var title: String
    var amount: Int
    /// pending | submitted | approved
    var status: String
    var createdAt: String?
    var submittedAt: String?
    var approvedAt: String?

    init(id: String,
         title: String,
         amount: Int,
         status: String = "pending",
         createdAt: String? = nil,
         submittedAt: String? = nil,
         approvedAt: String? = nil) {
        self.id = id
        self.title = title
        self.amount = amount
        self.status = status
        self.createdAt = createdAt
        self.submittedAt = submittedAt
        self.approvedAt = approvedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        // The server stores whole Fams, but JSON numbers from JavaScript may
        // arrive as 5.0; never fail a whole list over the number's spelling.
        if let whole = try? container.decodeIfPresent(Int.self, forKey: .amount) {
            amount = whole
        } else if let fractional = try? container.decodeIfPresent(Double.self, forKey: .amount) {
            amount = Int(fractional.rounded())
        } else {
            amount = 0
        }
        status = try container.decodeIfPresent(String.self, forKey: .status) ?? "pending"
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        submittedAt = try container.decodeIfPresent(String.self, forKey: .submittedAt)
        approvedAt = try container.decodeIfPresent(String.self, forKey: .approvedAt)
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, amount, status, createdAt, submittedAt, approvedAt
    }

    /// Only pending chores can be submitted.
    var isOpen: Bool { status == "pending" }
}

/// The `GET /api/fams` envelope; only the chores matter to the watch.
struct WatchChoreFamsResponse: Decodable {
    let chores: [WatchChore]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        chores = try container.decodeIfPresent([WatchChore].self, forKey: .chores) ?? []
    }

    private enum CodingKeys: String, CodingKey { case chores }
}

struct WatchChoreSubmitResponse: Decodable {
    let chore: WatchChore
}

/// Kid-only Fams chores. Parent tokens receive 403 on both routes.
protocol WatchChoreClient {
    func fetchChores() async throws -> [WatchChore]
    func submitChore(_ id: String) async throws -> WatchChore
}

// ponytail: URLSessionWatchAPIClient keeps its request builder private, so the
// chore calls use this small mirror of it with the default watch credential
// and configuration. Once `request(_:method:body:response:)` is made internal
// these two methods should call it instead.
extension URLSessionWatchAPIClient: WatchChoreClient {
    func fetchChores() async throws -> [WatchChore] {
        try await WatchChoreHTTP().send("/api/fams", method: "GET", response: WatchChoreFamsResponse.self).chores
    }

    func submitChore(_ id: String) async throws -> WatchChore {
        let component = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? id
        return try await WatchChoreHTTP().send("/api/fams/chores/\(component)/submit", method: "POST",
                                               response: WatchChoreSubmitResponse.self).chore
    }
}

struct WatchChoreHTTP {
    var baseURL: URL = WatchConfiguration.baseURL
    var credentials: WatchCredentialStore = KeychainWatchCredentialStore()
    var clientKey: String = WatchConfiguration.clientKey
    var session: URLSession = WatchChoreHTTP.defaultSession

    static let defaultSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 10
        return URLSession(configuration: configuration)
    }()

    func makeRequest(_ path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: baseURL.absoluteString + path) else { throw WatchAPIError.badURL }
        let credential: WatchCredential?
        do { credential = try credentials.credential() } catch { throw WatchAPIError.credential(error.localizedDescription) }
        guard let credential, !credential.value.isEmpty else { throw WatchAPIError.disconnected }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("ios", forHTTPHeaderField: "X-FamETC-Client")
        request.setValue(clientKey.isEmpty ? "FamETCiOS" : "FamETCiOS/\(clientKey)", forHTTPHeaderField: "User-Agent")
        if !clientKey.isEmpty { request.setValue(clientKey, forHTTPHeaderField: "X-FamETC-Client-Key") }
        switch credential.kind {
        case .cookieHeader: request.setValue(credential.value, forHTTPHeaderField: "Cookie")
        case .bearerToken: request.setValue("Bearer \(credential.value)", forHTTPHeaderField: "Authorization")
        }
        if method != "GET" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("{}".utf8)
        }
        return request
    }

    func send<Response: Decodable>(_ path: String, method: String, response: Response.Type) async throws -> Response {
        let request = try makeRequest(path, method: method)
        let data: Data
        let urlResponse: URLResponse
        do {
            (data, urlResponse) = try await session.data(for: request)
        } catch let error as URLError where error.code == .timedOut {
            throw WatchAPIError.timedOut
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw WatchAPIError.transport(error.localizedDescription)
        }
        guard let http = urlResponse as? HTTPURLResponse else {
            throw WatchAPIError.transport("Fam ETC returned an invalid response.")
        }
        if http.statusCode == 401 { throw WatchAPIError.unauthenticated }
        if http.statusCode == 403 { throw WatchAPIError.forbidden }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                ?? "Fam ETC request failed (\(http.statusCode))."
            throw WatchAPIError.http(http.statusCode, message)
        }
        do { return try JSONDecoder().decode(Response.self, from: data) }
        catch { throw WatchAPIError.decoding(error.localizedDescription) }
    }
}
