import UIKit
import WebKit
import SafariServices

/// Hosts the WKWebView that *is* the app. Owns the bridge, navigation policy,
/// pull-to-refresh, and a minimal offline/error screen. It also presents the
/// native document camera on the bridge's behalf.
final class WebShellController: UIViewController {

    // Note: cookies/session state are kept coherent via the shared default
    // WKWebsiteDataStore below. (WKProcessPool is deprecated — WebKit shares
    // process state automatically.)

    // The WKWebsiteDataStore persists across app updates, so stale cached HTML/JS/CSS
    // can survive a rebuild and shadow a new web deploy. Bump this token to force a
    // one-time cache purge (cookies/session preserved) on the next launch.
    private static let webCachePurgeToken = "2026-07-02-5"

    private var webView: WKWebView!
    private var bridge: Bridge!
    private let refreshControl = UIRefreshControl()
    private var errorView: ErrorView?

    // Onboarding handoff: collected inputs (JSON) forwarded to the web app once,
    // as ?onboard=… so it can seed the profile after sign-up.
    private let onboardQuery: String?

    init(onboardQuery: String? = nil) {
        self.onboardQuery = onboardQuery
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) {
        self.onboardQuery = nil
        super.init(coder: coder)
    }

    private var initialURL: URL {
        guard let q = onboardQuery, !q.isEmpty,
              var comps = URLComponents(url: Config.baseURL, resolvingAgainstBaseURL: false)
        else { return Config.baseURL }
        comps.queryItems = [URLQueryItem(name: "onboard", value: q)]
        return comps.url ?? Config.baseURL
    }

    // Injected into every page at document start. Sets the `__famNative` flag the
    // web app checks and exposes `FAM_native.call()`, a thin Promise wrapper over
    // the reply-based message handler.
    private static let bootstrapJS = """
    (function () {
      if (window.__famNative) return;
      window.__famNative = true;
      window.FAM_native = {
        call: function (action, payload) {
          try {
            return window.webkit.messageHandlers.\(Config.bridgeName).postMessage({ action: action, payload: payload || null });
          } catch (e) {
            return Promise.reject(new Error("native bridge unavailable"));
          }
        }
      };
    })();
    """

    // Lock the viewport scale *inside the app only*. iOS auto-zooms into any
    // focused input with font-size < 16px, and that zoomed viewport scrolls the
    // header off-screen — looking like the nav disappeared. Pinning
    // maximum-scale/user-scalable kills focus-zoom, double-tap zoom, and pinch
    // zoom. We do this natively (not in the site's HTML) so mobile-web and
    // desktop visitors keep pinch-to-zoom for accessibility. Re-asserted on SPA
    // route changes in case anything rewrites the meta.
    private static let viewportLockJS = """
    (function () {
      var CONTENT = "width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no";
      function lock() {
        var m = document.querySelector('meta[name="viewport"]');
        if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'viewport'); (document.head || document.documentElement).appendChild(m); }
        if (m.getAttribute('content') !== CONTENT) m.setAttribute('content', CONTENT);
      }
      lock();
      document.addEventListener('DOMContentLoaded', lock);
    })();
    """

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        setUpWebView()
        purgeWebCacheIfNeededThenLoad()
    }

    /// One-time-per-token purge of cached HTTP responses (NOT cookies), so a fresh
    /// web deploy always wins over assets cached by a previous app version.
    private func purgeWebCacheIfNeededThenLoad() {
        let key = "fam_webCachePurgeToken"
        if UserDefaults.standard.string(forKey: key) == Self.webCachePurgeToken {
            load(initialURL)
            return
        }
        UserDefaults.standard.set(Self.webCachePurgeToken, forKey: key)
        let types: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache,
            WKWebsiteDataTypeOfflineWebApplicationCache,
            WKWebsiteDataTypeFetchCache,
        ]
        WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: Date(timeIntervalSince1970: 0)) { [weak self] in
            guard let self else { return }
            self.load(self.initialURL)
        }
    }

    private func setUpWebView() {
        let controllerJS = WKUserContentController()
        controllerJS.addUserScript(WKUserScript(source: Self.bootstrapJS,
                                                injectionTime: .atDocumentStart,
                                                forMainFrameOnly: true))
        // documentEnd so the page's own <meta viewport> already exists and we
        // override it (rather than racing it during head parse).
        controllerJS.addUserScript(WKUserScript(source: Self.viewportLockJS,
                                                injectionTime: .atDocumentEnd,
                                                forMainFrameOnly: true))

        bridge = Bridge(host: self)
        // Reply-based handler: JS `postMessage(...)` returns a Promise that
        // resolves with whatever native passes to the reply handler.
        controllerJS.addScriptMessageHandler(bridge, contentWorld: .page, name: Config.bridgeName)

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // persistent cookies -> stays logged in
        config.userContentController = controllerJS
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // Left edge opens the web app's nav drawer (below), so disable the
        // built-in left-edge back-swipe — they'd both fire on the same gesture.
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // Belt-and-suspenders with the viewport-lock script: no pinch / double-tap
        // zoom, so a tap can never zoom the layout and hide the header.
        webView.scrollView.bouncesZoom = false
        webView.scrollView.minimumZoomScale = 1.0
        webView.scrollView.maximumZoomScale = 1.0
        #if DEBUG
        // Remote Web Inspector — DEBUG only. Never in a Release/TestFlight build,
        // or anyone with the device could drive the authenticated session.
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        refreshControl.addTarget(self, action: #selector(handleRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        // Swipe in from the left edge → open the web app's nav drawer.
        let edgePan = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleLeftEdgePan(_:)))
        edgePan.edges = .left
        webView.addGestureRecognizer(edgePan)

        view.addSubview(webView)
    }

    @objc private func handleLeftEdgePan(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard gesture.state == .began else { return }
        // Top-level SPA views open the nav drawer (FAM_openNav returns true).
        // Second-level views and standalone pages (quick-add) don't open it
        // (false / undefined) — there we navigate back instead.
        webView.evaluateJavaScript("window.FAM_openNav ? !!window.FAM_openNav() : false") { [weak self] result, _ in
            let opened = (result as? Bool) ?? false
            if !opened, let self = self, self.webView.canGoBack {
                self.webView.goBack()
            }
        }
    }

    private func load(_ url: URL) {
        errorView?.removeFromSuperview()
        errorView = nil
        // Always revalidate the main document. The persistent WKWebsiteDataStore
        // survives app updates and would otherwise serve a heuristically-cached old
        // shell — pinning the ?v=BUILD-versioned JS/CSS to a stale deploy. Revalidating
        // the HTML each load means a new deploy's assets are always picked up.
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadRevalidatingCacheData
        webView.load(req)
    }

    @objc private func handleRefresh() {
        webView.reloadFromOrigin() // bypass cache so pull-to-refresh always gets the latest
    }

    /// Presents the native receipt scanner. Called by the bridge for the
    /// `scanner.scan` action. The completion delivers OCR text (or a cancel /
    /// error) back to the web layer, which does the parsing + form prefill.
    func presentScanner(completion: @escaping (Result<ScannerResult, ScannerError>) -> Void) {
        ScannerService.shared.present(from: self, completion: completion)
    }

    // Voice capture (RetireOdds VoiceExpenseController) is out of scope for Fam ETC.

    private func showError() {
        guard errorView == nil else { return }
        let ev = ErrorView { [weak self] in
            guard let self else { return }
            self.load(Config.baseURL)
        }
        ev.frame = view.bounds
        ev.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(ev)
        errorView = ev
    }
}

// MARK: - Navigation policy

extension WebShellController: WKNavigationDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        // mailto:, tel:, etc. -> hand to the system.
        if let scheme = url.scheme?.lowercased(), scheme != "http", scheme != "https" {
            if UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
            return
        }

        // A user tapping a link to an off-site host opens in Safari; in-app
        // navigation (redirects, form posts, our own host) stays in the WebView.
        if navigationAction.navigationType == .linkActivated, !Config.isAllowed(host: url.host) {
            openExternally(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showError() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showError() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
    }

    private func openExternally(_ url: URL) {
        // In-app Safari for https links keeps the user one tap from returning.
        if url.scheme == "https" {
            present(SFSafariViewController(url: url), animated: true)
        } else if UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - target=_blank / window.open

extension WebShellController: WKUIDelegate {
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        // No multi-window: load same-host targets in place, send the rest to Safari.
        if let url = navigationAction.request.url {
            if Config.isAllowed(host: url.host) {
                webView.load(navigationAction.request)
            } else {
                openExternally(url)
            }
        }
        return nil
    }
}
