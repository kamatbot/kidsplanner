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

    private enum Screen { case role, parentWelcome, family, kid }
    @State private var screen: Screen = .role
    @State private var signingUp = false
    @State private var authError: String?
    @State private var showBackupSignIn = false
    private struct RecoveryCodesPayload: Identifiable {
        let id = UUID()
        let codes: [String]
    }
    @State private var recoveryPayload: RecoveryCodesPayload? = nil

    @State private var signupInviteCode = ""
    @State private var familyName = ""
    @State private var joinInviteCode = ""
    @State private var isJoiningExistingFamily = false
    @State private var familyBusy = false
    @State private var familyError: String?

    var body: some View {
        ZStack {
            FamTokens.background.ignoresSafeArea()
            Group {
                switch screen {
                case .role: roleChoice
                case .parentWelcome: welcome
                case .family: familySetup
                case .kid:
                    KidSignInView(onFinish: onFinish, onBack: { withAnimation { screen = .role } })
                }
            }
            .padding(.horizontal, screen == .kid ? 0 : 24)
        }
        .foregroundColor(FamTokens.textPrimary)
        .fullScreenCover(item: $recoveryPayload) { payload in
            RecoveryCodesView(codes: payload.codes) {
                recoveryPayload = nil
                onFinish(nil)
            }
        }
        .sheet(isPresented: $showBackupSignIn) {
            BackupCodeSignInView {
                showBackupSignIn = false
                onFinish(nil)
            }
            .presentationDetents([.large])
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
        let msg = error.localizedDescription
        if msg.localizedCaseInsensitiveContains("webcredentials") || msg.localizedCaseInsensitiveContains("associated domain") {
            return "Passkey sign-in isn't available on this build. Use a backup code below to sign in."
        }
        return msg
    }

    // MARK: 0 · Who's signing in — parent or kid

    private var roleChoice: some View {
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

            PrimaryButton(title: "I'm a parent") { withAnimation { screen = .parentWelcome } }

            Button {
                withAnimation { screen = .kid }
            } label: {
                Text("I'm a kid 🧒")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(FamTokens.accent)
                    .frame(maxWidth: .infinity).frame(height: 56)
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(FamTokens.accent, lineWidth: 1.5))
            }
            .buttonStyle(.plain)
            .padding(.top, 12)

            (Text("Already have an account? ") + Text("Sign in").foregroundColor(FamTokens.accent).bold())
                .font(.system(size: 14)).foregroundColor(FamTokens.textSub)
                .padding(.top, 16)
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
                .font(.system(size: 13)).foregroundColor(FamTokens.textSub).underline()
                .padding(.vertical, 4)
                .contentShape(Rectangle())
                .onTapGesture { guard !signingUp else { return }; showBackupSignIn = true }
                .padding(.top, 4)

            if let authError {
                Text(authError).font(.system(size: 13)).foregroundColor(FamTokens.danger)
                    .multilineTextAlignment(.center).padding(.top, 8)
            }

            Text("Kids sign in with their name + your family code — a parent approves on their phone.")
                .font(.system(size: 12)).foregroundColor(FamTokens.textSub)
                .multilineTextAlignment(.center)
                .padding(.top, 14).padding(.bottom, 24)
        }
        .padding(.top, 34)
    }

    // MARK: 1 · Welcome + passkey signup (PARENT ONLY — kids use the kid flow)

    private var welcome: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                HStack {
                    Brand()
                    Spacer()
                    Button { withAnimation { screen = .role } } label: {
                        Text("← Back").font(.system(size: 14, weight: .semibold)).foregroundColor(FamTokens.textSub)
                    }
                    .buttonStyle(.plain)
                    .disabled(signingUp)
                }
                .padding(.top, 8)

                VStack(alignment: .leading, spacing: 10) {
                    Text(isJoiningExistingFamily ? "Join your family" : "Create your family")
                        .font(.system(size: 30, weight: .bold)).lineSpacing(2)
                    Text("Fam ETC is invite-only for parents. Enter your invite code to get started.")
                        .font(.system(size: 15)).foregroundColor(FamTokens.textSub)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 24)

                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Invite code").font(.system(size: 13, weight: .medium)).foregroundColor(FamTokens.textSub)
                        TextField("Enter your invite code", text: $signupInviteCode)
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }

                    if isJoiningExistingFamily {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Co-parent family code").font(.system(size: 13, weight: .medium)).foregroundColor(FamTokens.textSub)
                            TextField("e.g. ABC123", text: $joinInviteCode)
                                .textFieldStyle(.roundedBorder)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Family name").font(.system(size: 13, weight: .medium)).foregroundColor(FamTokens.textSub)
                            TextField("e.g. The Smiths", text: $familyName)
                                .textFieldStyle(.roundedBorder)
                                .autocorrectionDisabled()
                            Text("Optional — defaults to “Our Family” if left blank.")
                                .font(.system(size: 11.5)).foregroundColor(FamTokens.textSub)
                        }
                    }

                    PrimaryButton(
                        title: signingUp
                            ? (isJoiningExistingFamily ? "Joining family…" : "Creating family…")
                            : (isJoiningExistingFamily ? "Join family with passkey 🎉" : "Create family with passkey 🎉")
                    ) {
                        createOrJoinFamilyWithPasskey()
                    }
                    .opacity(signingUp ? 0.7 : 1)
                    .disabled(signingUp)

                    if let authError {
                        Text(authError).font(.system(size: 13)).foregroundColor(FamTokens.danger)
                            .multilineTextAlignment(.leading)
                    }
                }
                .padding(16)
                .background(RoundedRectangle(cornerRadius: 16).fill(FamTokens.surface))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(FamTokens.cardBorder, lineWidth: 1))
                .padding(.top, 20)

                Button {
                    withAnimation {
                        isJoiningExistingFamily.toggle()
                        authError = nil
                    }
                } label: {
                    Text(isJoiningExistingFamily ? "Want to create a new family instead? Tap here" : "Joining a co-parent's existing family? Tap here")
                        .font(.system(size: 13)).foregroundColor(FamTokens.accent)
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                .padding(.top, 10)

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
                    .padding(.top, 8)
                    .padding(.bottom, 24)
            }
            .padding(.top, 20)
        }
    }

    private func createOrJoinFamilyWithPasskey() {
        let code = signupInviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            authError = "Please enter your invite code to continue."
            return
        }

        if isJoiningExistingFamily {
            let famCode = joinInviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !famCode.isEmpty else {
                authError = "Please enter the family code from your co-parent."
                return
            }
        }

        signingUp = true
        authError = nil
        let targetFamilyName = familyName.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedFamilyName = targetFamilyName.isEmpty ? "Our Family" : targetFamilyName
        let famCode = joinInviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let joining = isJoiningExistingFamily

        Task {
            do {
                try await AuthService.shared.signUpWithPasskey(
                    inviteCode: code,
                    name: resolvedFamilyName
                )

                if joining {
                    _ = try await AuthService.shared.joinFamily(code: famCode)
                } else {
                    _ = try await AuthService.shared.createFamily(name: resolvedFamilyName)
                }

                await MainActor.run {
                    signingUp = false
                    finishOnboarding()
                }
            } catch {
                await MainActor.run {
                    signingUp = false
                    if let e = error as? AuthError, e.isCancellation { return }
                    if (error as? AuthError) == nil {
                        familyError = friendlyError(error)
                        withAnimation { screen = .family }
                    } else {
                        authError = friendlyError(error)
                    }
                }
            }
        }
    }

    // MARK: 2 · Create or join a family (fallback after account creation)

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
                TextField("ABC123", text: $joinInviteCode)
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
                _ = try await AuthService.shared.joinFamily(code: joinInviteCode)
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
            var codes = await AuthService.shared.issueBackupCodesIfNeeded()
            if codes == nil || codes?.isEmpty == true {
                codes = try? await AuthService.shared.regenerateBackupCodes()
            }
            await MainActor.run {
                if let codes, !codes.isEmpty {
                    recoveryPayload = RecoveryCodesPayload(codes: codes)
                } else {
                    onFinish(nil)
                }
            }
        }
    }
}
