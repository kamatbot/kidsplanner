import Foundation
import UIKit
import Vision

enum SchoolNoticeOCR {
    static func recognize(imageData: Data) async throws -> String {
        guard let image = UIImage(data: imageData), let cgImage = image.cgImage else {
            throw SchoolNoticeOCRError.invalidImage
        }
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                request.recognitionLanguages = ["en-US"]
                do {
                    try VNImageRequestHandler(
                        cgImage: cgImage,
                        orientation: cgOrientation(image.imageOrientation),
                        options: [:]
                    ).perform([request])
                    let text = (request.results ?? [])
                        .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
                        .compactMap { $0.topCandidates(1).first?.string }
                        .joined(separator: "\n")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { throw SchoolNoticeOCRError.noText }
                    continuation.resume(returning: text)
                } catch let error as SchoolNoticeOCRError {
                    continuation.resume(throwing: error)
                } catch {
                    continuation.resume(throwing: SchoolNoticeOCRError.recognitionFailed)
                }
            }
        }
    }

    private static func cgOrientation(_ orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch orientation {
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

enum SchoolNoticeOCRError: LocalizedError {
    case invalidImage
    case noText
    case recognitionFailed

    var errorDescription: String? {
        switch self {
        case .invalidImage: return "That image could not be opened. Choose another screenshot or photo."
        case .noText: return "No readable text was found. You can paste or type the notice instead."
        case .recognitionFailed: return "The notice could not be read. Try a clearer image or enter it manually."
        }
    }
}
