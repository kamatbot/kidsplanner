import Foundation
import ImageIO
import PhotosUI
import QuickLook
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - Attachment wire contract

struct ChatAttachmentDescriptor: Decodable {
    let type: String
    let attachmentId: String
    let url: String
    let filename: String
    let mimeType: String
    let size: Int
    let kind: String
}

private struct ChatAttachmentUploadResponse: Decodable {
    let attachment: ChatAttachmentDescriptor
}

struct ChatPickedAttachment {
    let url: URL
    let mimeType: String
}

extension ChatMedia {
    var isChatAttachment: Bool { type == "attachment" }

    // Fallbacks decode the short-lived pre-release alias contract without
    // making new server messages overload GIF dimensions or preview URLs.
    var attachmentFilename: String {
        if let filename, !filename.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return filename }
        if let previewUrl, !previewUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return previewUrl }
        return "Attachment"
    }
    var attachmentByteSize: Int { max(0, size ?? width ?? 0) }
    var attachmentKind: String {
        if let kind, ["photo", "video", "file"].contains(kind) { return kind }
        switch height {
        case 1: return "photo"
        case 2: return "video"
        default: return "file"
        }
    }
}

// MARK: - Authenticated attachment HTTP

private enum ChatAttachmentHTTP {
    static let maxBytes = 25 * 1024 * 1024
    static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = .shared
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 120
        configuration.waitsForConnectivity = true
        configuration.httpAdditionalHeaders = Config.clientHeaders
        return URLSession(configuration: configuration)
    }()

    static func absoluteURL(_ path: String) -> URL? {
        guard path.hasPrefix("/"), !path.hasPrefix("//") else { return nil }
        let trimmed = String(path.dropFirst())
        return URL(string: trimmed, relativeTo: Config.baseURL)?.absoluteURL
    }

    static func attachmentURL(_ path: String) -> URL? {
        let prefix = "/api/chat/attachments/"
        guard path.hasPrefix(prefix) else { return nil }
        let id = String(path.dropFirst(prefix.count))
        guard id.count == 38, id.hasPrefix("a_"), id.dropFirst(2).allSatisfy({ $0.isHexDigit }) else { return nil }
        return absoluteURL(path)
    }

    static func error(from response: URLResponse, data: Data) -> APIError? {
        guard let http = response as? HTTPURLResponse else { return .http(0, "Unexpected server response.") }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { return .unauthenticated }
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            return .http(http.statusCode, message ?? "Request failed (\(http.statusCode)).")
        }
        return nil
    }

    static func multipartFile(fileURL: URL, roomId: String, mimeType: String, boundary: String) throws -> URL {
        let fm = FileManager.default
        let bodyURL = fm.temporaryDirectory.appendingPathComponent("fam-chat-upload-\(UUID().uuidString).multipart")
        fm.createFile(atPath: bodyURL.path, contents: nil)
        let out = try FileHandle(forWritingTo: bodyURL)
        defer { try? out.close() }

        func write(_ string: String) throws {
            guard let data = string.data(using: .utf8) else { return }
            try out.write(contentsOf: data)
        }

        try write("--\(boundary)\r\n")
        try write("Content-Disposition: form-data; name=\"roomId\"\r\n\r\n")
        try write("\(roomId)\r\n")
        try write("--\(boundary)\r\n")
        let escapedName = fileURL.lastPathComponent
            .replacingOccurrences(of: "\r", with: "-")
            .replacingOccurrences(of: "\n", with: "-")
            .replacingOccurrences(of: "\"", with: "'")
            .replacingOccurrences(of: "\\", with: "-")
        try write("Content-Disposition: form-data; name=\"file\"; filename=\"\(escapedName)\"\r\n")
        try write("Content-Type: \(mimeType)\r\n\r\n")

        let input = try FileHandle(forReadingFrom: fileURL)
        defer { try? input.close() }
        while true {
            let chunk = try input.read(upToCount: 256 * 1024) ?? Data()
            if chunk.isEmpty { break }
            try out.write(contentsOf: chunk)
        }
        try write("\r\n--\(boundary)--\r\n")
        return bodyURL
    }
}

extension APIClient {
    func uploadChatAttachment(_ picked: ChatPickedAttachment, roomId: String) async throws -> ChatAttachmentDescriptor {
        guard let endpoint = ChatAttachmentHTTP.absoluteURL("/api/chat/attachments") else { throw APIError.badURL }
        let fileSize = try picked.url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard fileSize > 0 else { throw APIError.http(400, "That attachment is empty.") }
        guard fileSize <= ChatAttachmentHTTP.maxBytes else {
            throw APIError.http(413, "Please choose a file under 25 MB.")
        }
        let boundary = "FamETC-\(UUID().uuidString)"
        let bodyURL: URL
        do {
            bodyURL = try ChatAttachmentHTTP.multipartFile(fileURL: picked.url,
                                                           roomId: roomId,
                                                           mimeType: picked.mimeType,
                                                           boundary: boundary)
        } catch {
            throw APIError.transport(error)
        }
        defer { try? FileManager.default.removeItem(at: bodyURL) }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        do {
            let (data, response) = try await ChatAttachmentHTTP.session.upload(for: request, fromFile: bodyURL)
            if let error = ChatAttachmentHTTP.error(from: response, data: data) { throw error }
            do {
                return try JSONDecoder().decode(ChatAttachmentUploadResponse.self, from: data).attachment
            } catch {
                throw APIError.decoding(error)
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport(error)
        }
    }

    func downloadChatAttachment(path: String, suggestedFilename: String) async throws -> URL {
        guard let url = ChatAttachmentHTTP.attachmentURL(path) else { throw APIError.badURL }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        do {
            let (temporaryURL, response) = try await ChatAttachmentHTTP.session.download(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.http(0, "Unexpected server response.") }
            if http.statusCode == 401 { throw APIError.unauthenticated }
            guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, "Couldn't download this attachment.") }

            let safeName = suggestedFilename
                .replacingOccurrences(of: "/", with: "-")
                .replacingOccurrences(of: "\\", with: "-")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("FamETCChat", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent("\(UUID().uuidString)-\(safeName.isEmpty ? "attachment" : safeName)")
            try FileManager.default.moveItem(at: temporaryURL, to: destination)
            return destination
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport(error)
        }
    }
}

// MARK: - AppStore bridge

extension AppStore {
    func sendAttachment(_ picked: ChatPickedAttachment, roomId: String = familyRoomId) async throws {
        let descriptor = try await APIClient.shared.uploadChatAttachment(picked, roomId: roomId)
        let senderType = me?.role == "kid" ? "kid" : "parent"
        let senderId = (me?.role == "kid" ? me?.kidId : me?.id) ?? me?.id ?? ""
        let media: [String: Any] = [
            "type": "attachment",
            "attachmentId": descriptor.attachmentId,
        ]
        let message = try await APIClient.shared.sendChatMessage(text: "",
                                                                 card: nil,
                                                                 media: media,
                                                                 senderType: senderType,
                                                                 senderId: senderId,
                                                                 roomId: roomId)
        mergeIncoming([message], roomId: roomId)
        markChatRead(roomId)
    }

    /// A notification tap starts its network request before the Chat screen is
    /// laid out. When the screen appears, consume the already-running request
    /// rather than waiting for the normal polling loop's first iteration.
    func consumeNotificationChatPrefetch(roomId: String) async {
        guard let fresh = await ChatNotificationPrefetcher.shared.consume(roomId: roomId), !fresh.isEmpty else { return }
        mergeIncoming(fresh, roomId: roomId)
        markChatRead(roomId)
    }
}

actor ChatNotificationPrefetcher {
    static let shared = ChatNotificationPrefetcher()
    private var tasks: [String: Task<[ChatMessage], Never>] = [:]

    func start(roomId: String) {
        tasks[roomId]?.cancel()
        tasks[roomId] = Task {
            (try? await APIClient.shared.chatMessages(roomId: roomId, limit: 50)) ?? []
        }
    }

    func consume(roomId: String) async -> [ChatMessage]? {
        guard let task = tasks[roomId] else { return nil }
        let messages = await task.value
        tasks[roomId] = nil
        return messages
    }
}

// MARK: - Composer and keyboard attachment panel

/// One reserved input area is shared by the system keyboard and attachment
/// grid. This keeps the native SwiftUI text field and avoids overlapping insets.
struct ChatComposerAddMenu: View {
    @Binding var text: String
    @Binding var isFocused: Bool
    @Binding var keyboardDocked: Bool
    let placeholder: String
    let canBuzz: Bool
    let canSend: Bool
    let sendingMessage: Bool
    /// False for the Hermes room (text only, docs/HERMES-THREADS-CONTRACT.md
    /// §3/§4): hides the "+" menu entirely, so Buzz/GIF/photos/camera/files
    /// are all unreachable together rather than gated one by one.
    var attachmentsEnabled: Bool = true
    let inputBottom: CGFloat
    let onSubmit: () -> Void
    let onGif: () -> Void
    let onBuzz: () -> Void
    let onSend: (ChatPickedAttachment) async throws -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showsAttachments = false
    @State private var keyboardTop: CGFloat?
    @State private var restingBottom: CGFloat = 0
    @State private var lastKeyboardHeight: CGFloat = 300
    @State private var returningToKeyboard = false
    @FocusState private var fieldFocused: Bool
    @State private var pickerKind: PickerKind?
    @State private var isSending = false
    @State private var errorMessage: String?
    @State private var failedAttachment: ChatPickedAttachment?
    @State private var pickedSend: ((ChatPickedAttachment) async throws -> Void)?

    private enum PickerKind: String, Identifiable {
        case photoVideo, camera, file
        var id: String { rawValue }
    }

    private var keyboardHeight: CGFloat { keyboardTop.map { max(0, restingBottom - $0) } ?? 0 }
    private var reservedHeight: CGFloat {
        showsAttachments || returningToKeyboard ? max(0, lastKeyboardHeight - keyboardHeight) : 0
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .bottom, spacing: Space.sm) {
                if attachmentsEnabled {
                    Button {
                        Haptics.selection()
                        if showsAttachments {
                            returningToKeyboard = true
                            showsAttachments = false
                            fieldFocused = true
                        } else {
                            if keyboardHeight > 0 { lastKeyboardHeight = keyboardHeight }
                            showsAttachments = true
                            fieldFocused = false
                        }
                        isFocused = true
                    } label: {
                        Group {
                            if isSending { ProgressView().tint(Palette.accent) }
                            else {
                                Image(systemName: showsAttachments ? "keyboard" : "plus")
                                    .font(.system(size: 19, weight: .semibold))
                                    .foregroundStyle(Palette.accent)
                            }
                        }
                        .frame(width: 44, height: 44)
                        .background(Palette.accentSoft, in: Circle())
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel(showsAttachments ? "Show keyboard" : "More chat actions")
                    .accessibilityIdentifier("chat.attachments.toggle")
                }

                TextField(placeholder, text: $text, axis: .vertical)
                    .font(.body)
                    .foregroundStyle(Palette.text)
                    .lineLimit(1...5)
                    .focused($fieldFocused)
                    .padding(.horizontal, Space.md).padding(.vertical, 11)
                    .background(Palette.panel2, in: RoundedRectangle(cornerRadius: 22))
                    .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Palette.border, lineWidth: 1).allowsHitTesting(false))
                    .accessibilityIdentifier("chat.composer")

                Button(action: onSubmit) {
                    Group {
                        if sendingMessage { ProgressView().tint(Palette.onAccent) }
                        else { Image(systemName: "paperplane.fill") }
                    }
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(width: 44, height: 44)
                    .background(canSend ? Palette.accent : Palette.textSecond.opacity(0.4), in: Circle())
                }
                .disabled(!canSend)
                .buttonStyle(PressableStyle())
                .accessibilityLabel("Send message")
                .accessibilityIdentifier("chat.send")
            }
            .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
            .background(Palette.panel)
            .overlay(Divider().overlay(Palette.border), alignment: .top)

            ZStack(alignment: .top) {
                if attachmentsEnabled && showsAttachments {
                    ChatAttachmentPanel(canBuzz: canBuzz, isSending: isSending, onAction: selectAction)
                }
            }
            .frame(height: reservedHeight)
            .clipped()
        }
        .onChange(of: isFocused) { _, focused in
            if !focused {
                showsAttachments = false
                returningToKeyboard = false
                fieldFocused = false
            } else if !showsAttachments { fieldFocused = true }
        }
        .onChange(of: fieldFocused) { _, focused in
            if focused {
                if showsAttachments { returningToKeyboard = true }
                showsAttachments = false
                isFocused = true
            } else if !showsAttachments { isFocused = false }
        }
        .onChange(of: inputBottom, initial: true) { _, bottom in
            if !isFocused && !showsAttachments { restingBottom = bottom }
        }
        .onChange(of: keyboardHeight > 0 || showsAttachments || returningToKeyboard) { _, active in keyboardDocked = active }
        .onChange(of: keyboardHeight) { _, height in
            if height > 0 && !showsAttachments { lastKeyboardHeight = height }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
            guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
                  let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
                  let window = scene.windows.first(where: \.isKeyWindow) else { return }
            let converted = window.convert(frame, from: window.screen.coordinateSpace)
            let docked = converted.minY < window.bounds.maxY
                && converted.maxY >= window.bounds.maxY - 1
                && converted.width >= window.bounds.width * 0.8
            let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
            withAnimation(reduceMotion ? nil : .easeOut(duration: duration)) {
                keyboardTop = docked && fieldFocused ? converted.minY : nil
                // Floating and hardware keyboards consume no docked inset.
                // Their frame event must also finish the picker transition.
                if fieldFocused { returningToKeyboard = false }
            }
        }
        .sheet(item: $pickerKind) { kind in
            switch kind {
            case .photoVideo: ChatPhotoVideoPicker { handlePicked($0) }
            case .camera: ChatCameraPicker { handlePicked($0) }
            case .file: ChatDocumentPicker { handlePicked($0) }
            }
        }
        .alert("Attachment not sent", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("Cancel", role: .cancel) { discardFailedAttachment() }
            Button("Retry") {
                if let failedAttachment { handlePicked(failedAttachment) }
            }
        } message: {
            Text(errorMessage ?? "Please try again.")
        }
    }

    private func selectAction(_ action: ChatAttachmentAction) {
        Haptics.selection()
        isFocused = false
        fieldFocused = false
        showsAttachments = false
        returningToKeyboard = false
        switch action {
        case .gif: onGif()
        case .buzz: onBuzz()
        case .photos, .camera, .files:
            pickedSend = onSend // Keep the originating room through sheet dismissal.
            switch action {
            case .photos: pickerKind = .photoVideo
            case .camera: pickerKind = .camera
            default: pickerKind = .file
            }
        }
    }

    private func discardFailedAttachment() {
        if let failedAttachment { try? FileManager.default.removeItem(at: failedAttachment.url) }
        failedAttachment = nil
        errorMessage = nil
    }

    private func handlePicked(_ picked: ChatPickedAttachment?) {
        pickerKind = nil
        guard let picked, !isSending else { return }
        let send = pickedSend ?? onSend
        isSending = true
        errorMessage = nil
        Task { @MainActor in
            defer { isSending = false }
            do {
                try await send(picked)
                try? FileManager.default.removeItem(at: picked.url)
                failedAttachment = nil
                Haptics.notify(.success)
            } catch {
                failedAttachment = picked
                Haptics.notify(.error)
                errorMessage = error.localizedDescription
            }
        }
    }
}

private enum ChatAttachmentAction { case photos, camera, files, gif, buzz }

private struct ChatAttachmentPanel: View {
    let canBuzz: Bool
    let isSending: Bool
    let onAction: (ChatAttachmentAction) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("A little more family").font(.headline)
                    Spacer()
                    Image(systemName: "sparkles").foregroundStyle(Palette.accent)
                }
                .foregroundStyle(Palette.text)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 130 : 88), spacing: 12)], spacing: 20) {
                    action("Photos", icon: "photo.on.rectangle.angled", color: Palette.blue, kind: .photos)
                        .accessibilityHint("Choose a photo or video")
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        action("Camera", icon: "camera.fill", color: Palette.coral, kind: .camera)
                    }
                    action("Files", icon: "doc.fill", color: Palette.teal, kind: .files)
                    action("GIFs", icon: "face.smiling.fill", color: Palette.violet, kind: .gif)
                    action("Buzz", icon: "wave.3.right.circle.fill", color: Palette.amber, kind: .buzz)
                        .disabled(!canBuzz)
                        .accessibilityHint(canBuzz ? "Confirm sending your draft as a Time Sensitive alert" : "Write a message first")
                }
                Text(isSending ? "Preparing your attachment…" : "Photos, little moments, and a nudge when it matters.")
                    .font(.footnote)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(20)
            .padding(.bottom, 12)
        }
        .background(Palette.panel)
        .accessibilityIdentifier("chat.attachments.panel")
    }

    private func action(_ title: String, icon: String, color: Color, kind: ChatAttachmentAction) -> some View {
        Button { onAction(kind) } label: {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 25, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: 58, height: 54)
                    .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
                Text(title).font(.subheadline.weight(.medium)).foregroundStyle(Palette.text)
            }
            .frame(maxWidth: .infinity, minHeight: 82)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .disabled(isSending)
        .accessibilityIdentifier("chat.attachments.\(title.lowercased())")
    }
}

private struct ChatCameraPicker: UIViewControllerRepresentable {
    let completion: (ChatPickedAttachment?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let completion: (ChatPickedAttachment?) -> Void
        init(completion: @escaping (ChatPickedAttachment?) -> Void) { self.completion = completion }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { completion(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard let photo = info[.originalImage] as? UIImage,
                  let data = photo.jpegData(compressionQuality: 0.9) else { completion(nil); return }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("fam-camera-\(UUID().uuidString).jpg")
            do {
                try data.write(to: url, options: .atomic)
                completion(ChatPickedAttachment(url: url, mimeType: "image/jpeg"))
            } catch { completion(nil) }
        }
    }
}

private struct ChatPhotoVideoPicker: UIViewControllerRepresentable {
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
        init(completion: @escaping (ChatPickedAttachment?) -> Void) { self.completion = completion }

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
                let picked = sourceURL.flatMap { Self.copyToTemporary($0, provider: provider, identifier: identifier) }
                DispatchQueue.main.async {
                    picker.dismiss(animated: true) { self.completion(error == nil ? picked : nil) }
                }
            }
        }

        private static func copyToTemporary(_ source: URL, provider: NSItemProvider, identifier: String) -> ChatPickedAttachment? {
            let type = UTType(identifier)
            let ext = source.pathExtension.isEmpty ? (type?.preferredFilenameExtension ?? "bin") : source.pathExtension
            let stem = (provider.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? provider.suggestedName! : "attachment")
                .replacingOccurrences(of: "/", with: "-")
                .replacingOccurrences(of: "\\", with: "-")
            let filename = stem.lowercased().hasSuffix(".\(ext.lowercased())") ? stem : "\(stem).\(ext)"
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString)-\(filename)")
            do {
                try FileManager.default.copyItem(at: source, to: destination)
                return ChatPickedAttachment(url: destination, mimeType: type?.preferredMIMEType ?? "application/octet-stream")
            } catch {
                return nil
            }
        }
    }
}

private struct ChatDocumentPicker: UIViewControllerRepresentable {
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
        init(completion: @escaping (ChatPickedAttachment?) -> Void) { self.completion = completion }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            completion(nil)
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let source = urls.first else { completion(nil); return }
            let name = source.lastPathComponent.isEmpty ? "attachment" : source.lastPathComponent
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString)-\(name)")
            let accessed = source.startAccessingSecurityScopedResource()
            defer { if accessed { source.stopAccessingSecurityScopedResource() } }
            do {
                try FileManager.default.copyItem(at: source, to: destination)
                let type = UTType(filenameExtension: source.pathExtension)
                completion(ChatPickedAttachment(url: destination, mimeType: type?.preferredMIMEType ?? "application/octet-stream"))
            } catch {
                completion(nil)
            }
        }
    }
}

// MARK: - Attachment bubble / preview

private actor ChatAttachmentLocalCache {
    static let shared = ChatAttachmentLocalCache()
    private var cached: [String: URL] = [:]
    private var inFlight: [String: Task<URL, Error>] = [:]

    func localURL(path: String, filename: String) async throws -> URL {
        if let url = cached[path], FileManager.default.fileExists(atPath: url.path) { return url }
        if let task = inFlight[path] { return try await task.value }
        let task = Task { try await APIClient.shared.downloadChatAttachment(path: path, suggestedFilename: filename) }
        inFlight[path] = task
        do {
            let url = try await task.value
            cached[path] = url
            inFlight[path] = nil
            return url
        } catch {
            inFlight[path] = nil
            throw error
        }
    }
}

private struct PreviewURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct ChatAttachmentBubble: View {
    let media: ChatMedia

    @State private var image: UIImage?
    @State private var isLoading = false
    @State private var preview: PreviewURL?
    @State private var errorMessage: String?

    private var filename: String { media.attachmentFilename }
    private var path: String { media.url ?? "" }
    private var kind: String { media.attachmentKind }

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: Space.sm) {
                if kind == "photo", let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: 260, minHeight: 140, maxHeight: 260)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                } else {
                    HStack(spacing: Space.sm) {
                        Image(systemName: icon)
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundStyle(Palette.accent)
                            .frame(width: 42, height: 42)
                            .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(filename)
                                .font(Typography.body.weight(.semibold))
                                .foregroundStyle(Palette.text)
                                .lineLimit(2)
                            Text(detail)
                                .font(Typography.caption)
                                .foregroundStyle(Palette.textSecond)
                        }
                        Spacer(minLength: 0)
                        if isLoading { ProgressView().tint(Palette.accent) }
                        else { Image(systemName: "arrow.down.circle").foregroundStyle(Palette.textSecond) }
                    }
                    .padding(Space.sm)
                    .frame(maxWidth: 280, alignment: .leading)
                    .background(Palette.panel2, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))
                }
            }
        }
        .buttonStyle(.plain)
        .task(id: path) { await loadPhotoPreviewIfNeeded() }
        .sheet(item: $preview) { item in QuickLookSheet(url: item.url) }
        .alert("Attachment unavailable", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Please try again.")
        }
        .accessibilityLabel("\(kind.capitalized) attachment, \(filename), \(detail)")
        .accessibilityHint("Opens the attachment")
    }

    private var icon: String {
        switch kind {
        case "photo": return "photo.fill"
        case "video": return "play.rectangle.fill"
        default: return "doc.fill"
        }
    }

    private var detail: String {
        let bytes = Int64(media.attachmentByteSize)
        let size = bytes > 0 ? ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file) : "File"
        switch kind {
        case "photo": return "Photo · \(size)"
        case "video": return "Video · \(size)"
        default: return size
        }
    }

    private func loadPhotoPreviewIfNeeded() async {
        guard kind == "photo", image == nil, !path.isEmpty else { return }
        do {
            let local = try await ChatAttachmentLocalCache.shared.localURL(path: path, filename: filename)
            guard !Task.isCancelled else { return }
            image = await Task.detached(priority: .utility) {
                Self.downsampledImage(at: local, maxPixelSize: 520)
            }.value
        } catch {
            // Keep the compact file-style fallback rather than surfacing an
            // alert just because a thumbnail could not pre-load.
        }
    }

    private static func downsampledImage(at url: URL, maxPixelSize: CGFloat) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions) else { return nil }
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ] as CFDictionary
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    private func open() {
        guard !path.isEmpty, !isLoading else { return }
        isLoading = true
        Task { @MainActor in
            defer { isLoading = false }
            do {
                let local = try await ChatAttachmentLocalCache.shared.localURL(path: path, filename: filename)
                preview = PreviewURL(url: local)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct QuickLookSheet: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        context.coordinator.url = url
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {
        context.coordinator.url = url
        uiViewController.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
