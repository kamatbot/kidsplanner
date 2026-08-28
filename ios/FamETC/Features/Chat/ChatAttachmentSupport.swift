import Foundation
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

    // The server keeps these aliases populated for older iOS ChatMedia decoders:
    // previewUrl = original filename, width = byte size, height = kind code.
    var attachmentFilename: String { previewUrl?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? previewUrl! : "Attachment" }
    var attachmentByteSize: Int { max(0, width ?? 0) }
    var attachmentKind: String {
        switch height {
        case 1: return "photo"
        case 2: return "video"
        default: return "file"
        }
    }
}

// MARK: - Authenticated attachment HTTP

private enum ChatAttachmentHTTP {
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
        if let url = URL(string: path), url.scheme != nil { return url }
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return URL(string: trimmed, relativeTo: Config.baseURL)?.absoluteURL
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
        let escapedName = fileURL.lastPathComponent.replacingOccurrences(of: "\"", with: "'")
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
        guard let url = ChatAttachmentHTTP.absoluteURL(path) else { throw APIError.badURL }
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

// MARK: - Picker menu

struct ChatAttachmentMenu: View {
    let onSend: (ChatPickedAttachment) async throws -> Void

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
            .frame(width: 42, height: 42)
            .background(Palette.accentSoft, in: Circle())
        }
        .disabled(isSending)
        .accessibilityLabel(isSending ? "Sending attachment" : "Add photo, video, or file")
        .sheet(item: $pickerKind) { kind in
            switch kind {
            case .photoVideo:
                ChatPhotoVideoPicker { picked in handlePicked(picked) }
            case .file:
                ChatDocumentPicker { picked in handlePicked(picked) }
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
                try await onSend(picked)
                Haptics.notify(.success)
            } catch {
                Haptics.notify(.error)
                errorMessage = error.localizedDescription
            }
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
            image = UIImage(contentsOfFile: local.path)
        } catch {
            // Keep the compact file-style fallback rather than surfacing an
            // alert just because a thumbnail could not pre-load.
        }
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
