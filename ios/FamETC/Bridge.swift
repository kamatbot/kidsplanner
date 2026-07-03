import WebKit

/// The single JS⇄native message router (`window.webkit.messageHandlers.fam`).
///
/// JS calls `window.FAM_native.call(action, payload)`, which returns a Promise.
/// We resolve it via the reply handler. Keep the contract small and versionable:
/// unknown actions reject cleanly, so a newer web app degrades gracefully on an
/// older native shell.
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {

    private weak var host: WebShellController?

    init(host: WebShellController) {
        self.host = host
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard
            let body = message.body as? [String: Any],
            let action = body["action"] as? String
        else {
            replyHandler(nil, "malformed bridge message")
            return
        }

        switch action {
        case "scanner.scan":
            handleScan(replyHandler: replyHandler)

        // Voice capture (RetireOdds VoiceExpenseController) is out of scope for Fam ETC.

        default:
            replyHandler(nil, "unknown action: \(action)")
        }
    }

    private func handleScan(replyHandler: @escaping (Any?, String?) -> Void) {
        guard let host else {
            replyHandler(nil, "scanner unavailable")
            return
        }
        host.presentScanner { result in
            switch result {
            case .success(let scan):
                // Web side reads `text` and runs parseReceipt()/applyParsed().
                replyHandler(["text": scan.text], nil)
            case .failure(.cancelled):
                // A cancel is a normal outcome, not an error: resolve quietly so
                // the web layer can no-op instead of showing a toast.
                replyHandler(["cancelled": true], nil)
            case .failure(let error):
                replyHandler(nil, error.userMessage)
            }
        }
    }
}
