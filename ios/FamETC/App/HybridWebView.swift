import SwiftUI
import WebKit

/// Lightweight authenticated web host for the secondary surfaces that stay web
/// during the hybrid migration (Settings, Goals, Activities, More). Uses the
/// default website data store, which already holds the `fam_sess` cookie synced
/// by `AuthService` at sign-in — so these load logged-in.
struct HybridWebView: UIViewRepresentable {
    let path: String
    let isEmbedded: Bool

    init(path: String, isEmbedded: Bool = false) {
        self.path = path
        self.isEmbedded = isEmbedded
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        if isEmbedded {
            let userContentController = WKUserContentController()
            userContentController.addUserScript(WKUserScript(source: Self.embeddedShellScript,
                                                              injectionTime: .atDocumentStart,
                                                              forMainFrameOnly: true))
            config.userContentController = userContentController
        }
        // Append an iOS token to the User-Agent so in-app web surfaces are also
        // recognised as the iOS app (kept free of the web subscription gate). A
        // WebView can't set per-request headers, so the shared secret (when
        // configured) rides in the UA as FamETCiOS/<key> — see Config.
        config.applicationNameForUserAgent = Config.webUserAgentToken
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .always
        if let url = URL(string: Config.baseURL.absoluteString + path) {
            webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate {
        func webView(_ webView: WKWebView,
                     runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (Bool) -> Void) {
            guard let presenter = Self.presenter(from: webView.window?.rootViewController) else {
                completionHandler(false)
                return
            }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            let destructiveVerbs = ["Delete", "Remove", "Disconnect", "Revoke", "Disable", "Leave", "Rotate", "Regenerate"]
            let actionTitle = destructiveVerbs.first { message.hasPrefix($0) } ?? "Continue"
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: actionTitle, style: .destructive) { _ in completionHandler(true) })
            presenter.present(alert, animated: true)
        }

        private static func presenter(from root: UIViewController?) -> UIViewController? {
            if let presented = root?.presentedViewController { return presenter(from: presented) }
            if let navigation = root as? UINavigationController { return presenter(from: navigation.visibleViewController) }
            if let tabs = root as? UITabBarController { return presenter(from: tabs.selectedViewController) }
            return root
        }
    }

    private static let embeddedShellScript = """
        (function() {
            var style = document.createElement('style');
            style.textContent = '.standalone-app-shell .app-sidebar { display: none !important; }' +
                '.standalone-app-shell .standalone-main-content-wrap { flex: 1 1 100% !important; width: 100% !important; }';
            (document.head || document.documentElement).appendChild(style);
        }());
        """
}
