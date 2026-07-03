import SwiftUI

/// Recovery sign-in: lets a member who has lost their passkey enter one of the
/// one-time backup codes they saved at sign-up to re-establish a session.
/// Presented as a sheet from the welcome screen and the session-expired overlay.
///
/// On success the fam_sess cookie is set + synced to the WebView (handled in
/// `AuthService.signInWithBackupCode`); the parent's `onSuccess` then proceeds
/// into the app.
struct BackupCodeSignInView: View {
    /// Called after a successful sign-in — the parent dismisses and proceeds.
    let onSuccess: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focused: Bool

    // A code is two 5-char groups (XXXXX-XXXXX); enable submit once enough
    // alphanumerics are typed, tolerating the dash and stray spaces.
    private var canSubmit: Bool {
        !working && code.filter { $0.isLetter || $0.isNumber }.count >= 8
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.xl) {
                    header
                    field
                    if let error {
                        Text(error)
                            .font(Typography.label)
                            .foregroundStyle(Palette.warn)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, Space.xl)
                .padding(.top, Space.xxl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Palette.bg.ignoresSafeArea())
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) {
                submitButton
                    .padding(.horizontal, Space.xl)
                    .padding(.top, Space.md)
                    .padding(.bottom, Space.lg)
                    .background(.ultraThinMaterial)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear { focused = true }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Image(systemName: "key.horizontal.fill")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(Palette.accent)
                .frame(width: 52, height: 52)
                .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))

            Text("Use a backup code")
                .font(Typography.title)
                .foregroundStyle(Palette.text)

            Text("Lost access to your passkey? Enter one of the recovery codes you saved when you created your account. Each code works once.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Field

    private var field: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Text("RECOVERY CODE")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
            TextField("XXXXX-XXXXX", text: $code)
                .font(Typography.mono(18, .medium))
                .foregroundStyle(Palette.text)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled(true)
                .submitLabel(.go)
                .focused($focused)
                .onSubmit { if canSubmit { submit() } }
                .padding(Space.md)
                .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                        .strokeBorder(Palette.border, lineWidth: 1)
                )
        }
    }

    // MARK: Submit

    private var submitButton: some View {
        Button(action: submit) {
            HStack(spacing: Space.sm) {
                if working { ProgressView().tint(Palette.onAccent) }
                Text(working ? "Signing in…" : "Sign in")
                    .font(.system(size: 17, weight: .bold))
            }
            .foregroundStyle(Palette.onAccent)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .opacity(canSubmit ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit)
    }

    private func submit() {
        guard canSubmit else { return }
        focused = false
        working = true
        error = nil
        Task {
            do {
                try await AuthService.shared.signInWithBackupCode(code)
                await MainActor.run {
                    working = false
                    Haptics.notify(.success)
                    onSuccess()
                }
            } catch {
                await MainActor.run {
                    working = false
                    Haptics.notify(.error)
                    if let e = error as? AuthError, case let .verify(m) = e {
                        self.error = m
                    } else {
                        self.error = "That code didn’t work. Check it and try again."
                    }
                }
            }
        }
    }
}
