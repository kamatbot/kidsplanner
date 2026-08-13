import SwiftUI
import PhotosUI
import UIKit

// MARK: - Pantry photo scan → AI review → bulk add
//
// Flow: queue up to eight camera/library photos → JPEG-compress and parse each
// only after the user taps Generate list → merge duplicate detections → editable
// review list → confirm bulk-adds via POST /api/meals/pantry/bulk.
//
// Camera capture is SIMULATOR-ONLY UNVERIFIED — UIImagePickerController's
// .camera source isn't available in the Simulator; this view detects that and
// steers to the PhotosPicker (library) path instead, which is the one actually
// exercised in this build/test pass. Needs a real device to verify camera capture.
struct PantryScannerView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var showCamera = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var queuedImages: [UIImage] = []
    @State private var isParsing = false
    @State private var parsingCompleted = 0
    @State private var parsingTotal = 0
    @State private var reviewItems: [ScannedPantryItem] = []
    @State private var errorMessage: String?
    @State private var isSaving = false

    private let maxPhotos = 8
    private var cameraAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }
    private var remainingPhotoSlots: Int { max(0, maxPhotos - queuedImages.count) }

    var body: some View {
        NavigationStack {
            ZStack {
                ScreenBackground()
                if isParsing {
                    parsingView
                } else if !reviewItems.isEmpty {
                    reviewView
                } else {
                    pickerView
                }
            }
            .navigationTitle("Scan Pantry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if !reviewItems.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(isSaving ? "Adding…" : "Add \(reviewItems.count)") { confirmAdd() }
                            .fontWeight(.bold)
                            .disabled(isSaving || reviewItems.isEmpty)
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                showCamera = false
                if let image, queuedImages.count < maxPhotos {
                    queuedImages.append(image)
                    errorMessage = nil
                }
            }
            .ignoresSafeArea()
        }
        .onChange(of: photoItems) { _, newItems in
            guard !newItems.isEmpty else { return }
            photoItems = []
            Task {
                var loaded: [UIImage] = []
                for item in newItems.prefix(remainingPhotoSlots) {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        loaded.append(image)
                    }
                }
                queuedImages.append(contentsOf: loaded.prefix(remainingPhotoSlots))
                if loaded.count < newItems.count {
                    errorMessage = "Some selected photos couldn't be loaded. Try selecting those photos again."
                } else {
                    errorMessage = nil
                }
            }
        }
    }

    // MARK: Pick

    private var pickerView: some View {
        VStack(spacing: Space.lg) {
            Spacer()
            Image(systemName: "camera.fill")
                .font(.system(size: 40, weight: .semibold))
                .foregroundStyle(Palette.accent)
            Text(queuedImages.isEmpty ? "Scan your pantry or fridge" : "\(queuedImages.count) photo\(queuedImages.count == 1 ? "" : "s") ready")
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.text)
            Text(queuedImages.isEmpty
                 ? "Photograph each shelf or section. Fam ETC will combine everything into one list for you to review."
                 : "Add another angle, or generate one combined pantry list when you’re ready.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .multilineTextAlignment(.center)
            if let errorMessage {
                Text(errorMessage)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.warn)
                    .multilineTextAlignment(.center)
            }
            if !queuedImages.isEmpty {
                queuedPhotoStrip
            }
            if cameraAvailable, remainingPhotoSlots > 0 {
                AccentButton(title: queuedImages.isEmpty ? "Take a photo" : "Take another photo", systemImage: "camera.fill") {
                    showCamera = true
                }
            } else if !cameraAvailable {
                // ponytail: no device to verify camera capture in this pass — the
                // Simulator has no camera hardware, so this branch is what's
                // actually reachable/tested here.
                Text("Camera isn't available in the Simulator — use the library instead.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            if remainingPhotoSlots > 0 {
                PhotosPicker(selection: $photoItems, maxSelectionCount: remainingPhotoSlots, matching: .images) {
                    Label(queuedImages.isEmpty ? "Choose photos" : "Add from library", systemImage: "photo.on.rectangle.angled")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.accent)
                        .frame(minHeight: 44)
                }
            } else {
                Text("Maximum of \(maxPhotos) photos reached")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            if !queuedImages.isEmpty {
                AccentButton(title: "Generate list from \(queuedImages.count) photo\(queuedImages.count == 1 ? "" : "s")", systemImage: "sparkles") {
                    generateList()
                }
            }
            Spacer()
        }
        .padding(Space.xl)
    }

    private var parsingView: some View {
        VStack(spacing: Space.md) {
            ProgressView()
            Text("Reading photo \(min(parsingCompleted + 1, parsingTotal)) of \(parsingTotal)…")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
            Text("We’ll combine duplicate items into one review list.")
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
                .multilineTextAlignment(.center)
        }
        .padding(Space.xl)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Reading pantry photos. \(parsingCompleted) of \(parsingTotal) complete.")
    }

    private var queuedPhotoStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.sm) {
                ForEach(Array(queuedImages.enumerated()), id: \.offset) { index, image in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 82, height: 82)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                        Button {
                            queuedImages.remove(at: index)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 22, weight: .bold))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, Color.black.opacity(0.62))
                        }
                        .buttonStyle(.plain)
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("Remove photo \(index + 1)")
                    }
                    .accessibilityElement(children: .contain)
                }
            }
            .padding(.vertical, Space.xs)
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Selected pantry photos")
    }

    // MARK: Review

    private var reviewView: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Space.md) {
                Text("\(reviewItems.count) item\(reviewItems.count == 1 ? "" : "s") found — review before adding.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecond)
                ForEach($reviewItems) { $item in
                    ScannedItemRow(item: $item) {
                        reviewItems.removeAll { $0.id == item.id }
                    }
                }
                if let errorMessage {
                    Text(errorMessage).font(Typography.caption).foregroundStyle(Palette.warn)
                }
            }
            .padding(Space.lg)
        }
        .contentMargins(.bottom, Layout.tabBarClearance, for: .scrollContent)
    }

    // MARK: Actions

    private func generateList() {
        let images = queuedImages
        guard !images.isEmpty, !isParsing else { return }
        errorMessage = nil
        isParsing = true
        parsingCompleted = 0
        parsingTotal = images.count
        Task {
            var merged: [ScannedPantryItem] = []
            var failures = 0
            var lastError: Error?
            for image in images {
                guard let base64 = Self.jpegBase64(image) else {
                    failures += 1
                    parsingCompleted += 1
                    continue
                }
                do {
                    let items = try await APIClient.shared.parsePantryPhoto(base64: base64)
                    merged = PantryScanMerger.merge(existing: merged, incoming: items)
                } catch {
                    failures += 1
                    lastError = error
                }
                parsingCompleted += 1
            }
            reviewItems = merged
            isParsing = false
            if merged.isEmpty {
                errorMessage = lastError?.localizedDescription ?? "No items detected — try clearer photos."
            } else {
                queuedImages = []
                if failures > 0 {
                    errorMessage = "\(failures) photo\(failures == 1 ? "" : "s") couldn’t be read. Review the items found in the others."
                }
            }
        }
    }

    private func confirmAdd() {
        isSaving = true
        Task {
            do {
                try await store.bulkAddScannedPantryItems(reviewItems)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isSaving = false
            }
        }
    }

    /// JPEG-compresses (downscaling first if needed) so the base64 payload stays
    /// comfortably under the server's 8MB decoded-image limit.
    private static func jpegBase64(_ image: UIImage) -> String? {
        var working = image
        let maxDimension: CGFloat = 1600
        let longest = max(image.size.width, image.size.height)
        if longest > maxDimension {
            let scale = maxDimension / longest
            let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let renderer = UIGraphicsImageRenderer(size: newSize)
            working = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
        }
        guard let data = working.jpegData(compressionQuality: 0.5) else { return nil }
        return data.base64EncodedString()
    }
}

/// Consolidates detections from overlapping shelf/fridge photos before review.
/// The first detection owns the row; later matches only fill missing metadata.
enum PantryScanMerger {
    static func merge(existing: [ScannedPantryItem], incoming: [ScannedPantryItem]) -> [ScannedPantryItem] {
        var result = existing
        var indexByKey: [String: Int] = [:]
        for (index, item) in result.enumerated() { indexByKey[key(item.name)] = index }

        for var item in incoming {
            item.name = item.name.trimmingCharacters(in: .whitespacesAndNewlines)
            let itemKey = key(item.name)
            guard !itemKey.isEmpty else { continue }
            if let index = indexByKey[itemKey] {
                if result[index].category == "other", item.category != "other" {
                    result[index].category = item.category
                }
                if (result[index].unitHint ?? "").isEmpty, let hint = item.unitHint, !hint.isEmpty {
                    result[index].unitHint = hint
                }
            } else {
                indexByKey[itemKey] = result.count
                result.append(item)
            }
        }
        return result
    }

    private static func key(_ name: String) -> String {
        name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}

// MARK: - One reviewed scan result (editable, removable)

private struct ScannedItemRow: View {
    @Binding var item: ScannedPantryItem
    let onRemove: () -> Void

    private let categories = ["produce", "protein", "dairy", "grain", "pantry", "frozen", "spice", "other"]
    private let levels = ["plenty", "some", "low"]

    var body: some View {
        Card(padding: Space.md) {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack {
                    TextField("Name", text: $item.name)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                    Spacer()
                    Button(role: .destructive, action: onRemove) {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.textSecond)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(item.name)")
                }
                HStack(spacing: Space.md) {
                    Picker("Category", selection: $item.category) {
                        ForEach(categories, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    .pickerStyle(.menu)
                    Picker("Level", selection: $item.levelGuess) {
                        ForEach(levels, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                .font(Typography.caption)
                .tint(Palette.accent)
            }
        }
    }
}

// MARK: - Camera capture (UIImagePickerController wrapper)
//
// No SwiftUI-native camera capture exists on this iOS version, so this wraps
// UIKit's picker the standard way. SIMULATOR-ONLY UNVERIFIED: the Simulator has
// no camera hardware, so this path needs a real device to confirm end to end.
private struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onImage: onImage) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onImage: (UIImage?) -> Void
        init(onImage: @escaping (UIImage?) -> Void) { self.onImage = onImage }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onImage(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onImage(nil)
        }
    }
}
