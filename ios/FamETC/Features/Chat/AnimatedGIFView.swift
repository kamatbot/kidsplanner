import SwiftUI
import UIKit
import ImageIO

// MARK: - Animated GIF view
//
// SwiftUI.Image/AsyncImage only ever render a single static frame of a GIF.
// This wraps a UIImageView so remote GIFs (Giphy, chat media) actually
// animate in the chat window and the GIF picker.

/// Downloads a remote GIF and animates it via `UIImageView.animationImages`.
/// Self-contained and reusable: `AnimatedGIFView(url: someURL)`.
struct AnimatedGIFView: UIViewRepresentable {
    let url: URL?

    func makeUIView(context: Context) -> UIImageView {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFit
        imageView.clipsToBounds = true
        imageView.backgroundColor = .clear
        return imageView
    }

    func updateUIView(_ uiView: UIImageView, context: Context) {
        guard let url else {
            context.coordinator.loadTask?.cancel()
            context.coordinator.loadTask = nil
            context.coordinator.loadedURL = nil
            uiView.image = nil
            uiView.stopAnimating()
            uiView.animationImages = nil
            return
        }
        // Avoid re-downloading/re-decoding if the URL hasn't changed.
        if context.coordinator.loadedURL == url { return }
        context.coordinator.loadedURL = url
        context.coordinator.loadTask?.cancel()
        uiView.image = nil
        uiView.stopAnimating()
        uiView.animationImages = nil

        context.coordinator.loadTask = Task { [weak uiView] in
            let result = await AnimatedGIFView.loadFrames(from: url)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                // Guard against a stale/cancelled load landing on a reused view.
                guard let uiView, context.coordinator.loadedURL == url else { return }
                guard let result else { return }
                if result.images.count > 1 {
                    uiView.animationImages = result.images
                    uiView.animationDuration = result.duration
                    uiView.animationRepeatCount = 0
                    uiView.image = result.images.first
                    uiView.startAnimating()
                } else {
                    uiView.image = result.images.first
                }
            }
        }
    }

    static func dismantleUIView(_ uiView: UIImageView, coordinator: Coordinator) {
        coordinator.loadTask?.cancel()
        coordinator.loadTask = nil
        coordinator.loadedURL = nil
        uiView.stopAnimating()
        uiView.animationImages = nil
        uiView.image = nil
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loadedURL: URL?
        var loadTask: Task<Void, Never>?
    }

    /// Downloads GIF data, downsamples it, and caps decoded frames so a picker
    /// grid cannot retain hundreds of full-resolution frames per result.
    private static func loadFrames(from url: URL) async -> (images: [UIImage], duration: TimeInterval)? {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard !Task.isCancelled, data.count <= 20_000_000 else { return nil }
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            let count = CGImageSourceGetCount(source)
            guard count > 0 else { return nil }

            var images: [UIImage] = []
            let frameStep = max(1, Int(ceil(Double(count) / 60.0)))
            images.reserveCapacity(min(count, 60))
            let thumbnailOptions: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 480,
                kCGImageSourceShouldCacheImmediately: true,
            ]

            for index in stride(from: 0, to: count, by: frameStep) {
                guard !Task.isCancelled else { return nil }
                guard let cgImage = CGImageSourceCreateThumbnailAtIndex(
                    source,
                    index,
                    thumbnailOptions as CFDictionary
                ) else { continue }
                images.append(UIImage(cgImage: cgImage))
            }
            guard !images.isEmpty else { return nil }
            var duration = (0..<count).reduce(0) { $0 + frameDelay(source: source, index: $1) }
            if duration <= 0 { duration = Double(images.count) * 0.1 }
            return (images, duration)
        } catch {
            return nil
        }
    }

    private static func frameDelay(source: CGImageSource, index: Int) -> TimeInterval {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any],
              let gifProperties = properties[kCGImagePropertyGIFDictionary] as? [CFString: Any] else {
            return 0.1
        }
        let unclamped = gifProperties[kCGImagePropertyGIFUnclampedDelayTime] as? Double
        let clamped = gifProperties[kCGImagePropertyGIFDelayTime] as? Double
        let delay = unclamped ?? clamped ?? 0.1
        return delay > 0 ? delay : 0.1
    }
}
