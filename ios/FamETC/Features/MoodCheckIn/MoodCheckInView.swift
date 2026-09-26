import SwiftUI

struct MoodCheckInView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var model = MoodCheckInModel()
    @State private var owner = ""

    private var identity: String {
        guard !store.needsAuth, store.me?.role == "kid", let id = store.me?.id,
              let family = store.family?.id else { return "" }
        return id + ":" + family
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("How’s your energy?") {
                    Text("Optional. Your choice isn’t saved. Only Send to family shares a message.")
                        .foregroundStyle(.secondary)
                    ForEach(MoodCheckInModel.Energy.allCases, id: \.self) { energy in
                        Button { model.select(energy) } label: {
                            HStack {
                                Text(energy.rawValue)
                                Spacer()
                                if model.energy == energy { Image(systemName: "checkmark") }
                            }
                            .frame(minHeight: 44)
                        }
                        .accessibilityAddTraits(model.energy == energy ? .isSelected : [])
                        .disabled(model.sending || model.attempted)
                    }
                    Button("Preview sharing") { model.preview() }
                        .disabled(model.energy == nil || model.sending || model.attempted)
                    Button("Ask for help…") { model.preview(help: true) }
                        .disabled(model.energy == nil || model.sending || model.attempted)
                }
                if model.previewing {
                    Section("Message preview") {
                        Text("Family chat members can see the message you send. It stays in chat.")
                        TextField("Edit before sending", text: $model.draft, axis: .vertical)
                            .lineLimit(3...8)
                            .disabled(model.sending || model.attempted)
                            .accessibilityLabel("Message preview — edit before sending")
                        Button(model.sending ? "Sending…" : model.attempted ? "Retry send to family" : "Send to family") {
                            Task { await confirm() }
                        }
                        .disabled(model.sending || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.draft.count > 2000 || owner != identity)
                    }
                }
                if !model.status.isEmpty {
                    Section { Text(model.status).accessibilityAddTraits(.updatesFrequently) }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("study.energy.form")
            .scrollContentBackground(.hidden)
            .background(Palette.frBg)
            .font(Typography.body)
            .disabled(identity.isEmpty || owner != identity)
            .tint(Palette.accent)
            .navigationTitle("Energy check-in")
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { model.clear(); dismiss() }.disabled(model.sending)
            } }
        }
        .presentationSizing(.page)
        .interactiveDismissDisabled(model.sending)
        .onAppear { owner = identity }
        .onChange(of: identity) { _, _ in model.clear(); dismiss() }
        .onDisappear { model.clear() }
    }

    @MainActor private func confirm() async {
        await model.confirm(identity: owner, currentIdentity: { identity }) { text, messageID in
            guard owner == identity, !identity.isEmpty else { throw CancellationError() }
            let message = try await APIClient.shared.sendChatMessage(
                text: text, senderType: "kid", senderId: store.me?.kidId ?? "",
                clientMessageId: messageID,
                expectedContext: ["userId": store.me?.id ?? "", "familyId": store.family?.id ?? ""])
            guard owner == identity else { throw CancellationError() }
            store.mergeIncoming([message], roomId: familyRoomId)
        }
    }
}
