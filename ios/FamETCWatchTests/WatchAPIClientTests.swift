import Foundation
import XCTest
@testable import FamETCWatch

private final class APIClientTestCredentials: WatchCredentialStore {
    func credential() throws -> WatchCredential? {
        WatchCredential(value: "fam_sess=watch-test")
    }
}

private final class StubWatchURLProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var responseData = Data("{\"actions\":[]}".utf8)
    static var responseStatus = 200

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append(request)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: Self.responseStatus,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseData)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class WatchAPIClientTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubWatchURLProtocol.requests = []
        StubWatchURLProtocol.responseStatus = 200
    }

    func testURLSessionClientInjectsCredentialAndNativeHeaders() async throws {
        StubWatchURLProtocol.responseData = Data("{\"actions\":[]}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubWatchURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = URLSessionWatchAPIClient(
            baseURL: URL(string: "https://example.test")!,
            session: session,
            credentials: APIClientTestCredentials(),
            clientKey: "secret123"
        )

        let actions = try await client.fetchActions()

        XCTAssertTrue(actions.isEmpty)
        let request = try XCTUnwrap(StubWatchURLProtocol.requests.first)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "fam_sess=watch-test")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-FamETC-Client"), "ios")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-FamETC-Client-Key"), "secret123")
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "FamETCiOS/secret123")
    }

    func testURLSessionClientMapsForbiddenToTypedError() async {
        StubWatchURLProtocol.responseStatus = 403
        StubWatchURLProtocol.responseData = Data("{\"error\":\"Parents only.\"}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubWatchURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let client = URLSessionWatchAPIClient(
            baseURL: URL(string: "https://example.test")!,
            session: session,
            credentials: APIClientTestCredentials()
        )

        do {
            _ = try await client.fetchShopping()
            XCTFail("Expected forbidden")
        } catch WatchAPIError.forbidden {
            // Expected for the parent-gated shopping surface.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
