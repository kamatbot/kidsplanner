import SwiftUI
import PhotosUI
import UIKit

// MARK: - Pantry photo scan → AI review → bulk add
//
// Flow: take a photo (camera) OR pick one from the library → JPEG-compress →
// POST /api/ai/parse (kind:"pantry") → editable review list → confirm bulk-adds
// via POST /api/meals/pantry/bulk (AppStore.bulkAddScannedPantryItems).
//
// Camera capture is SIMULATOR-ONLY UNVERIFIED — UIImagePickerController's
// .camera source isn't available in the Simulator; this view detects that and
// steers to the PhotosPicker (library) path instead, which is the one actually
// exercised in this build/test pass. Needs a real device to verify camera capture.
struct PantryScannerView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var showCamera = false
    @State private var photoItem: PhotosPickerItem?
    @State private var isParsing = false
    @State private var reviewItems: [ScannedPantryItem] = []
    @State private var errorMessage: String?
    @State private var isSaving = false

    private var cameraAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

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
                if let image { Task { await parse(image) } }
            }
            .ignoresSafeArea()
        }
        .onChange(of: photoItem) { _, newValue in
            guard let newValue else { return }
            Task {
                if let data = try? await newValue.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    await parse(image)
                }
                photoItem = nil
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
            Text("Scan your pantry or fridge")
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.text)
            Text("Take a photo (or pick one from your library) and Fam ETC will detect the items for you to review before adding.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .multilineTextAlignment(.center)
            if let errorMessage {
                Text(errorMessage)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.warn)
                    .multilineTextAlignment(.center)
            }
            if cameraAvailable {
                AccentButton(title: "Take a photo", systemImage: "camera.fill") { showCamera = true }
            } else {
                // ponytail: no device to verify camera capture in this pass — the
                // Simulator has no camera hardware, so this branch is what's
                // actually reachable/tested here.
                Text("Camera isn't available in the Simulator — use the library instead.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                Text("Choose from library")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.accent)
            }
            Spacer()
        }
        .padding(Space.xl)
    }

    private var parsingView: some View {
        VStack(spacing: Space.md) {
            ProgressView()
            Text("Reading your photo…").font(Typography.body).foregroundStyle(Palette.textSecond)
        }
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

    private func parse(_ image: UIImage) async {
        errorMessage = nil
        isParsing = true
        guard let base64 = Self.jpegBase64(image) else {
            isParsing = false
            errorMessage = "Couldn't read that photo."
            return
        }
        do {
            let items = try await APIClient.shared.parsePantryPhoto(base64: base64)
            reviewItems = items
            if items.isEmpty { errorMessage = "No items detected — try a clearer photo." }
        } catch {
            errorMessage = error.localizedDescription
        }
        isParsing = false
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
