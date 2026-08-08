import Foundation

protocol WatchAPIClient {
    func fetchActions() async throws -> [WatchAction]
    func fetchHomework() async throws -> [WatchHomework]
    func fetchShopping() async throws -> [WatchShoppingItem]

    func updateActionStatus(_ id: String, status: String) async throws -> WatchAction
    func updateHomeworkStatus(_ id: String, status: String) async throws -> WatchHomework
    func updateShoppingDone(_ id: String, done: Bool) async throws -> WatchShoppingItem
}

enum WatchAPIError: Error, LocalizedError {
    case badURL
    case disconnected
    case unauthenticated
    case forbidden
    case http(Int, String)
    case timedOut
    case transport(String)
    case decoding(String)
    case credential(String)

    var errorDescription: String? {
        switch self {
        case .badURL:
            return "Fam ETC could not build the watch request."
        case .disconnected:
            return "Connect the watch to Fam ETC to refresh."
        case .unauthenticated:
            return "The saved Fam ETC session has expired."
        case .forbidden:
            return "This watch action is not available for this account."
        case .http(_, let message):
            return message
        case .timedOut:
            return "Fam ETC took too long to respond."
        case .transport(let message):
            return message
        case .decoding:
            return "Fam ETC returned data the watch could not read."
        case .credential:
            return "The saved watch credential could not be read."
        }
    }
}

/// URLSession-backed, dependency-injectable client for the watch's narrow API
/// surface. Authentication is deliberately supplied by a credential store;
/// this type never starts a login, pairs devices, polls, or uses
/// WatchConnectivity.
final class URLSessionWatchAPIClient: WatchAPIClient {
    private struct ActionsResponse: Decodable { let actions: [WatchAction] }
    private struct HomeworkResponse: Decodable { let homework: [WatchHomework] }
    private struct ShoppingResponse: Decodable { let shopping: [WatchShoppingItem] }
    private struct ActionResponse: Decodable { let action: WatchAction }
    private struct HomeworkItemResponse: Decodable { let homework: WatchHomework }
    private struct ShoppingItemResponse: Decodable { let item: WatchShoppingItem }

    private let baseURL: URL
    private let session: URLSession
    private let credentials: WatchCredentialStore
    private let clientKey: String
    private let decoder: JSONDecoder

    init(baseURL: URL = WatchConfiguration.baseURL,
         session: URLSession? = nil,
         credentials: WatchCredentialStore = KeychainWatchCredentialStore(),
         clientKey: String = WatchConfiguration.clientKey,
         decoder: JSONDecoder = JSONDecoder()) {
        self.baseURL = baseURL
        self.session = session ?? Self.makeSession()
        self.credentials = credentials
        self.clientKey = clientKey
        self.decoder = decoder
    }

    func fetchActions() async throws -> [WatchAction] {
        try await request("/api/family/actions", response: ActionsResponse.self).actions
    }

    func fetchHomework() async throws -> [WatchHomework] {
        try await request("/api/homework", response: HomeworkResponse.self).homework
    }

    func fetchShopping() async throws -> [WatchShoppingItem] {
        try await request("/api/meals/shopping", response: ShoppingResponse.self).shopping
    }

    func updateActionStatus(_ id: String, status: String) async throws -> WatchAction {
        let response: ActionResponse = try await request(
            "/api/family/actions/\(pathComponent(id))",
            method: "PATCH",
            body: ["status": status],
            response: ActionResponse.self
        )
        return response.action
    }

    func updateHomeworkStatus(_ id: String, status: String) async throws -> WatchHomework {
        let response: HomeworkItemResponse = try await request(
            "/api/homework/\(pathComponent(id))",
            method: "PATCH",
            body: ["status": status],
            response: HomeworkItemResponse.self
        )
        return response.homework
    }

    func updateShoppingDone(_ id: String, done: Bool) async throws -> WatchShoppingItem {
        let response: ShoppingItemResponse = try await request(
            "/api/meals/shopping/\(pathComponent(id))",
            method: "PATCH",
            body: ["done": done],
            response: ShoppingItemResponse.self
        )
        return response.item
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 10
        return URLSession(configuration: configuration)
    }

    private func request<Response: Decodable>(_ path: String,
                                               method: String = "GET",
                                               body: [String: Any]? = nil,
                                               response: Response.Type) async throws -> Response {
        let data = try await send(path, method: method, body: body)
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw WatchAPIError.decoding(error.localizedDescription)
        }
    }

    private func send(_ path: String,
                      method: String,
                      body: [String: Any]?) async throws -> Data {
        guard let url = URL(string: baseURL.absoluteString + path) else {
            throw WatchAPIError.badURL
        }

        let credential: WatchCredential?
        do {
            credential = try credentials.credential()
        } catch {
            throw WatchAPIError.credential(error.localizedDescription)
        }
        guard let credential, !credential.value.isEmpty else {
            throw WatchAPIError.disconnected
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // The server's native-client gate intentionally accepts the existing
        // iOS signal for the watch companion as well. The credential remains
        // the actual session authority.
        request.setValue("ios", forHTTPHeaderField: "X-FamETC-Client")
        request.setValue(clientKey.isEmpty ? "FamETCiOS" : "FamETCiOS/\(clientKey)",
                         forHTTPHeaderField: "User-Agent")
        if !clientKey.isEmpty {
            request.setValue(clientKey, forHTTPHeaderField: "X-FamETC-Client-Key")
        }

        switch credential.kind {
        case .cookieHeader:
            request.setValue(credential.value, forHTTPHeaderField: "Cookie")
        case .bearerToken:
            request.setValue("Bearer \(credential.value)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
            } catch {
                throw WatchAPIError.badURL
            }
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .timedOut {
            throw WatchAPIError.timedOut
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw WatchAPIError.transport(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw WatchAPIError.transport("Fam ETC returned an invalid response.")
        }
        if http.statusCode == 401 { throw WatchAPIError.unauthenticated }
        if http.statusCode == 403 { throw WatchAPIError.forbidden }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                ?? "Fam ETC request failed (\(http.statusCode))."
            throw WatchAPIError.http(http.statusCode, message)
        }
        return data
    }

    private func pathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }
}
