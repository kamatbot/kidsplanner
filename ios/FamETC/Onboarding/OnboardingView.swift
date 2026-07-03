import SwiftUI

// Fam ETC native onboarding — written fresh for this app (per ios.md, RetireOdds'
// OnboardingView.swift is "template only, ~30% reusable": the financial content
// doesn't apply, but the passkey-signup-first pattern, StepBar-style back/skip
// affordance, and Horizon design tokens carry over). Three screens: Welcome →
// passkey signup → create-or-join-family. Deliberately minimal for the scaffold —
// polish is future work.

private enum FamTokens {
    static let accent = Palette.accent
    static let textPrimary = Palette.text
    static let textSub = Palette.textSecond
    static let surface = Palette.panel
    static let cardBorder = Palette.border
    static let danger = Palette.red
    static let background = Palette.bg
}

private struct PrimaryButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 17, weight: .bold))
                .foregroundColor(Palette.onAccent)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(FamTokens.accent)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .shadow(color: FamTokens.accent.opacity(0.28), radius: 18, x: 0, y: 10)
        }
        .buttonStyle(.plain)
    }
}

private struct Brand: View {
    var body: some View {
        HStack(spacing: 8) {
            Text("✨").font(.system(size: 18))
            Text("Fam ETC").font(.system(size: 18, weight: .bold)).foregroundColor(FamTokens.textPrimary)
        }
    }
}

struct OnboardingView: View {
    /// Called when onboarding finishes (family created/joined) or is skipped.
    let onFinish: (String?) -> Void

    @State private var step = 0
    @State private var signingUp = false
    @State private var authError: String?
    @State private var showBackupSignIn = false
    @State private var recoveryCodes: [String] = []
    @State private var showRecoveryCodes = false

    @State private var familyName = ""
    @State private var inviteCode = ""
    @State private var familyBusy = false
    @State private var familyError: String?

    var body: some View {
        ZStack {
            FamTokens.background.ignoresSafeArea()
            Group {
                switch step {
                case 0: welcome
                default: familySetup
                }
            }
            .padding(.horizontal, 24)
        }
        .foregroundColor(FamTokens.textPrimary)
        .fullScreenCover(isPresented: $showRecoveryCodes) {
            RecoveryCodesView(codes: recoveryCodes) {
                showRecoveryCodes = false
                onFinish(nil)
            }
        }
    }

    private func friendlyError(_ error: Error) -> String {
        if let e = error as? AuthError {
            switch e {
            case .verify(let m): return m
            case .options: return "Couldn't start — server didn't return passkey options."
            case .registration: return "The passkey response was invalid."
            case .unsupported: return "Passkeys aren't available on this device."
            case .cancelled: return "Cancelled."
            }
        }
        return error.localizedDescription
    }

    // MARK: 1 · Welcome + passkey signup (PARENT ONLY — no kid signup path exists)

    private var welcome: some View {
        VStack(spacing: 0) {
            Brand().frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)

            VStack(alignment: .leading, spacing: 12) {
                Text("The etcetera hub for your family.")
                    .font(.system(size: 32, weight: .bold)).lineSpacing(2)
                Text("School calendars, homework, activities, goals, and family chat in one place.")
                    .font(.system(size: 15)).foregroundColor(FamTokens.textSub)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 30)

            Spacer()

            Text("This account is for parents. You'll add kid profiles once you're in — kids never sign up themselves.")
                .font(.system(size: 12.5)).foregroundColor(FamTokens.textSub)
                .multilineTextAlignment(.center)
                .padding(.bottom, 14)

            PrimaryButton(title: signingUp ? "Creating account…" : "Create account with passkey") {
                guard !signingUp else { return }
                signingUp = true; authError = nil
                Task {
                    do {
                        try await AuthService.shared.signUpWithPasskey()
                        await MainActor.run { signingUp = false; withAnimation { step = 1 } }
                    } catch {
                        await MainActor.run {
                            signingUp = false
                            if let e = error as? AuthError, e.isCancellation { return }
                            authError = friendlyError(error)
                        }
                    }
                }
            }
            .opacity(signingUp ? 0.7 : 1)

            if let authError {
                Text(authError).font(.system(size: 13)).foregroundColor(FamTokens.danger)
                    .multilineTextAlignment(.center).padding(.top, 8)
            }

            (Text("Already a parent here? ") + Text("Sign in").foregroundColor(FamTokens.accent).bold())
                .font(.system(size: 14)).foregroundColor(FamTokens.textSub)
                .padding(.top, 14)
                .padding(.vertical, 10).padding(.horizontal, 28)
                .contentShape(Rectangle())
                .onTapGesture {
                    guard !signingUp else { return }
                    signingUp = true; authError = nil
                    Task {
                        do {
                            try await AuthService.shared.signInWithPasskey()
                            await MainActor.run { signingUp = false; onFinish(nil) }
                        } catch {
                            await MainActor.run {
                                signingUp = false
                                if let e = error as? AuthError, e.isCancellation { return }
                                authError = friendlyError(error)
                            }
                        }
                    }
                }

            Text("Use a backup code")
                .font(.system(size: 12.5)).foregroundColor(FamTokens.textSub).underline()
                .padding(.vertical, 4)
                .contentShape(Rectangle())
                .onTapGesture { guard !signingUp else { return }; showBackupSignIn = true }
                .padding(.top, 10)
                .padding(.bottom, 24)
        }
        .padding(.top, 34)
        .sheet(isPresented: $showBackupSignIn) {
            BackupCodeSignInView {
                showBackupSignIn = false
                onFinish(nil)
            }
            .presentationDetents([.large])
        }
    }

    // MARK: 2 · Create or join a family

    private var familySetup: some View {
        VStack(alignment: .leading, spacing: 24) {
            Brand().frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)

            VStack(alignment: .leading, spacing: 8) {
                Text("Set up your family").font(.system(size: 27, weight: .bold))
                Text("Create a new family, or join one with an invite code from your co-parent.")
                    .font(.system(size: 15)).foregroundColor(FamTokens.textSub)
            }
            .padding(.top, 20)

            VStack(alignment: .leading, spacing: 10) {
                Text("Family name").font(.system(size: 13)).foregroundColor(FamTokens.textSub)
                TextField("The Smiths", text: $familyName)
                    .textFieldStyle(.roundedBorder)
                PrimaryButton(title: familyBusy ? "Creating…" : "Create our family") {
                    createFamily()
                }
                .opacity(familyBusy ? 0.7 : 1)
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 16).fill(FamTokens.surface))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(FamTokens.cardBorder, lineWidth: 1))

            Text("or").font(.system(size: 13)).foregroundColor(FamTokens.textSub).frame(maxWidth: .infinity, alignment: .center)

            VStack(alignment: .leading, spacing: 10) {
                Text("Invite code").font(.system(size: 13)).foregroundColor(FamTokens.textSub)
                TextField("ABC123", text: $inviteCode)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.characters)
                Button(action: joinFamily) {
                    Text(familyBusy ? "Joining…" : "Join with code")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(FamTokens.accent)
                        .frame(maxWidth: .infinity).frame(height: 48)
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(FamTokens.accent, lineWidth: 1.5))
                }
                .disabled(familyBusy)
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 16).fill(FamTokens.surface))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(FamTokens.cardBorder, lineWidth: 1))

            if let familyError {
                Text(familyError).font(.system(size: 13)).foregroundColor(FamTokens.danger)
            }

            Spacer()
        }
        .padding(.top, 34).padding(.bottom, 12)
    }

    private func createFamily() {
        guard !familyBusy else { return }
        familyBusy = true; familyError = nil
        Task {
            do {
                _ = try await AuthService.shared.createFamily(name: familyName.isEmpty ? "Our Family" : familyName)
                await MainActor.run { familyBusy = false; finishOnboarding() }
            } catch {
                await MainActor.run { familyBusy = false; familyError = friendlyError(error) }
            }
        }
    }

    private func joinFamily() {
        guard !familyBusy else { return }
        familyBusy = true; familyError = nil
        Task {
            do {
                _ = try await AuthService.shared.joinFamily(code: inviteCode)
                await MainActor.run { familyBusy = false; finishOnboarding() }
            } catch {
                await MainActor.run { familyBusy = false; familyError = friendlyError(error) }
            }
        }
    }

    // Onboarding is done. Mint recovery codes and show them once before entering
    // the app (mirrors the RetireOdds pattern — first real account activity is
    // when backup codes become worth having).
    private func finishOnboarding() {
        APIClient.shared.track("onboarding_complete")
        Task {
            let codes = await AuthService.shared.issueBackupCodesIfNeeded()
            await MainActor.run {
                if let codes, !codes.isEmpty {
                    recoveryCodes = codes
                    showRecoveryCodes = true
                } else {
                    onFinish(nil)
                }
            }
        }
    }
}
