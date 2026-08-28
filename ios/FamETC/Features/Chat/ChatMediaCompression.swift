import AVFoundation
import Foundation
import ImageIO
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
        exporter.outputFileType = exporter.supportedFileTypes.contains(.mp4) ? .mp4 : exporter.supportedFileTypes.first
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
