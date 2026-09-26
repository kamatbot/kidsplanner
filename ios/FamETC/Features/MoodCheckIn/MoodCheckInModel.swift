import Foundation
import Observation

/// View-owned only: never encode, cache, log, or include in notes/analytics.
@MainActor @Observable
final class MoodCheckInModel {
    enum Energy: String, CaseIterable { case low = "Low", okay = "Okay", full = "Full" }
    private(set) var energy: Energy?
    var draft = ""
    private(set) var previewing = false
    private(set) var sending = false
    private(set) var attempted = false
    private(set) var status = ""
    private var messageID = UUID().uuidString
    private var generation = 0

    func select(_ value: Energy) {
        guard !sending, !attempted else { return }
        energy = value
        draft = ""; previewing = false
        status = ""
    }
    func preview(help: Bool = false) {
        guard let energy, !sending, !attempted else { return }
        draft = "My energy is \(energy.rawValue.lowercased()) today." + (help ? " Could someone help me with my next step?" : "")
        messageID = UUID().uuidString
        previewing = true
    }
    func clear() {
        generation += 1
        energy = nil; draft = ""; previewing = false; sending = false; attempted = false; status = ""
        messageID = UUID().uuidString
    }
    func confirm(identity: String, currentIdentity: () -> String,
                 send: (String, String) async throws -> Void) async {
        guard !identity.isEmpty, identity == currentIdentity(), previewing, !sending else { clearIfChanged(identity, currentIdentity); return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 2000 else { return }
        sending = true; attempted = true; status = ""
        let token = generation
        do {
            try await send(text, messageID)
            guard token == generation, identity == currentIdentity() else { clearIfChanged(identity, currentIdentity); return }
            clear()
            status = "Sent to family chat."
        } catch {
            guard token == generation, identity == currentIdentity() else { clearIfChanged(identity, currentIdentity); return }
            sending = false
            status = "Send not confirmed. Retry sends the same message once. You can also check family chat."
        }
    }
    private func clearIfChanged(_ identity: String, _ current: () -> String) {
        if identity != current() { clear() }
    }
}
