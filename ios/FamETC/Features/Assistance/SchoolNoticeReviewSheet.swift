import PhotosUI
import SwiftUI
import UIKit

/// Parent-only review flow for turning a school screenshot, photo, or pasted
/// notice into an ordinary family calendar event. Extraction never saves.
struct SchoolNoticeReviewSheet: View {
    private enum InputMode: String, CaseIterable, Identifiable {
        case photo = "Photo"
        case text = "Text"
        var id: String { rawValue }
    }

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var photoItem: PhotosPickerItem?
    @State private var photoData: Data?
    @State private var sourceText = ""
    @State private var inputMode: InputMode = .photo
    @State private var draft = SchoolNoticeDraft()
    @State private var isLoadingPhoto = false
    @State private var isExtracting = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var didSave = false
    @State private var submissionUncertain = false
    @State private var assistanceNote: String?
    @State private var photoLoadToken = UUID()
    @State private var extractionToken = UUID()
    @State private var extractionTask: Task<Void, Never>?

    private var hasInput: Bool {
        switch inputMode {
        case .photo: return photoData != nil
        case .text: return !sourceText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
    private var isVerifiedParent: Bool {
        guard let user = store.me, user.role != "kid", let family = store.family else { return false }
        return family.parentIds.contains(user.id)
    }

    var body: some View {
        NavigationStack {
            Form {
                if isVerifiedParent {
                    sourceSection
                    reviewSection
                } else {
                    ContentUnavailableView("Parents only", systemImage: "lock.fill",
                                           description: Text("Ask a parent to review and add school notices."))
                }
            }
            .navigationTitle("Review School Notice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if isVerifiedParent {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(isSaving ? "Saving…" : "Add") { save() }
                            .fontWeight(.bold)
                            .disabled(!draft.canSave || isSaving || isExtracting || didSave || submissionUncertain)
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
        .onChange(of: photoItem) { _, item in loadPhoto(item) }
        .onChange(of: inputMode) { _, _ in sourceChanged() }
        .onDisappear {
            extractionTask?.cancel()
            extractionToken = UUID()
            photoLoadToken = UUID()
        }
        .alert(didSave ? "Added to the family plan" : (submissionUncertain ? "Check Calendar" : "Could not continue"),
               isPresented: Binding(get: { didSave || errorMessage != nil || submissionUncertain }, set: { shown in
                   if !shown { didSave = false; errorMessage = nil }
               })) {
            Button(submissionUncertain ? "Close" : "Done") {
                if didSave || submissionUncertain { dismiss() }
            }
        } message: {
            Text(didSave
                 ? "The reviewed school event is now on the family calendar."
                 : (submissionUncertain
                    ? "The connection ended before Fam ETC could confirm the result. Check Calendar before trying again so you do not add a duplicate."
                    : (errorMessage ?? "Try again.")))
        }
    }

    private var sourceSection: some View {
        Section {
            Picker("Notice source", selection: $inputMode) {
                ForEach(InputMode.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .disabled(isExtracting || isSaving)
            if inputMode == .photo {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label(photoData == nil ? "Choose screenshot or photo" : "Choose a different image",
                          systemImage: "photo.on.rectangle")
                        .frame(minHeight: 44)
                }
                .disabled(isExtracting || isSaving)
                if isLoadingPhoto {
                    HStack { ProgressView(); Text("Loading image…") }
                } else if let photoData, let image = UIImage(data: photoData) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 220)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                        .accessibilityLabel("Selected school notice image")
                }
            } else {
                TextField("Paste or type the notice", text: $sourceText, axis: .vertical)
                    .lineLimit(4...10)
                    .disabled(isExtracting || isSaving)
            }
            Button { extract() } label: {
                HStack {
                    if isExtracting { ProgressView().controlSize(.small) }
                    Label(isExtracting ? "Extracting…" : "Extract for review", systemImage: "text.viewfinder")
                }
                .frame(minHeight: 44)
            }
            .disabled(!hasInput || isExtracting || isSaving)
        } header: {
            Text("Notice")
        } footer: {
            Text(assistanceNote ?? "Nothing is read or added until you tap Extract for review. Text recognition and available assistance stay on this device, and every field remains editable.")
        }
        .disabled(isExtracting || isSaving)
    }

    private var reviewSection: some View {
        Section {
            TextField("Event title", text: $draft.title)
            if draft.date == nil {
                Label("Date not found — choose the correct date before adding.", systemImage: "calendar.badge.exclamationmark")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.warn)
                    .accessibilityLabel("Date required. The notice did not include a date.")
                Button("Choose date") { draft.date = Calendar.current.startOfDay(for: Date()) }
                    .frame(minHeight: 44)
            } else {
                DatePicker("Date", selection: Binding(get: { draft.date ?? Date() }, set: { draft.date = $0 }), displayedComponents: .date)
                Button("Clear date", role: .destructive) { draft.date = nil }
            }
            Toggle("Set a time", isOn: Binding(get: { draft.time != nil }, set: { enabled in
                draft.time = enabled ? (draft.time ?? Date()) : nil
            }))
            if draft.time != nil {
                DatePicker("Time", selection: Binding(get: { draft.time ?? Date() }, set: { draft.time = $0 }), displayedComponents: .hourAndMinute)
            }
            Picker("For", selection: $draft.kidID) {
                Text("Whole family").tag(String?.none)
                ForEach(store.kids) { kid in Text(kid.name).tag(Optional(kid.id)) }
            }
            TextField("Notes", text: $draft.notes, axis: .vertical).lineLimit(2...6)
            TextField("Things to bring", text: $draft.thingsToBring, axis: .vertical).lineLimit(1...4)
        } header: {
            Text("Review before adding")
        } footer: {
            Text("Adding this event does not create or complete homework.")
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem?) {
        let token = UUID()
        photoLoadToken = token
        extractionTask?.cancel()
        extractionToken = UUID()
        isExtracting = false
        sourceText = ""
        draft = SchoolNoticeDraft()
        assistanceNote = nil
        guard let item else { photoData = nil; isLoadingPhoto = false; return }
        inputMode = .photo
        isLoadingPhoto = true
        Task {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw SchoolNoticeOCRError.invalidImage
                }
                guard photoLoadToken == token else { return }
                photoData = data
            } catch {
                guard photoLoadToken == token else { return }
                photoData = nil
                errorMessage = error.localizedDescription
            }
            if photoLoadToken == token { isLoadingPhoto = false }
        }
    }

    private func extract() {
        guard !isExtracting else { return }
        let token = UUID()
        extractionToken = token
        isExtracting = true
        errorMessage = nil
        let mode = inputMode
        let capturedText = sourceText
        let capturedPhoto = photoData
        extractionTask = Task {
            defer { if extractionToken == token { isExtracting = false } }
            do {
                let recognized: String
                switch mode {
                case .text:
                    recognized = capturedText
                case .photo:
                    guard let capturedPhoto else { throw SchoolNoticeOCRError.invalidImage }
                    recognized = try await SchoolNoticeOCR.recognize(imageData: capturedPhoto)
                }
                guard !Task.isCancelled, extractionToken == token else { return }
                if recognized.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    throw LocalLearningAssistantError.emptySource
                }
                var reviewed = SchoolNoticeExtractor.draft(from: recognized)
                do {
                    let assisted = try await LocalLearningAssistant.shared.schoolNoticeDraft(from: recognized)
                    if let title = assisted.title, !title.isEmpty { reviewed.title = String(title.prefix(120)) }
                    if let notes = assisted.notes { reviewed.notes = notes }
                    if !assisted.thingsToBring.isEmpty { reviewed.thingsToBring = assisted.thingsToBring.joined(separator: ", ") }
                    // Date and time remain owned by the conservative parser.
                    // A nil may mean missing or conflicting source text; model
                    // output must never collapse that ambiguity into one choice.
                    assistanceNote = "On-device assistance prepared this draft. Check every field against the notice before adding."
                } catch {
                    assistanceNote = "A built-in on-device extractor prepared this draft. Check every field against the notice before adding."
                }
                guard !Task.isCancelled, extractionToken == token else { return }
                draft = reviewed
                Haptics.notify(.success)
            } catch {
                guard !Task.isCancelled, extractionToken == token else { return }
                errorMessage = error.localizedDescription
            }
        }
    }

    private func sourceChanged() {
        extractionTask?.cancel()
        extractionToken = UUID()
        isExtracting = false
        draft = SchoolNoticeDraft()
        assistanceNote = nil
        errorMessage = nil
    }

    private func save() {
        guard isVerifiedParent, !isSaving, !didSave, draft.canSave, let date = draft.date,
              let userID = store.me?.id, let familyID = store.family?.id else { return }
        isSaving = true
        errorMessage = nil
        let reviewed = draft
        Task {
            defer { isSaving = false }
            do {
                guard store.me?.id == userID, store.family?.id == familyID, isVerifiedParent else { return }
                _ = try await APIClient.shared.addFamilyEvent(
                    title: reviewed.cleanTitle,
                    date: EventFmt.ymd.string(from: date),
                    time: reviewed.time.map { EventFmt.hm.string(from: $0) },
                    notes: reviewed.combinedNotes,
                    category: "school",
                    kidId: reviewed.kidID
                )
                guard store.me?.id == userID, store.family?.id == familyID, isVerifiedParent else { return }
                if let refreshed = try? await APIClient.shared.familyEvents() {
                    guard store.me?.id == userID, store.family?.id == familyID, isVerifiedParent else { return }
                    store.familyEvents = refreshed
                    await NotificationScheduler.reschedule(events: refreshed, homework: store.homework, kids: store.kids)
                }
                Haptics.notify(.success)
                didSave = true
            } catch {
                if case APIError.transport = error {
                    submissionUncertain = true
                } else {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }
}

/// Stable entry-point name used by Today and other parent surfaces.
typealias SchoolNoticeSheet = SchoolNoticeReviewSheet
