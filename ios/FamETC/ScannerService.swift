import UIKit
import Vision

struct ScannerResult {
    /// All recognized lines joined top-to-bottom — the same plain-text shape the
    /// web app's Tesseract path produces, so `parseReceipt()` consumes it as-is.
    let text: String
}

enum ScannerError: Error {
    case cancelled
    case cameraUnavailable
    case recognitionFailed

    var userMessage: String {
        switch self {
        case .cancelled: return "Scan cancelled."
        case .cameraUnavailable: return "The camera isn't available on this device."
        case .recognitionFailed: return "Couldn't read that receipt."
        }
    }
}

/// Presents the custom receipt scanner (`DocumentScannerViewController`) and runs
/// on-device OCR on the captured image. The image never leaves the phone.
final class ScannerService: NSObject {
    static let shared = ScannerService()

    private var completion: ((Result<ScannerResult, ScannerError>) -> Void)?

    func present(from presenter: UIViewController,
                 completion: @escaping (Result<ScannerResult, ScannerError>) -> Void) {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            completion(.failure(.cameraUnavailable))
            return
        }
        self.completion = completion
        let scanner = DocumentScannerViewController()
        scanner.modalPresentationStyle = .fullScreen
        scanner.onResult = { [weak self, weak presenter] image in
            presenter?.dismiss(animated: true) {
                guard let image else { self?.finish(.failure(.cancelled)); return }
                self?.runOCR(on: image)
            }
        }
        presenter.present(scanner, animated: true)
    }

    private func finish(_ result: Result<ScannerResult, ScannerError>) {
        let cb = completion
        completion = nil
        cb?(result)
    }

    private func runOCR(on image: UIImage) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let text = Self.recognize(image) ?? ""
            DispatchQueue.main.async {
                if text.isEmpty { self?.finish(.failure(.recognitionFailed)) }
                else { self?.finish(.success(ScannerResult(text: text))) }
            }
        }
    }

    private static func recognize(_ image: UIImage) -> String? {
        guard let cg = image.cgImage else { return nil }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US"]
        let handler = VNImageRequestHandler(cgImage: cg, orientation: cgOrientation(image.imageOrientation), options: [:])
        do { try handler.perform([request]) } catch { return nil }
        guard let observations = request.results else { return nil }
        return observations
            .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }

    private static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .upMirrored: return .upMirrored
        case .down: return .down
        case .downMirrored: return .downMirrored
        case .left: return .left
        case .leftMirrored: return .leftMirrored
        case .right: return .right
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
