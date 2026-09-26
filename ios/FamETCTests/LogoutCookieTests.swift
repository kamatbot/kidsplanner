import XCTest
import WebKit
@testable import FamETC

@MainActor
final class LogoutCookieTests: XCTestCase {
    private func cookie(_ name: String, domain: String) -> HTTPCookie {
        HTTPCookie(properties: [.name: name, .value: "synthetic-test-value", .domain: domain,
                               .path: "/", .expires: Date().addingTimeInterval(600)])!
    }

    func testFailedRevocationClearsBothCookieStoresWithoutRemovingOtherCookies() async {
        for failure in [APIError.transport(URLError(.notConnectedToInternet)), APIError.http(503, "Unavailable")] {
            let native = HTTPCookieStorage.sharedCookieStorage(forGroupContainerIdentifier: "logout-test-\(UUID())")
            let websiteData = WKWebsiteDataStore.nonPersistent()
            let web = websiteData.httpCookieStore
            let cookies = [cookie("fam_sess", domain: ".fametc.com"),
                           cookie("fam_sess.sig", domain: "www.fametc.com"),
                           cookie("fam_sess", domain: "fametc.com.evil.test"),
                           cookie("unrelated", domain: "www.fametc.com"),
                           cookie("fam_sess_extra", domain: "www.fametc.com")]
            for value in cookies { native.setCookie(value); await web.setCookie(value) }
            let seededWebCookies = await web.allCookies()
            XCTAssertEqual(seededWebCookies.count, cookies.count)
            let confirmed = await SessionSignOut.finish(baseURL: URL(string: "https://www.fametc.com")!, native: native, web: web) {
                throw failure
            }
            XCTAssertFalse(confirmed)
            let webCookies = await web.allCookies()
            for remaining in [native.cookies ?? [], webCookies] {
                XCTAssertFalse(remaining.contains { SessionSignOut.isSessionCookie($0, baseURL: URL(string: "https://www.fametc.com")!) })
                XCTAssertEqual(Set(remaining.map { "\($0.domain)|\($0.name)" }), Set(cookies.dropFirst(2).map { "\($0.domain)|\($0.name)" }))
            }
            withExtendedLifetime(websiteData) {}
            for value in native.cookies ?? [] { native.deleteCookie(value) }
        }
    }

    func testConfirmedRevocationAndConfiguredLocalFixtureScope() async {
        let native = HTTPCookieStorage.sharedCookieStorage(forGroupContainerIdentifier: "logout-test-\(UUID())")
        let websiteData = WKWebsiteDataStore.nonPersistent()
        let web = websiteData.httpCookieStore
        let value = cookie("fam_sess", domain: "127.0.0.1")
        native.setCookie(value); await web.setCookie(value)
        let confirmed = await SessionSignOut.finish(baseURL: URL(string: "http://127.0.0.1:4321")!, native: native, web: web) {}
        XCTAssertTrue(confirmed)
        XCTAssertTrue((native.cookies ?? []).isEmpty)
        let remaining = await web.allCookies()
        XCTAssertTrue(remaining.isEmpty)
        withExtendedLifetime(websiteData) {}
    }

    func testDefaultStoreCleanupAfterLastWebViewIsReleased() async {
        let base = URL(string: "https://logout-default.example.invalid")!
        let native = HTTPCookieStorage.sharedCookieStorage(forGroupContainerIdentifier: "logout-default-\(UUID())")
        let value = cookie("fam_sess", domain: "logout-default.example.invalid")
        native.setCookie(value)
        // Production signs out after unmounting its last WKWebView. Do not keep
        // a WKWebsiteDataStore owner alive in this test while finish suspends.
        var view: WKWebView? = WKWebView(frame: .zero)
        await view!.configuration.websiteDataStore.httpCookieStore.setCookie(value)
        view = nil
        let finished = expectation(description: "Default cookie cleanup finishes")
        Task { @MainActor in
            let confirmed = await SessionSignOut.finish(baseURL: base, native: native) {}
            XCTAssertTrue(confirmed)
            XCTAssertTrue((native.cookies ?? []).isEmpty)
            let dataStore = WKWebsiteDataStore.default()
            let remaining = await dataStore.httpCookieStore.allCookies()
            XCTAssertFalse(remaining.contains { SessionSignOut.isSessionCookie($0, baseURL: base) })
            withExtendedLifetime(dataStore) {}
            finished.fulfill()
        }
        await fulfillment(of: [finished], timeout: 8)
    }

    func testNativeCancellationDrainsBeforeCleanup() async {
        let configuration = URLSessionConfiguration.ephemeral
        let delegate = SessionCancellationDelegate()
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        // A suspended task is also invalidated: a retained old request cannot be
        // resumed after cleanup to write its response cookie back into the jar.
        let task = session.dataTask(with: URL(string: "https://www.fametc.com/api/me")!)
        await delegate.cancel(session)
        XCTAssertEqual(task.state, .completed)
    }
}
