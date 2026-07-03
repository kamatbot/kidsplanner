import UIKit
import AVFoundation
import Vision
import CoreImage

/// Single-shot receipt scanner. Runs `VNDetectDocumentSegmentationRequest` on the
/// preview frames purely as an INVISIBLE trigger — no on-screen edge lines. It
/// waits until it actually detects a document (so the user has time to aim at the
/// receipt), then auto-captures fast and perspective-corrects to a flat image.
/// A shutter button is a manual fallback.
final class DocumentScannerViewController: UIViewController {

    /// Returns the captured, perspective-corrected image, or nil if cancelled.
    var onResult: ((UIImage?) -> Void)?

    private let session = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let sessionQueue = DispatchQueue(label: "ro.scanner.session")
    private let videoQueue = DispatchQueue(label: "ro.scanner.video")
    private var previewLayer: AVCaptureVideoPreviewLayer!

    private let lock = NSLock()
    private var latestPixelBuffer: CVPixelBuffer?
    private var latestCorners: [CGPoint]?  // [tl,tr,br,bl] for perspective correction
    private var detectedFrames = 0
    private var capturing = false
    private var didFinish = false

    private let shutter = UIButton(type: .custom)
    private let cancelButton = UIButton(type: .system)
    private let hint = UILabel()

    // MARK: lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureSession()
        configurePreview()
        configureControls()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        sessionQueue.async { if !self.session.isRunning { self.session.startRunning() } }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer.frame = view.bounds
    }

    override var prefersStatusBarHidden: Bool { true }

    // MARK: setup

    private func configureSession() {
        session.beginConfiguration()
        session.sessionPreset = .photo
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
           let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
            session.addInput(input)
        }
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        session.commitConfiguration()
    }

    private func configurePreview() {
        previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.bounds
        if let conn = previewLayer.connection {
            let portrait: CGFloat = 90 // iOS 17 rotation-angle API (replaces .videoOrientation)
            if conn.isVideoRotationAngleSupported(portrait) { conn.videoRotationAngle = portrait }
        }
        view.layer.addSublayer(previewLayer)
    }

    private func configureControls() {
        hint.text = "Point the camera at a receipt"
        hint.font = .systemFont(ofSize: 15, weight: .medium)
        hint.textColor = .white
        hint.textAlignment = .center
        hint.numberOfLines = 0
        hint.translatesAutoresizingMaskIntoConstraints = false
        hint.layer.shadowColor = UIColor.black.cgColor
        hint.layer.shadowOpacity = 0.6
        hint.layer.shadowRadius = 4
        hint.layer.shadowOffset = .zero
        view.addSubview(hint)

        shutter.translatesAutoresizingMaskIntoConstraints = false
        shutter.backgroundColor = .white
        shutter.layer.cornerRadius = 33
        shutter.layer.borderWidth = 4
        shutter.layer.borderColor = UIColor.white.withAlphaComponent(0.4).cgColor
        shutter.addTarget(self, action: #selector(captureTapped), for: .touchUpInside)
        view.addSubview(shutter)

        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.setTitleColor(.white, for: .normal)
        cancelButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancelButton)

        NSLayoutConstraint.activate([
            hint.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            hint.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            hint.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            shutter.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            shutter.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -30),
            shutter.widthAnchor.constraint(equalToConstant: 66),
            shutter.heightAnchor.constraint(equalToConstant: 66),
            cancelButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            cancelButton.centerYAnchor.constraint(equalTo: shutter.centerYAnchor),
        ])
    }

    // MARK: actions

    @objc private func cancelTapped() { finish(with: nil) }
    @objc private func captureTapped() { capture() }

    private func finish(with image: UIImage?) {
        guard !didFinish else { return }
        didFinish = true
        onResult?(image)
    }

    // MARK: detection (video queue) — invisible, drives auto-capture only

    private func handle(pixelBuffer: CVPixelBuffer) {
        lock.lock(); latestPixelBuffer = pixelBuffer; lock.unlock()
        let request = VNDetectDocumentSegmentationRequest()
        // Back camera in portrait → frames are sensor-landscape; .right uprights them.
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right, options: [:])
        try? handler.perform([request])
        let quad = request.results?.first as? VNRectangleObservation
        DispatchQueue.main.async { [weak self] in self?.updateDetection(quad) }
    }

    private func updateDetection(_ quad: VNRectangleObservation?) {
        guard !didFinish, !capturing else { return }
        if let q = quad, q.confidence > 0.6, quadArea(q) > 0.18 {
            latestCorners = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft]
            detectedFrames += 1
            hint.text = "Hold steady…"
            // It "waits" here until a receipt is actually detected, then captures
            // after a short confirmation window (~16 confident frames).
            if detectedFrames >= 16 { capture() }
        } else {
            detectedFrames = 0
            latestCorners = nil
            hint.text = "Point the camera at a receipt"
        }
    }

    private func quadArea(_ q: VNRectangleObservation) -> CGFloat {
        let p = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft]
        var a: CGFloat = 0
        for i in 0..<4 { let j = (i + 1) % 4; a += p[i].x * p[j].y - p[j].x * p[i].y }
        return abs(a) / 2
    }

    // MARK: capture

    private func capture() {
        guard !didFinish, !capturing else { return }
        capturing = true
        lock.lock(); let buffer = latestPixelBuffer; lock.unlock()
        let corners = latestCorners
        guard let buffer else { capturing = false; return }

        let flash = UIView(frame: view.bounds); flash.backgroundColor = .white
        view.addSubview(flash)
        UIView.animate(withDuration: 0.22) { flash.alpha = 0 } completion: { _ in flash.removeFromSuperview() }

        var image = CIImage(cvPixelBuffer: buffer).oriented(.right) // upright portrait
        if let c = corners {
            let e = image.extent
            func v(_ n: CGPoint) -> CIVector { CIVector(x: n.x * e.width, y: n.y * e.height) }
            image = image.applyingFilter("CIPerspectiveCorrection", parameters: [
                "inputTopLeft": v(c[0]),
                "inputTopRight": v(c[1]),
                "inputBottomRight": v(c[2]),
                "inputBottomLeft": v(c[3]),
            ])
        }
        let ctx = CIContext()
        let result = ctx.createCGImage(image, from: image.extent).map { UIImage(cgImage: $0) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            self?.finish(with: result)
        }
    }
}

extension DocumentScannerViewController: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        handle(pixelBuffer: pb)
    }
}
