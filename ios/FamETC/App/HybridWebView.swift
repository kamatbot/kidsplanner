import SwiftUI
import WebKit

/// Lightweight authenticated web host for the secondary surfaces that stay web
/// during the hybrid migration (Settings, Goals, Activities, More). Uses the
/// default website data store, which already holds the `fam_sess` cookie synced
/// by `AuthService` at sign-in — so these load logged-in.
struct HybridWebView: UIViewRepresentable {
    let path: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // Append an iOS token to the User-Agent so in-app web surfaces are also
        // recognised as the iOS app (kept free of the web subscription gate). A
        // WebView can't set per-request headers, so the shared secret (when
        // configured) rides in the UA as FamETCiOS/<key> — see Config.
        config.applicationNameForUserAgent = Config.webUserAgentToken
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .always
        if let url = URL(string: Config.baseURL.absoluteString + path) {
            webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
