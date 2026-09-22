import PhotosUI
import SwiftUI

struct HomeworkStartSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let item: HomeworkItem

    @State private var showConfirmation = false
    @State private var isSending = false
    @State private var resultMessage: String?
    @State private var sendError: String?
    @State private var assistedPlan: LocalHomeworkStartPlan?
    @State private var assistanceNote = "Preparing an on-device starting guide…"
    @State private var sendTask: Task<Void, Never>?
    @State private var instructionPhoto: PhotosPickerItem?
    @State private var isReadingPhoto = false
    @State private var photoGuideTask: Task<Void, Never>?
    @State private var photoGuideToken = UUID()
    @State private var guideToken = UUID()

    private var plan: HomeworkStartPlan { .make(for: item) }
    private var helpMessage: String { HomeworkStartPlan.familyHelpMessage(for: item) }
    private var displayedSteps: [String] {
        guard let assistedPlan else { return plan.steps }
        return Array(([assistedPlan.firstStep] + plan.steps).uniqued().prefix(4))
    }
    private var displayedHints: [String] {
        guard let assistedPlan, !assistedPlan.hints.isEmpty else { return plan.hints }
        return assistedPlan.hints
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.xxl) {
                    intro
                    planSection
                    hintsSection
                    familyHelpSection
                }
                .padding(Space.xl)
                .frame(maxWidth: 680, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.bg)
            .navigationTitle("Help Me Start")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .confirmationDialog("Send this to family chat?", isPresented: $showConfirmation, titleVisibility: .visible) {
            Button("Send help request") { sendHelpRequest() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(helpMessage)
        }
        .alert(resultMessage == nil ? "Could not send" : "Request sent",
               isPresented: Binding(get: { resultMessage != nil || sendError != nil }, set: { shown in
                   if !shown { resultMessage = nil; sendError = nil }
               })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(resultMessage ?? sendError ?? "Try again.")
        }
        .task(id: item.id) { await loadOnDeviceGuide() }
        .onChange(of: instructionPhoto) { _, item in usePhotoInstructions(item) }
        .onDisappear {
            sendTask?.cancel()
            photoGuideTask?.cancel()
            photoGuideToken = UUID()
            guideToken = UUID()
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Text(item.title).font(Typography.title).foregroundStyle(Palette.text)
            Text("A small starting plan—not answers. Nothing here changes or completes the assignment.")
                .font(Typography.body).foregroundStyle(Palette.textSecond)
            Text(assistanceNote)
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
            PhotosPicker(selection: $instructionPhoto, matching: .images) {
                HStack(spacing: Space.sm) {
                    if isReadingPhoto { ProgressView().controlSize(.small) }
                    Label(isReadingPhoto ? "Reading photo…" : "Use photo instructions", systemImage: "text.viewfinder")
                }
                .font(Typography.body.weight(.semibold))
                .frame(minHeight: 44)
            }
            .disabled(isReadingPhoto || isSending)
            Text("Choose a screenshot or photo of the instructions. It is read on this device and is not saved or sent to chat.")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
        }
    }

    private var planSection: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            MicroLabel(text: "Start with these steps")
            ForEach(Array(displayedSteps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: Space.md) {
                    Text("\(index + 1)")
                        .font(Typography.monoSmall)
                        .foregroundStyle(Palette.onAccent)
                        .frame(width: 28, height: 28)
                        .background(Palette.accent, in: Circle())
                    Text(step).font(Typography.body).foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
            }
        }
        .padding(Space.xl)
        .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    private var hintsSection: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            MicroLabel(text: "Hints to think with")
            ForEach(displayedHints, id: \.self) { hint in
                Label(hint, systemImage: "lightbulb")
                    .font(Typography.body)
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var familyHelpSection: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            MicroLabel(text: "Still stuck?")
            Text("You can ask your family to help you understand the first step. You will see the exact message before it sends.")
                .font(Typography.body).foregroundStyle(Palette.textSecond)
            Button { showConfirmation = true } label: {
                HStack {
                    if isSending { ProgressView().tint(Palette.onAccent) }
                    Label(isSending ? "Sending…" : "Ask family for help", systemImage: "message.fill")
                        .font(Typography.body.weight(.semibold))
                }
                .foregroundStyle(Palette.onAccent)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            }
            .buttonStyle(PressableStyle(scale: 0.98))
            .disabled(isSending || resultMessage != nil)
        }
    }

    private func sendHelpRequest() {
        guard !isSending, resultMessage == nil,
              let user = store.me, user.role == "kid", let kidID = user.kidId,
              let family = store.family, family.kids.contains(where: { $0.id == kidID }) else { return }
        isSending = true
        let userID = user.id
        let familyID = family.id
        sendTask = Task {
            defer { isSending = false }
            do {
                guard !Task.isCancelled, store.me?.id == userID, store.me?.kidId == kidID,
                      store.family?.id == familyID else { return }
                _ = try await APIClient.shared.sendChatMessage(
                    text: helpMessage,
                    senderType: "kid",
                    senderId: kidID
                )
                guard !Task.isCancelled, store.me?.id == userID, store.me?.kidId == kidID,
                      store.family?.id == familyID else { return }
                Haptics.notify(.success)
                resultMessage = "Your family can now see the request in family chat."
            } catch {
                guard !Task.isCancelled, store.me?.id == userID, store.family?.id == familyID else { return }
                sendError = error.localizedDescription
            }
        }
    }

    private func loadOnDeviceGuide() async {
        await loadOnDeviceGuide(instructions: item.notes ?? item.title)
    }

    private func loadOnDeviceGuide(instructions: String) async {
        let token = UUID()
        guideToken = token
        assistedPlan = nil
        let request = LocalHomeworkStartRequest(
            title: item.title,
            subject: item.subject,
            instructions: instructions,
            nextStep: item.firstIncompleteChecklistItem?.text
        )
        do {
            let response = try await LocalLearningAssistant.shared.homeworkStart(for: request)
            guard !Task.isCancelled, guideToken == token else { return }
            assistedPlan = response
            assistanceNote = "Generated privately on this device from the assignment instructions."
        } catch {
            guard !Task.isCancelled, guideToken == token else { return }
            assistanceNote = "Using the built-in starting guide; on-device language assistance is not available."
        }
    }

    private func usePhotoInstructions(_ item: PhotosPickerItem?) {
        guard let item else { return }
        photoGuideTask?.cancel()
        let token = UUID()
        photoGuideToken = token
        isReadingPhoto = true
        photoGuideTask = Task {
            defer { if photoGuideToken == token { isReadingPhoto = false } }
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw SchoolNoticeOCRError.invalidImage
                }
                let instructions = try await SchoolNoticeOCR.recognize(imageData: data)
                guard !Task.isCancelled, photoGuideToken == token else { return }
                await loadOnDeviceGuide(instructions: instructions)
                guard !Task.isCancelled, photoGuideToken == token else { return }
                assistanceNote = assistedPlan == nil
                    ? "The photo was read on this device. Using the built-in starting guide."
                    : "Generated privately on this device from the photographed instructions."
            } catch {
                guard !Task.isCancelled, photoGuideToken == token else { return }
                assistanceNote = "The photo could not be read. Try a clearer image or use the saved assignment instructions."
            }
        }
    }
}

private extension Array where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
