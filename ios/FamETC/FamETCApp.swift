import SwiftUI
import Foundation

@main
struct FamETCApp: App {
    // Persisted across launches: native onboarding shows once, then the native app
    // shell (RootView) is the home. Onboarding creates/joins a family server-side
    // via AuthService + APIClient, so the store just loads it.
    @AppStorage("fam_onboarded") private var onboarded = false
    @State private var store = AppStore()

    // Push notifications: see PushRegistrationService / NotificationHandler.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        #if DEBUG
        DebugLaunch.bootstrap()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if onboarded {
                    RootView()
                        .environment(store)
                } else {
                    OnboardingView { _ in
                        onboarded = true
                    }
                }
            }
            // First-party analytics: one app-open event per launch (anonymous,
            // best-effort). Native signups are tracked server-side at /api/...signup.
            .task { APIClient.shared.track("app_open") }
        }
    }
}

#if DEBUG
/// Local-only launch helpers for automated screenshots / QA. Driven entirely by
/// environment variables passed to the Simulator (SIMCTL_CHILD_*), so this code is
/// inert unless those are set, and it is compiled out of Release builds entirely.
///
///   FAM_DEV_COOKIE  "fam_sess=<v>; fam_sess.sig=<v>"  — inject a dev session
///   FAM_ONBOARDED   "1"                                — skip native onboarding
///   FAM_THEME       "light" | "dark"                   — force the app theme
///   FAM_SCREEN      today|chat|calendar|homework        — deep-link target tab
enum DebugLaunch {
    private static var env: [String: String] { ProcessInfo.processInfo.environment }

    /// The deep-link target screen for this launch (read by RootView).
    static var screen: String? { env["FAM_SCREEN"] }

    static func bootstrap() {
        let e = env
        if e["FAM_ONBOARDED"] == "1" {
            UserDefaults.standard.set(true, forKey: "fam_onboarded")
        }
        if let theme = e["FAM_THEME"], theme == "light" || theme == "dark" {
            UserDefaults.standard.set(theme, forKey: "fam_theme")
        }
        if let raw = e["FAM_DEV_COOKIE"], let host = Config.baseURL.host {
            for part in raw.split(separator: ";") {
                let kv = part.trimmingCharacters(in: .whitespaces)
                guard let eq = kv.firstIndex(of: "=") else { continue }
                let name = String(kv[..<eq])
                let value = String(kv[kv.index(after: eq)...])
                guard !name.isEmpty, !value.isEmpty,
                      let cookie = HTTPCookie(properties: [
                          .domain: host, .path: "/", .name: name, .value: value,
                      ]) else { continue }
                HTTPCookieStorage.shared.setCookie(cookie)
            }
        }
    }
}
#endif
