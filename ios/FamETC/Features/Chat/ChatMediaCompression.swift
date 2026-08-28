import AVFoundation
import Foundation
import ImageIO
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

        return try await Task.detached(priority: .userInitiated) {
            let output = FileManager.default.temporaryDirectory
                .appendingPathComponent("fam-chat-photo-\(UUID().uuidString).jpg")

            do {
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

                let compressedBytes = fileSize(output)
                guard compressedBytes > 0 else {
                    try? FileManager.default.removeItem(at: output)
                    return picked
                }
                if originalBytes > 0, compressedBytes >= originalBytes {
                    try? FileManager.default.removeItem(at: output)
                    return picked
                }
                return ChatPickedAttachment(url: output, mimeType: "image/jpeg")
            } catch {
                try? FileManager.default.removeItem(at: output)
                throw error
            }
        }.value
    }

    private static func compressVideo(_ picked: ChatPickedAttachment) async throws -> ChatPickedAttachment {
        let originalBytes = fileSize(picked.url)
        let asset = AVURLAsset(url: picked.url)
        let preferred = [AVAssetExportPreset1280x720, AVAssetExportPreset960x540, AVAssetExportPresetMediumQuality]
        guard let exporter = preferred.lazy.compactMap({ AVAssetExportSession(asset: asset, presetName: $0) })
            .first(where: { $0.supportedFileTypes.contains(.mp4) }) else {
            return picked
        }
        let output = FileManager.default.temporaryDirectory
            .appendingPathComponent("fam-chat-video-\(UUID().uuidString).mp4")
        exporter.shouldOptimizeForNetworkUse = true

        do {
            try await exporter.export(to: output, as: .mp4)
        } catch {
            try? FileManager.default.removeItem(at: output)
            throw error
        }

        let compressedBytes = fileSize(output)
        guard compressedBytes > 0 else {
            try? FileManager.default.removeItem(at: output)
            return picked
        }
        if originalBytes > 0, compressedBytes >= originalBytes {
            try? FileManager.default.removeItem(at: output)
            return picked
        }
        return ChatPickedAttachment(url: output, mimeType: "video/mp4")
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
