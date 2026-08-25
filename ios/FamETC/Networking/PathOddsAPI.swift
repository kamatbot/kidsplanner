import Foundation

final class PathOddsAPI: @unchecked Sendable {
    static let shared = PathOddsAPI()

    private let base = Config.baseURL
    private let decoder = JSONDecoder()
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 15
        configuration.waitsForConnectivity = true
        configuration.httpAdditionalHeaders = Config.clientHeaders
        return URLSession(configuration: configuration)
    }()

    func today(kidId: String? = nil) async throws -> PathOddsTodayResponse {
        var components = URLComponents(url: base.appendingPathComponent("api/pathodds/today"), resolvingAgainstBaseURL: false)
        if let kidId {
            components?.queryItems = [URLQueryItem(name: "kidId", value: kidId)]
        }
        guard let url = components?.url else { throw APIError.badURL }
        return try await request(url: url)
    }

    func connect(kidId: String? = nil) async throws -> PathOddsConnectResponse {
        var body: [String: Any] = ["timeZone": TimeZone.current.identifier]
        if let kidId { body["kidId"] = kidId }
        return try await request(path: "/api/pathodds/connect", method: "POST", body: body)
    }

    func disconnect(kidId: String? = nil) async throws {
        var body: [String: Any] = [:]
        if let kidId { body["kidId"] = kidId }
        try await requestNoContent(path: "/api/pathodds/connect", method: "DELETE", body: body)
    }

    func launch(route: String) async throws -> PathOddsLaunchResponse {
        try await request(path: "/api/pathodds/launch", method: "POST", body: ["route": route])
    }

    private func request<T: Decodable>(path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: base)?.absoluteURL else { throw APIError.badURL }
        return try await request(url: url, method: method, body: body)
    }

    private func requestNoContent(path: String, method: String, body: [String: Any]? = nil) async throws {
        guard let url = URL(string: path, relativeTo: base)?.absoluteURL else { throw APIError.badURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.http(0, "Invalid server response.") }
        if http.statusCode == 401 { throw APIError.unauthenticated }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? decoder.decode(PathOddsErrorResponse.self, from: data).error) ?? "PathOdds request failed."
            throw APIError.http(http.statusCode, message)
        }
    }

    private func request<T: Decodable>(url: URL, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.http(0, "Invalid server response.") }
        if http.statusCode == 401 { throw APIError.unauthenticated }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? decoder.decode(PathOddsErrorResponse.self, from: data).error) ?? "PathOdds request failed."
            throw APIError.http(http.statusCode, message)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}
