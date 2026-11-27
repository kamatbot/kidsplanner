import Foundation
import XCTest
@testable import FamETCWatch

private final class PlansTestCredentials: WatchCredentialStore {
    func credential() throws -> WatchCredential? { WatchCredential(value: "fam_sess=watch-test") }
}

private actor PlansRecorder {
    var requests: [URLRequest] = []
    func record(_ request: URLRequest) { requests.append(request) }
}

final class WatchPlansTests: XCTestCase {
    private func client(status: Int, body: String, recorder: PlansRecorder) -> URLSessionWatchAPIClient {
        URLSessionWatchAPIClient(
            baseURL: URL(string: "https://example.test")!,
            credentials: PlansTestCredentials(),
            clientKey: "",
            requestExecutor: { request in
                await recorder.record(request)
                let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                               headerFields: ["Content-Type": "application/json"])!
                return (Data(body.utf8), response)
            })
    }

    func testAddPlansPostsTextAndRequestIdAndDecodesItems() async throws {
        let recorder = PlansRecorder()
        let body = """
        {"requestId":"abc12345","reply":"Added 2: 📅 Soccer, tomorrow 10am · ⏰ Pack recorder, tomorrow 7:30am",
         "items":[{"type":"event","id":"e1","title":"Soccer","date":"2026-11-28","time":"10:00","label":"📅 Soccer, tomorrow 10am"},
                  {"type":"reminder","id":"a1","title":"Pack recorder","date":"2026-11-28","time":"07:30","label":"⏰ Pack recorder, tomorrow 7:30am"}],
         "undone":false,"skipped":[]}
        """
        let result = try await client(status: 200, body: body, recorder: recorder)
            .addPlans(text: "soccer and recorder", requestId: "abc12345", via: "app")

        XCTAssertEqual(result.items.count, 2)
        XCTAssertTrue(result.items[1].isReminder)
        XCTAssertFalse(result.spokenReply.contains("📅"))
        XCTAssertTrue(result.spokenReply.contains("Soccer, tomorrow 10am, Pack recorder"))
        XCTAssertTrue(result.siriReply.hasPrefix("Fam ETC added "))
        let first = await recorder.requests.first
        let request = try XCTUnwrap(first)
        XCTAssertEqual(request.url?.path, "/api/kid-plans")
        XCTAssertEqual(request.httpMethod, "POST")
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: String])
        XCTAssertEqual(sent["text"], "soccer and recorder")
        XCTAssertEqual(sent["requestId"], "abc12345")
        XCTAssertEqual(sent["via"], "app")
    }

    func testServerErrorTextIsShownWithItsStatus() async {
        let recorder = PlansRecorder()
        do {
            _ = try await client(status: 400, body: "{\"error\":\"That note is too long.\"}", recorder: recorder)
                .addPlans(text: "x", requestId: "abc12345", via: "siri")
            XCTFail("expected an error")
        } catch {
            let text = await MainActor.run { WatchPlansService.message(for: error) }
            XCTAssertEqual(text, "That note is too long. (400)")
        }
    }

    func testForbiddenSaysReconnect() async {
        let text = await MainActor.run { WatchPlansService.message(for: WatchAPIError.forbidden) }
        XCTAssertTrue(text.contains("Reconnect it to Fam ETC"))
    }
}
