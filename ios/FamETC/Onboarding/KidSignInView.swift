import SwiftUI

// Native kid sign-in on the kid's OWN device (docs/SCREEN-TIME-ONLY-PLAN.md §3). The main path
// is a code: a parent shows a short setup code, the kid TYPES it (no camera), sees "Hi Maya!",
// waits for the parent's approval, then makes a passkey — or continues without one.
//   AuthService.claimKidSetupCode → poll kidAccessStatus → completeKidPasskey
//                                        └ or kidSignInWithoutPasskey (D7)
// The older family-code + name request stays reachable ("I have a family code instead") for
// whole-Fam-ETC families: requestKidAccess → the same polling and passkey steps.
// See lib/kid-access.js and the /api/kid/* routes.
struct KidSignInView: View {
    /// Called once the kid is signed in (passkey registered or session issued).
    let onFinish: (String?) -> Void
    /// Called when the kid backs out to the welcome screen.
    let onBack: () -> Void

    private enum Stage { case code, hello, waiting, approved, denied, expired, familyCode }

    /// The access request this device is driving, however it was opened.
    private struct Pending {
        let id: String
        let pollToken: String
        let kidName: String
        let familyName: String?
    }

    @State private var stage: Stage = .code
    @State private var code = ""
    @State private var familyCode = ""
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    @State private var pending: Pending?
    @State private var viaFamilyCode = false
    /// True once the kid cancelled the passkey sheet. "Continue without" is offered only
    /// after a passkey attempt: a request used for the no-passkey session can no longer
    /// register a passkey, so it must not be the first thing a kid can tap.
    @State private var passkeyDeclined = false
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        OnbPage(onBack: backAction) {
            switch stage {
            case .code: codeEntry
            case .hello: hello
            case .waiting: waiting
            case .approved: approved
            case .denied:
                outcome(emoji: "🙅", title: "Not right now",
                        message: "Your grown-up didn't approve this time. Check with them and try again.")
            case .expired:
                outcome(emoji: "⏳", title: "That took too long",
                        message: "Requests time out after a while. Ask your grown-up for a new code and try again.")
            case .familyCode: familyCodeForm
            }
        }
        .onDisappear { pollTask?.cancel() }
    }

    /// Back is only offered where nothing is in flight.
    private var backAction: (() -> Void)? {
        switch stage {
        case .code:
            return onBack
        case .familyCode:
            if busy { return nil }
            return { error = nil; stage = .code }
        default:
            return nil
        }
    }

    // MARK: Type the code

    private var codeEntry: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            OnbTitle(title: "Type your code",
                     subtitle: "Your grown-up has a code for you. Ask them to open Fam ETC and show it to you.")

            VStack(alignment: .leading, spacing: Space.md) {
                KidCodeEntryView(code: $code, onSubmit: claim)
                HStack(spacing: Space.md) {
                    Text("Codes use the letters A to Z (no I or O) and the numbers 2 to 9.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    PasteButton(payloadType: String.self) { strings in
                        guard let first = strings.first else { return }
                        DispatchQueue.main.async { code = KidSetupCodeFormat.normalize(first) }
                    }
                    .labelStyle(.iconOnly)
                    .buttonBorderShape(.capsule)
                    .tint(Palette.accent)
                    .accessibilityLabel("Paste code")
                }
            }

            OnbPrimaryButton(title: busy ? "Checking…" : "Continue", busy: busy,
                             enabled: KidSetupCodeFormat.isComplete(code), action: claim)
                .accessibilityIdentifier(OnbID.kidCodeContinue)

            if let error { OnbErrorText(message: error) }

            OnbLinkButton(title: "I have a family code instead", enabled: !busy) {
                error = nil
                stage = .familyCode
            }
            .accessibilityIdentifier(OnbID.kidLegacy)
        }
    }

    // MARK: Hi {Kid}!

    private var hello: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            Text("👋").font(.system(size: 52)).accessibilityHidden(true)
            let kid = pending?.kidName ?? ""
            OnbTitle(title: kid.isEmpty ? "Hi there!" : "Hi \(kid)!",
                     subtitle: helloSubtitle)
            OnbPrimaryButton(title: "Yes, that's me", action: startWaiting)
                .accessibilityIdentifier(OnbID.kidConfirm)
            OnbLinkButton(title: "Not you? Ask your grown-up for your own code") {
                pollTask?.cancel()
                pending = nil
                code = ""
                error = nil
                stage = .code
            }
            .accessibilityIdentifier(OnbID.kidNotYou)
        }
    }

    private var helloSubtitle: String {
        if let family = pending?.familyName, !family.isEmpty {
            return "This is the \(family) setup. Is that you?"
        }
        return "Is that you?"
    }

    // MARK: Waiting for approval

    private var waiting: some View {
        VStack(spacing: Space.xl) {
            ProgressView().scaleEffect(1.4).tint(Palette.accent).padding(.top, Space.xl)
            let kid = pending?.kidName ?? ""
            Text(kid.isEmpty ? "Ask your grown-up to tap Approve." : "Ask your grown-up to tap Approve for \(kid).")
                .font(Theme.font(20, weight: .semibold, relativeTo: .title3))
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            Text("Keep this screen open. It unlocks as soon as they do.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            OnbLinkButton(title: "Cancel") {
                pollTask?.cancel()
                pending = nil
                error = nil
                stage = viaFamilyCode ? .familyCode : .code
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }

    // MARK: Approved → passkey (or continue without)

    private var approved: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            Text("🎉").font(.system(size: 52)).accessibilityHidden(true)
            let kid = pending?.kidName ?? ""
            OnbTitle(title: kid.isEmpty ? "You're approved!" : "You're approved, \(kid)!",
                     subtitle: "Make your sign-in with Face ID or your passcode, so you can get back in next time.")
            OnbPrimaryButton(title: busy ? "Setting up…" : "Make my sign-in", busy: busy, action: finishWithPasskey)
                .accessibilityIdentifier(OnbID.kidPasskey)
            if passkeyDeclined {
                OnbSecondaryButton(title: "Continue without", enabled: !busy, action: continueWithout)
                    .accessibilityIdentifier(OnbID.kidContinueWithout)
            }
            if let error { OnbErrorText(message: error) }
            if passkeyDeclined {
                Text("Without one, a grown-up can show you a new code any time you need to sign in again.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func outcome(emoji: String, title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            Text(emoji).font(.system(size: 48)).accessibilityHidden(true)
            OnbTitle(title: title, subtitle: message)
            OnbPrimaryButton(title: "Try again") {
                error = nil
                pending = nil
                code = ""
                stage = viaFamilyCode ? .familyCode : .code
            }
        }
    }

    // MARK: Family code + name (whole-Fam-ETC families)

    private var familyCodeForm: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            OnbTitle(title: "Use a family code",
                     subtitle: "Type your family code and your name. A parent will let you in on their phone.")
            OnbTextField(title: "Family code", prompt: "e.g. ABC123", text: $familyCode,
                         capitalization: .characters, submitLabel: .next)
            OnbTextField(title: "Your name", prompt: "e.g. Arya", text: $name,
                         contentType: .givenName, capitalization: .words, submitLabel: .go,
                         onSubmit: submitFamilyCode)
            OnbPrimaryButton(title: busy ? "Asking…" : "Ask a parent to let me in", busy: busy,
                             enabled: canSubmitFamilyCode, action: submitFamilyCode)
            if let error { OnbErrorText(message: error) }
        }
    }

    private var canSubmitFamilyCode: Bool {
        !busy && !familyCode.trimmingCharacters(in: .whitespaces).isEmpty
            && !name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: Actions

    private func claim() {
        guard KidSetupCodeFormat.isComplete(code), !busy else { return }
        busy = true; error = nil
        let typed = code
        Task {
            do {
                let result = try await AuthService.shared.claimKidSetupCode(code: typed, deviceLabel: nil)
                await MainActor.run {
                    busy = false
                    viaFamilyCode = false
                    passkeyDeclined = false
                    pending = Pending(id: result.requestId, pollToken: result.pollToken,
                                      kidName: result.kidName, familyName: result.familyName)
                    stage = .hello
                }
            } catch {
                await MainActor.run { busy = false; self.error = friendlyClaim(error) }
            }
        }
    }

    private func submitFamilyCode() {
        guard canSubmitFamilyCode else { return }
        busy = true; error = nil
        let typedCode = familyCode
        let typedName = name
        Task {
            do {
                let request = try await AuthService.shared.requestKidAccess(inviteCode: typedCode, name: typedName)
                await MainActor.run {
                    busy = false
                    viaFamilyCode = true
                    passkeyDeclined = false
                    pending = Pending(id: request.id, pollToken: request.pollToken, kidName: request.name, familyName: nil)
                    startWaiting()
                }
            } catch {
                await MainActor.run { busy = false; self.error = friendlyKid(error) }
            }
        }
    }

    private func startWaiting() {
        error = nil
        stage = .waiting
        startPolling()
    }

    private func startPolling() {
        pollTask?.cancel()
        guard let req = pending else { return }
        pollTask = Task {
            // Poll every 3s until a terminal state. The request TTL is 30 min
            // server-side, so we cap at 200 ticks (~10 min) as a safety net.
            for _ in 0..<200 {
                if Task.isCancelled { return }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled { return }
                let status = (try? await AuthService.shared.kidAccessStatus(requestId: req.id, pollToken: req.pollToken)) ?? "pending"
                if Task.isCancelled { return }
                switch status {
                case "approved": await MainActor.run { stage = .approved }; return
                case "denied": await MainActor.run { stage = .denied }; return
                case "expired", "not_found": await MainActor.run { stage = .expired }; return
                default: break // still pending — keep polling
                }
            }
            await MainActor.run { if stage == .waiting { stage = .expired } }
        }
    }

    /// Passkey first. If creating one fails for any reason other than the kid cancelling the
    /// system sheet, fall straight back to the no-passkey sign-in (D7) so a flaky device
    /// never strands an approved kid.
    private func finishWithPasskey() {
        guard let req = pending, !busy else { return }
        busy = true; error = nil
        Task {
            do {
                try await AuthService.shared.completeKidPasskey(requestId: req.id, pollToken: req.pollToken)
                await signedIn()
            } catch {
                if OnbErrors.isCancellation(error) {
                    await MainActor.run {
                        busy = false
                        passkeyDeclined = true
                        self.error = "No problem. Try again, or tap Continue without."
                    }
                    return
                }
                await signInWithoutPasskey(req)
            }
        }
    }

    private func continueWithout() {
        guard let req = pending, !busy else { return }
        busy = true; error = nil
        Task { await signInWithoutPasskey(req) }
    }

    private func signInWithoutPasskey(_ req: Pending) async {
        do {
            try await AuthService.shared.kidSignInWithoutPasskey(requestId: req.id, pollToken: req.pollToken)
            await signedIn()
        } catch {
            await MainActor.run { busy = false; self.error = friendlyKid(error) }
        }
    }

    private func signedIn() async {
        APIClient.shared.track("kid_signin_complete")
        await MainActor.run {
            busy = false
            onFinish(nil)
        }
    }

    // MARK: Wording

    private func friendlyClaim(_ error: Error) -> String {
        if let e = error as? AuthServerError {
            if e.isSetupCodeInvalid {
                return "That code didn't work. Check it with your grown-up. A code only lasts 30 minutes, so they may need to show you a new one."
            }
            if e.status == 429 { return "That's a lot of tries. Wait a few minutes, then try again." }
        }
        return friendlyKid(error)
    }

    private func friendlyKid(_ error: Error) -> String {
        if let e = error as? AuthServerError {
            switch e.code {
            case "session_already_issued":
                return "This code was already used to sign in. Ask your grown-up to show you a new one."
            case "not_approved":
                return "Your grown-up hasn't approved yet. Ask them to tap Approve."
            case "not_found":
                return "That request is gone. Ask your grown-up for a new code."
            default: break
            }
        }
        if let e = error as? AuthError, case .options = e {
            return "Couldn't reach your family. Check your connection and try again."
        }
        return OnbErrors.friendly(error)
    }
}
