import SwiftUI

enum WatchPairingInput {
    static let maxLength = 8
    static let alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    static func normalize(_ value: String) -> String {
        String(value.uppercased().filter { alphabet.contains($0) }.prefix(maxLength))
    }
    static func isValid(_ value: String) -> Bool {
        value.count == maxLength && value.allSatisfy { alphabet.contains($0) }
    }
}

struct WatchPairingView: View {
    let client: WatchPairingClient
    let credentialStore: WatchCredentialStore
    let onPaired: () -> Void

    @State private var code = ""
    @State private var isPairing = false
    @State private var errorMessage: String?

    init(client: WatchPairingClient = URLSessionWatchAPIClient(),
         credentialStore: WatchCredentialStore = KeychainWatchCredentialStore(),
         onPaired: @escaping () -> Void = {}) {
        self.client = client
        self.credentialStore = credentialStore
        self.onPaired = onPaired
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 9) {
                Image(systemName: "applewatch")
                    .font(.title2)
                    .foregroundStyle(.tint)
                Text("Connect Fam ETC")
                    .font(.headline)
                Text("Ask a parent to create a watch code in Fam ETC, then enter it here.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Pairing code", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .onChange(of: code) { _, value in
                        code = WatchPairingInput.normalize(value)
                        errorMessage = nil
                    }
                    .accessibilityLabel("Watch pairing code")
                Button {
                    Task { await pair() }
                } label: {
                    HStack {
                        Text(isPairing ? "Connecting…" : "Connect watch")
                        Spacer(minLength: 0)
                        if isPairing { ProgressView() }
                    }
                }
                .disabled(isPairing || !WatchPairingInput.isValid(code))
                .accessibilityHint("Enter the eight-character code created by a parent.")
                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .accessibilityLabel("Pairing error: \(errorMessage)")
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .navigationTitle("Pair watch")
    }

    @MainActor
    private func pair() async {
        guard WatchPairingInput.isValid(code), !isPairing else { return }
        isPairing = true
        errorMessage = nil
        defer { isPairing = false }
        do {
            let credential = try await client.claimPairing(code: code, deviceLabel: "Fam ETC watch")
            try credentialStore.save(credential)
            onPaired()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
