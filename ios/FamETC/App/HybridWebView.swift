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

    func makeUIView(context: Context) -> HybridWebContainer {
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
        webView.navigationDelegate = context.coordinator
        let container = HybridWebContainer(webView: webView)
        context.coordinator.attach(to: container)
        context.coordinator.load(path: path)
        return container
    }

    func updateUIView(_ container: HybridWebContainer, context: Context) {
        // SwiftUI may update a host with a different route. Reuse the retained
        // WKWebView (and its cookie/data-store state) while loading that route.
        context.coordinator.attach(to: container)
        context.coordinator.load(path: path)
    }

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate {
        private weak var container: HybridWebContainer?
        private var requestedURL: URL?
        private var latestMainFrameURL: URL?
        private var latestFailureURL: URL?
        private var progressObservation: NSKeyValueObservation?

        func attach(to container: HybridWebContainer) {
            guard self.container !== container else { return }
            self.container = container
            progressObservation = container.webView.observe(\.estimatedProgress, options: [.initial, .new]) { [weak container] webView, _ in
                container?.setLoadingProgress(webView.isLoading ? webView.estimatedProgress : nil)
            }
            container.retryAction = { [weak self] in self?.retry() }
        }

        func load(path: String, force: Bool = false) {
            guard let container, let url = Self.url(for: path) else { return }
            guard force || requestedURL != url else { return }
            requestedURL = url
            latestMainFrameURL = Self.internalURL(url)
            latestFailureURL = nil
            container.clearFailure()
            container.webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        }

        private func retry() {
            guard let url = latestFailureURL
                ?? Self.internalURL(container?.webView.url)
                ?? latestMainFrameURL else { return }
            container?.clearFailure()
            container?.webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        }

        private static func url(for path: String) -> URL? {
            URL(string: Config.baseURL.absoluteString + path)
        }

        /// Recovery only replays app URLs. This does not change WebKit's
        /// existing navigation decisions or its shared cookie/data store.
        private static func internalURL(_ url: URL?) -> URL? {
            guard let url, url.user == nil, url.password == nil else { return nil }
            let base = Config.baseURL
            let matchesBase = url.scheme == base.scheme
                && url.host?.lowercased() == base.host?.lowercased()
                && url.port == base.port
            let isProduction = url.scheme == "https" && Config.isAllowed(host: url.host)
                && (url.port == nil || url.port == 443)
            return matchesBase || isProduction ? url : nil
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if navigationAction.targetFrame?.isMainFrame == true,
               let url = Self.internalURL(navigationAction.request.url) {
                latestMainFrameURL = url
                latestFailureURL = nil
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            container?.clearFailure()
            container?.setLoadingProgress(webView.estimatedProgress)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            if let url = Self.internalURL(webView.url) { latestMainFrameURL = url }
            latestFailureURL = nil
            container?.setLoadingProgress(nil)
        }

        func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
            if let url = Self.internalURL(webView.url) { latestMainFrameURL = url }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            presentFailureIfNeeded(error, in: webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            presentFailureIfNeeded(error, in: webView)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            latestFailureURL = Self.internalURL(webView.url) ?? latestMainFrameURL
            container?.showFailure("This page needs to reload. Your signed-in session is still available.")
        }

        private func presentFailureIfNeeded(_ error: Error, in webView: WKWebView) {
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else { return }
            let failedURL = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL)
                ?? (nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String).flatMap(URL.init(string:))
            latestFailureURL = Self.internalURL(failedURL) ?? latestMainFrameURL
            container?.showFailure("This page couldn’t load. Check your connection and try again.")
        }

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

/// Keeps one web view alive while adding native loading and recovery affordances
/// above it. The progress bar never obscures an already usable page.
final class HybridWebContainer: UIView {
    let webView: WKWebView
    var retryAction: (() -> Void)?
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private let failureView = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
    private let failureLabel = UILabel()
    private let retryButton = UIButton(type: .system)

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])

        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressView.progressTintColor = UIColor(Palette.accent)
        progressView.trackTintColor = .clear
        progressView.isHidden = true
        addSubview(progressView)
        NSLayoutConstraint.activate([
            progressView.leadingAnchor.constraint(equalTo: leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: trailingAnchor),
            progressView.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor),
            progressView.heightAnchor.constraint(equalToConstant: 3)
        ])

        failureView.translatesAutoresizingMaskIntoConstraints = false
        failureView.isHidden = true
        failureView.layer.cornerRadius = 14
        failureView.clipsToBounds = true
        addSubview(failureView)
        NSLayoutConstraint.activate([
            failureView.centerXAnchor.constraint(equalTo: centerXAnchor),
            failureView.centerYAnchor.constraint(equalTo: centerYAnchor),
            failureView.leadingAnchor.constraint(greaterThanOrEqualTo: layoutMarginsGuide.leadingAnchor),
            failureView.trailingAnchor.constraint(lessThanOrEqualTo: layoutMarginsGuide.trailingAnchor),
            failureView.widthAnchor.constraint(lessThanOrEqualToConstant: 360)
        ])
        let content = failureView.contentView
        failureLabel.font = .preferredFont(forTextStyle: .body)
        failureLabel.textColor = .label
        failureLabel.numberOfLines = 0
        failureLabel.textAlignment = .center
        failureLabel.adjustsFontForContentSizeCategory = true
        retryButton.setTitle("Try again", for: .normal)
        retryButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        retryButton.accessibilityIdentifier = "hybrid-web-retry"
        retryButton.addTarget(self, action: #selector(retry), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [failureLabel, retryButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.layoutMarginsGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.layoutMarginsGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.layoutMarginsGuide.bottomAnchor),
            retryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setLoadingProgress(_ progress: Double?) {
        guard let progress else {
            progressView.isHidden = true
            return
        }
        progressView.isHidden = false
        progressView.setProgress(Float(progress), animated: true)
    }

    func showFailure(_ message: String) {
        progressView.isHidden = true
        failureLabel.text = message
        failureView.isHidden = false
    }

    func clearFailure() { failureView.isHidden = true }

    @objc private func retry() { retryAction?() }
}
