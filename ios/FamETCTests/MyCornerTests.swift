import XCTest
@testable import FamETC

final class MyCornerTests: XCTestCase {
    func testEditorAccountBindingRejectsBothReadAndWriteUnderAnotherSession() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CornerAccountProtocol.self]
        let service = CornerService(ownerID: "editor-owner", configuration: config)
        for value in [nil, CornerDocument.empty] as [CornerDocument?] {
            do {
                _ = try await service.request(value)
                XCTFail("An editor must not read or save a different session's corner")
            } catch APIError.http(let code, _) {
                XCTAssertEqual(code, 403)
            }
        }
    }
    func testServerShapeDecodes() throws {
        let payload = #"{"revision":3,"note":"Art club","stickers":[{"id":"one","stickerId":"tuk-tuk","x":0,"y":1,"rotation":-180}]}"#
        let value = try JSONDecoder().decode(CornerDocument.self, from: Data(payload.utf8))
        XCTAssertEqual(value.revision, 3)
        XCTAssertEqual(value.stickers[0].rotation, -180)
        XCTAssertEqual(try JSONDecoder().decode(CornerDocument.self, from: JSONEncoder().encode(value)), value)
    }
    @MainActor func testEditsAndFailureKeepDraftThenRetry() async {
        var saved = CornerDocument.empty
        var fail = true
        let model = MyCornerModel { input in
            guard var input else { return saved }
            if fail { throw APIError.http(503, "Retry") }
            input.revision += 1; saved = input; return saved
        }
        await model.load()
        model.add("tuk-tuk"); model.move(dx: -2, dy: 2, rotate: true)
        XCTAssertEqual(model.draft?.stickers.first?.x, 0)
        XCTAssertEqual(model.draft?.stickers.first?.y, 1)
        model.edit { $0.note = "My note" }
        await model.save()
        XCTAssertTrue(model.dirty); XCTAssertEqual(model.draft?.note, "My note")
        fail = false; await model.save()
        XCTAssertFalse(model.dirty); XCTAssertEqual(saved.note, "My note")
        model.remove(); XCTAssertEqual(model.draft?.stickers.count, 0)
    }
    @MainActor func testConflictRequiresExplicitReviewAndAccountClearDropsDraft() async {
        var remote = CornerDocument.empty
        let model = MyCornerModel { input in
            guard var input else { return remote }
            guard input.revision == remote.revision else { throw APIError.http(409, "Conflict") }
            input.revision += 1; remote = input; return remote
        }
        await model.load(); model.edit { $0.note = "Mine" }
        remote = CornerDocument(revision: 1, note: "Other client", stickers: [])
        await model.save()
        XCTAssertEqual(model.draft?.note, "Mine"); XCTAssertEqual(model.latest?.note, "Other client")
        await model.save(); XCTAssertEqual(remote.note, "Other client")
        model.keepDraft(); await model.save(); XCTAssertEqual(remote.note, "Mine")
        model.clear(); XCTAssertNil(model.draft); XCTAssertNil(model.latest)
    }
    @MainActor func testLateLoadCannotRestorePreviousAccount() async {
        var continuation: CheckedContinuation<CornerDocument, Error>?
        let model = MyCornerModel { _ in try await withCheckedThrowingContinuation { continuation = $0 } }
        let task = Task { await model.load() }
        await Task.yield()
        model.clear()
        continuation?.resume(returning: CornerDocument(revision: 1, note: "Previous child", stickers: []))
        await task.value
        XCTAssertNil(model.draft)
    }
}

private final class CornerAccountProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        // The server belongs to a different child. Without the editor binding,
        // it would return that child's document using the captured session.
        let bound = request.value(forHTTPHeaderField: "X-Fam-Corner-Account") == "editor-owner"
        let response = HTTPURLResponse(url: request.url!, statusCode: bound ? 403 : 200,
                                       httpVersion: nil, headerFields: nil)!
        let body = bound ? #"{"error":"The signed-in account changed."}"#
            : #"{"revision":0,"note":"Other child's private note","stickers":[]}"#
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
