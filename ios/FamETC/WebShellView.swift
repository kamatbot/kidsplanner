import SwiftUI

/// SwiftUI entry point that hosts the UIKit `WebShellController`.
///
/// We use a UIViewController (not a bare WKWebView) so the controller can
/// present the native document camera modally and own the navigation/UI
/// delegates and the bridge.
struct WebShellView: UIViewControllerRepresentable {
    /// Optional onboarding payload (JSON) handed off to the web app on first run.
    var onboardQuery: String? = nil

    func makeUIViewController(context: Context) -> WebShellController {
        WebShellController(onboardQuery: onboardQuery)
    }

    func updateUIViewController(_ controller: WebShellController, context: Context) {}
}
