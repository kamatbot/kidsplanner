import AVFoundation
import Foundation
import ImageIO
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Reduces photo/video upload size on-device before chat transfer.
/// Documents and other non-media files are left untouched.
enum ChatMediaCompression {
    static let maxPhotoDimension = 2048
    static let photoQuality: CGFloat = 0.78

    static func prepare(_ picked: ChatPickedAttachment) async throws -> ChatPickedAttachment {
        guard let type = UTType(mimeType: picked.mimeType) else { return picked }
        if type.conforms(to: .image) {
            return try await compressPhoto(picked)
        }
        if type.conforms(to: .movie) || type.conforms(to: .video) {
            return try await compressVideo(picked)
        }
        return picked
    }

    private static func compressPhoto(_ picked: ChatPickedAttachment) async throws -> ChatPickedAttachment {
        let sourceURL = picked.url
        let originalBytes = fileSize(sourceURL)

        let compressed: ChatPickedAttachment = try await Task.detached(priority: .userInitiated) {
            guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else {
                throw APIError.http(422, "Couldn't read that photo.")
            }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPhotoDimension,
                kCGImageSourceCreateThumbnailWithTransform: true,
            ]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                throw APIError.http(422, "Couldn't resize that photo.")
            }

            let output = FileManager.default.temporaryDirectory
                .appendingPathComponent("fam-chat-photo-\(UUID().uuidString).jpg")
            guard let destination = CGImageDestinationCreateWithURL(output as CFURL,
                                                                    UTType.jpeg.identifier as CFString,
                                                                    1,
                                                                    nil) else {
                throw APIError.http(500, "Couldn't prepare that photo.")
            }
            CGImageDestinationAddImage(destination,
                                       image,
                                       [kCGImageDestinationLossyCompressionQuality: photoQuality] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else {
                throw APIError.http(500, "Couldn't compress that photo.")
            }
            return ChatPickedAttachment(url: output, mimeType: "image/jpeg")
        }.value

        // HEIC and already-small JPEGs can occasionally be smaller than a new
        // JPEG. Never make an upload larger just to say it was recompressed.
        if originalBytes > 0, fileSize(compressed.url) >= originalBytes {
            try? FileManager.default.removeItem(at: compressed.url)
            return picked
        }
        return compressed
    }

    private static func compressVideo(_ picked: ChatPickedAttachment) async throws -> ChatPickedAttachment {
        let originalBytes = fileSize(picked.url)
        let asset = AVURLAsset(url: picked.url)
        let presets = AVAssetExportSession.exportPresets(compatibleWith: asset)
        let preferred = [AVAssetExportPreset1280x720, AVAssetExportPreset960x540, AVAssetExportPresetMediumQuality]
        guard let preset = preferred.first(where: { presets.contains($0) }),
              let exporter = AVAssetExportSession(asset: asset, presetName: preset) else {
            return picked
        }

        let output = FileManager.default.temporaryDirectory
            .appendingPathComponent("fam-chat-video-\(UUID().uuidString).mp4")
        exporter.outputURL = output
        if exporter.supportedFileTypes.contains(.mp4) {
            exporter.outputFileType = .mp4
        } else if let fallbackType = exporter.supportedFileTypes.first {
            exporter.outputFileType = fallbackType
        } else {
            return picked
        }
        exporter.shouldOptimizeForNetworkUse = true

        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                exporter.exportAsynchronously {
                    switch exporter.status {
                    case .completed:
                        continuation.resume()
                    case .cancelled:
                        continuation.resume(throwing: CancellationError())
                    default:
                        continuation.resume(throwing: exporter.error ?? APIError.http(422, "Couldn't compress that video."))
                    }
                }
            }
        } onCancel: {
            exporter.cancelExport()
        }

        let compressed = ChatPickedAttachment(url: output,
                                              mimeType: exporter.outputFileType == .mp4 ? "video/mp4" : picked.mimeType)
        if originalBytes > 0, fileSize(output) >= originalBytes {
            try? FileManager.default.removeItem(at: output)
            return picked
        }
        return compressed
    }

    private static func fileSize(_ url: URL) -> Int {
        (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    }
}

extension AppStore {
    /// Central send path for user-selected attachments. Media is prepared before
    /// the existing authenticated upload starts, so the network never sees the
    /// original full-resolution photo/video when compression produces a win.
    func sendCompressedAttachment(_ picked: ChatPickedAttachment, roomId: String = familyRoomId) async throws {
        let prepared = try await ChatMediaCompression.prepare(picked)
        defer {
            if prepared.url != picked.url {
                try? FileManager.default.removeItem(at: prepared.url)
            }
        }
        try await sendAttachment(prepared, roomId: roomId)
    }
}

/// Compact composer menu: all secondary chat actions live behind one `+`, so
/// the text field gets the horizontal space instead of four separate controls.
struct ChatComposerAddMenu: View {
    let canBuzz: Bool
    let onGif: () -> Void
    let onBuzz: () -> Void
    let onSendAttachment: (ChatPickedAttachment) async throws -> Void

    @State private var pickerKind: PickerKind?
    @State private var isSending = false
    @State private var errorMessage: String?

    private enum PickerKind: String, Identifiable {
        case photoVideo
        case file
        var id: String { rawValue }
    }

    var body: some View {
        Menu {
            Button {
                onGif()
            } label: {
                Label("GIF", systemImage: "photo.stack")
            }

            Button {
                onBuzz()
            } label: {
                Label("Buzz", systemImage: "wave.3.right.circle.fill")
            }
            .disabled(!canBuzz)

            Divider()

            Button {
                pickerKind = .photoVideo
            } label: {
                Label("Photo or Video", systemImage: "photo.on.rectangle.angled")
            }

            Button {
                pickerKind = .file
            } label: {
                Label("File", systemImage: "doc")
            }
        } label: {
            Group {
                if isSending {
                    ProgressView().tint(Palette.accent)
                } else {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Palette.accent)
                }
            }
            .frame(width: 44, height: 44)
            .background(Palette.accentSoft, in: Circle())
            .contentShape(Circle())
        }
        .disabled(isSending)
        .accessibilityLabel(isSending ? "Preparing attachment" : "More chat actions")
        .accessibilityHint("GIF, Buzz, photo, video, or file")
        .sheet(item: $pickerKind) { kind in
            switch kind {
            case .photoVideo:
                CompactChatPhotoVideoPicker { picked in handlePicked(picked) }
            case .file:
                CompactChatDocumentPicker { picked in handlePicked(picked) }
            }
        }
        .alert("Attachment not sent", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Please try again.")
        }
    }

    private func handlePicked(_ picked: ChatPickedAttachment?) {
        pickerKind = nil
        guard let picked else { return }
        isSending = true
        Task { @MainActor in
            defer {
                isSending = false
                try? FileManager.default.removeItem(at: picked.url)
            }
            do {
                try await onSendAttachment(picked)
                Haptics.notify(.success)
            } catch {
                Haptics.notify(.error)
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct CompactChatPhotoVideoPicker: UIViewControllerRepresentable {
    let completion: (ChatPickedAttachment?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.selectionLimit = 1
        config.filter = .any(of: [.images, .videos])
        let controller = PHPickerViewController(configuration: config)
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let completion: (ChatPickedAttachment?) -> Void

        init(completion: @escaping (ChatPickedAttachment?) -> Void) {
            self.completion = completion
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard let provider = results.first?.itemProvider else {
                picker.dismiss(animated: true) { self.completion(nil) }
                return
            }
            let identifier = provider.registeredTypeIdentifiers.first(where: {
                guard let type = UTType($0) else { return false }
                return type.conforms(to: .image) || type.conforms(to: .movie)
            }) ?? provider.registeredTypeIdentifiers.first
            guard let identifier else {
                picker.dismiss(animated: true) { self.completion(nil) }
                return
            }

            provider.loadFileRepresentation(forTypeIdentifier: identifier) { sourceURL, error in
                let picked = sourceURL.flatMap {
                    Self.copyToTemporary($0, provider: provider, identifier: identifier)
                }
                DispatchQueue.main.async {
                    picker.dismiss(animated: true) {
                        self.completion(error == nil ? picked : nil)
                    }
                }
            }
        }

        private static func copyToTemporary(_ source: URL,
                                            provider: NSItemProvider,
                                            identifier: String) -> ChatPickedAttachment? {
            let type = UTType(identifier)
            let ext = source.pathExtension.isEmpty ? (type?.preferredFilenameExtension ?? "bin") : source.pathExtension
            let stem = (provider.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                        ? provider.suggestedName! : "attachment")
                .replacingOccurrences(of: "/", with: "-")
                .replacingOccurrences(of: "\\", with: "-")
            let filename = stem.lowercased().hasSuffix(".\(ext.lowercased())") ? stem : "\(stem).\(ext)"
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(UUID().uuidString)-\(filename)")
            do {
                try FileManager.default.copyItem(at: source, to: destination)
                return ChatPickedAttachment(url: destination,
                                            mimeType: type?.preferredMIMEType ?? "application/octet-stream")
            } catch {
                return nil
            }
        }
    }
}

private struct CompactChatDocumentPicker: UIViewControllerRepresentable {
    let completion: (ChatPickedAttachment?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let controller = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        controller.allowsMultipleSelection = false
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let completion: (ChatPickedAttachment?) -> Void

        init(completion: @escaping (ChatPickedAttachment?) -> Void) {
            self.completion = completion
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            completion(nil)
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let source = urls.first else {
                completion(nil)
                return
            }
            let name = source.lastPathComponent.isEmpty ? "attachment" : source.lastPathComponent
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(UUID().uuidString)-\(name)")
            let accessed = source.startAccessingSecurityScopedResource()
            defer { if accessed { source.stopAccessingSecurityScopedResource() } }

            do {
                try FileManager.default.copyItem(at: source, to: destination)
                let type = UTType(filenameExtension: source.pathExtension)
                completion(ChatPickedAttachment(url: destination,
                                                mimeType: type?.preferredMIMEType ?? "application/octet-stream"))
            } catch {
                completion(nil)
            }
        }
    }
}
