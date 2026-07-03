import Foundation

/// Central configuration for the native shell.
///
/// The app is a thin wrapper around the live site: it loads `baseURL` in a
/// WKWebView so every web/feature update ships to users instantly, with no App
/// Store release. Native code only owns the bridge contract (camera scanner
/// today, on-device Monte Carlo later), so it rarely needs to change.
enum Config {
    /// The production origin the WebView loads. Matches the server's
    /// `CANONICAL_HOST` (server.js). Override via the `FAM_BASE_URL` env var when
    /// running against a local/staging server in the Simulator.
    static var baseURL: URL {
        if let override = ProcessInfo.processInfo.environment["FAM_BASE_URL"],
           let url = URL(string: override), isAcceptableOverride(url) {
            return url
        }
        return URL(string: "https://www.fametc.com")!
    }

    /// An override may only be HTTPS (it carries the session cookie + PII). Plain
    /// HTTP is allowed solely to localhost, and only in DEBUG, for local-server work.
    private static func isAcceptableOverride(_ url: URL) -> Bool {
        if url.scheme == "https" { return true }
        #if DEBUG
        if url.scheme == "http", let h = url.host, h == "localhost" || h == "127.0.0.1" { return true }
        #endif
        return false
    }

    /// Hosts that load *inside* the app. Anything else (Stripe, mailto, external
    /// links) is handed to the system browser so the in-app session stays scoped
    /// to Fam ETC.
    static let allowedHosts: Set<String> = ["www.fametc.com", "fametc.com"]

    /// Name of the single `window.webkit.messageHandlers.<name>` bridge.
    static let bridgeName = "fam"

    static func isAllowed(host: String?) -> Bool {
        guard let host = host?.lowercased() else { return false }
        return allowedHosts.contains(host)
    }

    // MARK: - iOS client identification (free-tier gate)
    //
    // The server keeps the native app free of the web subscription gate by
    // recognising it as the iOS client. The legacy signal — a literal
    // `X-FamETC-Client: ios` header / `FamETCiOS` UA token — is trivially
    // forgeable by any web client, which also let a spoofer mint a permanently
    // "grandfathered" free account. To close that, the app presents a SHARED
    // SECRET that must match the server's `IOS_CLIENT_SECRET`:
    //   • native URLSession calls send it as the `X-FamETC-Client-Key` header;
    //   • the WKWebView (which cannot set per-request headers) embeds it in the
    //     User-Agent as `FamETCiOS/<key>`.
    // The server accepts either channel. The key ships via the `FAMIOSClientKey`
    // Info.plist entry (populated from the `FAM_IOS_CLIENT_KEY` build setting).
    // When it's empty (default), we fall back to the legacy signal so the app
    // keeps working until the server's `IOS_CLIENT_SECRET` is set to the same
    // value. Use only UA-safe characters in the key (e.g. hex / base64url).

    /// The shared secret baked into this build, or "" when unset.
    static let iosClientKey: String = {
        let raw = Bundle.main.object(forInfoDictionaryKey: "FAMIOSClientKey") as? String
        return (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }()

    /// Headers every NATIVE (URLSession) request carries so the server treats it
    /// as the iOS app. Includes the shared-secret header when a key is configured.
    static var clientHeaders: [String: String] {
        var h = ["X-FamETC-Client": "ios"]
        if !iosClientKey.isEmpty { h["X-FamETC-Client-Key"] = iosClientKey }
        return h
    }

    /// The `applicationNameForUserAgent` token for in-app WEB surfaces. Carries
    /// the shared secret (`FamETCiOS/<key>`) when configured, else the bare
    /// legacy token.
    static var webUserAgentToken: String {
        iosClientKey.isEmpty ? "FamETCiOS" : "FamETCiOS/\(iosClientKey)"
    }
}
