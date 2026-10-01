import SwiftUI
import UIKit

// Upgrade a Screen Time family to the whole Fam ETC (docs/SCREEN-TIME-ONLY-PLAN.md §5).
// Family → "Get the whole Fam ETC" → invite code → `AppStore.upgradeFamily(inviteCode:)`.
// The upgrade flips `AppStore.productPlan`, so `RootView` immediately rebuilds into the full
// tab layout and this whole screen tree goes away. The one-screen welcome therefore cannot
// live inside it: `UpgradeWelcomePresenter` shows it from UIKit, above whatever is on screen.

struct UpgradeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var trimmedCode: String { code.trimmingCharacters(in: .whitespacesAndNewlines) }

    struct Feature: Identifiable {
        let icon: String
        let title: String
        let detail: String
        var id: String { title }
    }

    static let included: [Feature] = [
        Feature(icon: "calendar", title: "School calendar", detail: "Every feed and family event in one place."),
        Feature(icon: "book.closed.fill", title: "Homework", detail: "What's due, by kid, with progress."),
        Feature(icon: "bubble.left.and.bubble.right.fill", title: "Family chat", detail: "One thread for the whole family."),
        Feature(icon: "airplane", title: "Trips and meals", detail: "Plan the next trip and what's for dinner."),
    ]

    var body: some View {
        NavigationStack {
            PlanPage(maxWidth: 600) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    Text("Get the whole Fam ETC")
                        .font(Typography.largeTitle)
                        .foregroundStyle(Palette.text)
                        .accessibilityAddTraits(.isHeader)
                    Text("Add the school calendar, homework and family chat to the Screen Time you already use. The whole family gets it, and your rules, devices and deals stay just as they are.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Card(padding: Space.lg) {
                    VStack(alignment: .leading, spacing: Space.lg) {
                        ForEach(Self.included) { item in
                            HStack(alignment: .top, spacing: Space.md) {
                                Image(systemName: item.icon)
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(Palette.frYouInk)
                                    .frame(width: 36, height: 36)
                                    .background(Palette.frYouSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                                    Text(item.detail).font(Typography.label).foregroundStyle(Palette.textSecond)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                VStack(alignment: .leading, spacing: Space.sm) {
                    MicroLabel(text: "Invite code")
                    TextField("Enter your invite code", text: $code)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($focused)
                        .onSubmit { upgrade() }
                        .font(Typography.body)
                        .padding(Space.md)
                        .frame(minHeight: 44)
                        .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                            .strokeBorder(Palette.frRule, lineWidth: 1))
                        .accessibilityIdentifier("upgrade.code")
                    if let error { PlanErrorLine(message: error) }
                    PlanButton(title: "Upgrade my family", systemImage: "sparkles", style: .prominent,
                               busy: working, fullWidth: true) { upgrade() }
                        .disabled(trimmedCode.isEmpty)
                        .opacity(trimmedCode.isEmpty ? 0.5 : 1)
                        .accessibilityIdentifier("upgrade.submit")
                    Text("Upgrading is for the whole family and can't be undone in the app yet.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Upgrade")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(working)
                }
            }
        }
        .interactiveDismissDisabled(working)
        .accessibilityIdentifier("upgrade.sheet")
    }

    private func upgrade() {
        guard !trimmedCode.isEmpty, !working else { return }
        focused = false
        working = true
        error = nil
        let invite = trimmedCode
        Task {
            do {
                try await store.upgradeFamily(inviteCode: invite)
                Haptics.notify(.success)
                // The plan just flipped and the root is rebuilding around us.
                UpgradeWelcomePresenter.presentSoon(store: store)
            } catch {
                self.error = Self.message(for: error)
            }
            working = false
        }
    }

    /// A wrong code is the common failure: say so plainly, keep anything else verbatim.
    static func message(for error: Error) -> String {
        if case APIError.http(let status, _) = error, status == 403 {
            return "That code didn't work. Check it and try again."
        }
        return error.localizedDescription
    }
}

// MARK: - Welcome (one screen)

/// "Welcome to the whole Fam ETC": what is new, one button.
struct UpgradeWelcomeView: View {
    let onDone: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.xl) {
                Image(systemName: "sparkles")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(Palette.frOnYou)
                    .frame(width: 64, height: 64)
                    .background(Palette.frYou, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Space.sm) {
                    Text("Welcome to the whole Fam ETC")
                        .font(Typography.largeTitle)
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text("Here's what's new for your family. Screen Time keeps everything: your rules, devices and deals.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: Space.lg) {
                    ForEach(UpgradeView.included) { item in
                        HStack(alignment: .top, spacing: Space.md) {
                            Image(systemName: item.icon)
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(Palette.frYouInk)
                                .frame(width: 36, height: 36)
                                .background(Palette.frYouSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                                Text(item.detail).font(Typography.label).foregroundStyle(Palette.textSecond)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                PlanButton(title: "Let's go", style: .prominent, fullWidth: true, action: onDone)
                    .accessibilityIdentifier("upgrade.welcome.done")
            }
            .padding(Space.xl)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(ScreenBackground())
        .accessibilityIdentifier("upgrade.welcome")
    }
}

/// Presents `UpgradeWelcomeView` from UIKit above the current screen, so it survives the
/// root swap that an upgrade triggers (the SwiftUI tree that started the upgrade is gone).
@MainActor
enum UpgradeWelcomePresenter {
    /// Waits a moment for the layout rebuild and the closing sheet, then presents.
    static func presentSoon(store: AppStore) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(700))
            present(store: store)
        }
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
        return top
    }

    private static func present(store: AppStore) {
        guard let top = topViewController() else { return }
        let host = UIHostingController(rootView: AnyView(EmptyView()))
        host.rootView = AnyView(
            UpgradeWelcomeView { [weak host] in host?.dismiss(animated: true) }
                .environment(store)
                .tint(Palette.frYou)
                .preferredColorScheme(store.colorScheme)
        )
        host.modalPresentationStyle = .pageSheet
        top.present(host, animated: true)
    }
}
