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
        ParentWatchCompanion.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                if ProcessInfo.processInfo.environment["FAM_PREVIEW_FAMS"] == "1" {
                    FamsPreviewRoot()
                } else {
                    normalContent
                }
                #else
                normalContent
                #endif
            }
            .task {
                #if DEBUG
                if ProcessInfo.processInfo.environment["FAM_PREVIEW_FAMS"] == "1" { return }
                #endif
                APIClient.shared.track("app_open")
            }
            .onChange(of: store.me?.id) { _, _ in
                ParentWatchCompanion.shared.updateIdentity(store.me)
            }
        }
    }

    @ViewBuilder private var normalContent: some View {
        if onboarded {
            RootView().environment(store)
        } else {
            OnboardingView { _ in onboarded = true }
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

    /// UI-test hook: when set, AppStore skips the network chat loop and
    /// injects a mock family + messages after this many milliseconds —
    /// reproducing the async-arrival timing behind the chat first-layout
    /// race (messages landing AFTER the chat surface has laid out).
    static var mockChatDelayMs: Int? { env["FAM_MOCK_CHAT_DELAY_MS"].flatMap(Int.init) }

    /// UI-test hook: render the authenticated shell without network work so
    /// iPad navigation latency and first-tap behavior are tested in isolation.
    static var mockNavigation: Bool { env["FAM_MOCK_NAVIGATION"] == "1" }

    /// Suppress the push-permission prompt during seeded QA screenshots (a dev
    /// cookie is injected only in that flow), so it doesn't block the UI.
    static var skipPush: Bool { env["FAM_DEV_COOKIE"] != nil || mockNavigation }

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
