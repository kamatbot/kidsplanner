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
            uiView.image = nil
            uiView.stopAnimating()
            uiView.animationImages = nil
            return
        }
        // Avoid re-downloading/re-decoding if the URL hasn't changed.
        if context.coordinator.loadedURL == url { return }
        context.coordinator.loadedURL = url
        uiView.image = nil
        uiView.stopAnimating()
        uiView.animationImages = nil

        Task {
            let result = await AnimatedGIFView.loadFrames(from: url)
            await MainActor.run {
                // Guard against a stale/cancelled load landing on a reused view.
                guard context.coordinator.loadedURL == url else { return }
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
        uiView.stopAnimating()
        uiView.animationImages = nil
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var loadedURL: URL?
    }

    /// Downloads GIF data and decodes every frame with its delay, off the main actor.
    private static func loadFrames(from url: URL) async -> (images: [UIImage], duration: TimeInterval)? {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            let count = CGImageSourceGetCount(source)
            guard count > 0 else { return nil }

            var images: [UIImage] = []
            var duration: TimeInterval = 0
            images.reserveCapacity(count)

            for index in 0..<count {
                guard let cgImage = CGImageSourceCreateImageAtIndex(source, index, nil) else { continue }
                images.append(UIImage(cgImage: cgImage))
                duration += frameDelay(source: source, index: index)
            }
            guard !images.isEmpty else { return nil }
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
