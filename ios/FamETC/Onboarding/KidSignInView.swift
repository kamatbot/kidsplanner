import SwiftUI

// Native kid sign-in — the on-device counterpart to the web login.html kid panes.
// The kid enters the family invite code + their name (no parent session here),
// a parent approves remotely, then the kid registers a device passkey and is
// signed straight in. Drives AuthService.requestKidAccess → poll kidAccessStatus
// → completeKidPasskey. See server.js "Kid sign-in" and lib/kid-access.js.
struct KidSignInView: View {
    /// Called once the kid is signed in (passkey registered, session established).
    let onFinish: (String?) -> Void
    /// Called when the kid backs out to the role chooser.
    let onBack: () -> Void

    private enum Stage { case form, waiting, approved, denied, expired }

    @State private var stage: Stage = .form
    @State private var code = ""
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    @State private var request: AuthService.KidRequest?
    @State private var pollTask: Task<Void, Never>?

    private var accent: Color { Palette.accent }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("✨").font(.system(size: 18))
                Text("Fam ETC").font(.system(size: 18, weight: .bold)).foregroundColor(Palette.text)
                Spacer()
            }
            .padding(.top, 8)

            Spacer(minLength: 12)

            Group {
                switch stage {
                case .form: form
                case .waiting: waiting
                case .approved: approved
                case .denied: outcome(emoji: "🙅", title: "Not right now",
                                       message: "A parent didn't approve this time. Check with them and try again.")
                case .expired: outcome(emoji: "⏳", title: "That request expired",
                                       message: "Requests time out after a while. Let's try again.")
                }
            }

            Spacer(minLength: 12)

            if stage == .form {
                Text("Back")
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(Palette.textSecond)
                    .padding(.vertical, 10).padding(.horizontal, 24).contentShape(Rectangle())
                    .onTapGesture { onBack() }
                    .padding(.bottom, 16)
            }
        }
        .padding(.horizontal, 24)
        .foregroundColor(Palette.text)
        .onDisappear { pollTask?.cancel() }
    }

    // MARK: Enter invite code + name

    private var form: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Let's get you in 🧒").font(.system(size: 28, weight: .bold))
                Text("Type your family code and your name. A parent will let you in on their phone.")
                    .font(.system(size: 15)).foregroundColor(Palette.textSecond)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Family code").font(.system(size: 13)).foregroundColor(Palette.textSecond)
                TextField("e.g. ABC123", text: $code)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Text("Your name").font(.system(size: 13)).foregroundColor(Palette.textSecond).padding(.top, 4)
                TextField("e.g. Arya", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 16).fill(Palette.panel))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Palette.border, lineWidth: 1))

            primaryButton(busy ? "Asking…" : "Ask a parent to let me in 🙋", enabled: canSubmit) { submit() }

            if let error {
                Text(error).font(.system(size: 13)).foregroundColor(Palette.red)
                    .multilineTextAlignment(.leading)
            }
        }
    }

    private var canSubmit: Bool {
        !busy && !code.trimmingCharacters(in: .whitespaces).isEmpty
            && !name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: Waiting for approval

    private var waiting: some View {
        VStack(spacing: 18) {
            ProgressView().scaleEffect(1.4).tint(accent)
            Text("Waiting for a parent to approve\n\(request?.name ?? name)…")
                .font(.system(size: 17, weight: .semibold)).multilineTextAlignment(.center)
            Text("Keep this screen open — it'll unlock as soon as a parent taps approve.")
                .font(.system(size: 13)).foregroundColor(Palette.textSecond).multilineTextAlignment(.center)
            Button {
                pollTask?.cancel()
                stage = .form
            } label: {
                Text("Cancel").font(.system(size: 14, weight: .semibold)).foregroundColor(Palette.textSecond)
            }
            .padding(.top, 4)
        }
    }

    // MARK: Approved → register passkey

    private var approved: some View {
        VStack(spacing: 18) {
            Text("🎉").font(.system(size: 52))
            Text("You're approved, \(request?.name ?? name)!")
                .font(.system(size: 22, weight: .bold)).multilineTextAlignment(.center)
            Text("Set up this device so you can sign in with Face ID or your passcode next time.")
                .font(.system(size: 14)).foregroundColor(Palette.textSecond).multilineTextAlignment(.center)
            primaryButton(busy ? "Setting up…" : "Set up this device 🔑", enabled: !busy) { finishSetup() }
            if let error {
                Text(error).font(.system(size: 13)).foregroundColor(Palette.red).multilineTextAlignment(.center)
            }
        }
    }

    private func outcome(emoji: String, title: String, message: String) -> some View {
        VStack(spacing: 16) {
            Text(emoji).font(.system(size: 48))
            Text(title).font(.system(size: 22, weight: .bold))
            Text(message).font(.system(size: 14)).foregroundColor(Palette.textSecond).multilineTextAlignment(.center)
            primaryButton("Try again", enabled: true) { error = nil; stage = .form }
        }
    }

    // MARK: Actions

    private func submit() {
        guard canSubmit else { return }
        busy = true; error = nil
        Task {
            do {
                let req = try await AuthService.shared.requestKidAccess(inviteCode: code, name: name)
                await MainActor.run { request = req; busy = false; stage = .waiting; startPolling() }
            } catch {
                await MainActor.run { busy = false; self.error = friendly(error) }
            }
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        guard let req = request else { return }
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
                case "denied":   await MainActor.run { stage = .denied }; return
                case "expired", "not_found": await MainActor.run { stage = .expired }; return
                default: break // still pending — keep polling
                }
            }
            await MainActor.run { if stage == .waiting { stage = .expired } }
        }
    }

    private func finishSetup() {
        guard let req = request, !busy else { return }
        busy = true; error = nil
        Task {
            do {
                try await AuthService.shared.completeKidPasskey(requestId: req.id, pollToken: req.pollToken)
                APIClient.shared.track("kid_signin_complete")
                await MainActor.run { busy = false; onFinish(nil) }
            } catch {
                await MainActor.run {
                    busy = false
                    if let e = error as? AuthError, e.isCancellation { return }
                    self.error = friendly(error)
                }
            }
        }
    }

    private func friendly(_ error: Error) -> String {
        if let e = error as? AuthError {
            switch e {
            case .verify(let m): return m
            case .options: return "Couldn't reach the family. Double-check the code and try again."
            case .registration: return "That device setup didn't work — try again."
            case .unsupported: return "Passkeys aren't available on this device."
            case .cancelled: return "Cancelled."
            }
        }
        return error.localizedDescription
    }

    private func primaryButton(_ title: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 17, weight: .bold))
                .foregroundColor(Palette.onAccent)
                .frame(maxWidth: .infinity).frame(height: 56)
                .background(accent)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .shadow(color: accent.opacity(0.28), radius: 18, x: 0, y: 10)
        }
        .buttonStyle(.plain)
        .opacity(enabled ? 1 : 0.6)
        .disabled(!enabled)
    }
}
