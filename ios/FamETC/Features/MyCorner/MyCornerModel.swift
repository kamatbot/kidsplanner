import Foundation

struct CornerSticker: Codable, Identifiable, Equatable {
    var id: String
    var stickerId: String
    var x: Double
    var y: Double
    var rotation: Double
}
struct CornerDocument: Codable, Equatable {
    var revision: Int
    var note: String
    var stickers: [CornerSticker]
    static let empty = CornerDocument(revision: 0, note: "", stickers: [])
    static let choices = [
        "tuk-tuk", "mango-sticky-rice", "boba", "monsoon-cloud", "leaf-umbrella", "small-star",
        "sleepy-cat", "happy-capybara", "space-rocket", "tiny-planet", "rainbow", "lucky-frog",
        "bookworm", "clever-fox", "headphones", "game-controller", "roller-skate", "sunshine",
        "strawberry", "ice-cream", "pizza-slice", "ocean-turtle", "mountain", "paper-plane"
    ]
    static func label(_ id: String) -> String { id.replacingOccurrences(of: "-", with: " ") }
}

/// No disk cache. Capture the authenticated session when opening the editor so
/// an outstanding save can never attach an old draft to a newly signed-in child.
final class CornerService {
    private let session: URLSession
    private let cookie: String
    private let ownerID: String
    init(ownerID: String, configuration: URLSessionConfiguration = .ephemeral) {
        self.ownerID = ownerID
        let config = configuration
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.httpAdditionalHeaders = Config.clientHeaders
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        session = URLSession(configuration: config)
        let cookies = HTTPCookieStorage.shared.cookies(for: Config.baseURL) ?? []
        cookie = HTTPCookie.requestHeaderFields(with: cookies)["Cookie"] ?? ""
    }
    func request(_ value: CornerDocument? = nil) async throws -> CornerDocument {
        var request = URLRequest(url: Config.baseURL.appendingPathComponent("api/my-corner"))
        request.httpMethod = value == nil ? "GET" : "PUT"
        request.httpShouldHandleCookies = false
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        request.setValue(ownerID, forHTTPHeaderField: "X-Fam-Corner-Account")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let value { request.httpBody = try JSONEncoder().encode(value) }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw APIError.badURL }
        guard response.statusCode == 200 else {
            let error = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.http(response.statusCode, error ?? "Could not load or save your corner. Please retry.")
        }
        return try JSONDecoder().decode(CornerDocument.self, from: data)
    }
    deinit { session.invalidateAndCancel() }
}

@MainActor @Observable final class MyCornerModel {
    var draft: CornerDocument?
    var latest: CornerDocument?
    var selected: String?
    var busy = false
    var dirty = false
    var message = "Loading your corner…"
    private var generation = 0
    private let request: (CornerDocument?) async throws -> CornerDocument
    init(request: @escaping (CornerDocument?) async throws -> CornerDocument) { self.request = request }
    func clear() { generation += 1; draft = nil; latest = nil; selected = nil; dirty = false; busy = false }
    func load() async {
        guard !busy else { return }
        busy = true; let token = generation
        do {
            let result = try await request(nil)
            guard token == generation else { return }
            draft = result; dirty = false; message = "Add a sticker, then tap to place or use the controls."
        } catch { if token == generation { message = error.localizedDescription } }
        if token == generation { busy = false }
    }
    func save() async {
        guard !busy, latest == nil, let draft else { return }
        busy = true; message = "Saving…"; let token = generation
        do {
            let result = try await request(draft)
            guard token == generation else { return }
            self.draft = result; dirty = false; message = "Saved."
        } catch {
            guard token == generation else { return }
            message = error.localizedDescription + " Your draft is preserved."
            if case APIError.http(409, _) = error {
                do {
                    let result = try await request(nil)
                    guard token == generation else { return }
                    latest = result
                } catch { if token == generation { message = "Could not load the other version. Your draft is preserved; retry Save changes." } }
            }
        }
        if token == generation { busy = false }
    }
    func edit(_ change: (inout CornerDocument) -> Void) {
        guard !busy, var value = draft else { return }
        change(&value); draft = value; dirty = true; message = "Unsaved changes"
    }
    func add(_ id: String) {
        guard let draft, draft.stickers.count < 18, CornerDocument.choices.contains(id) else { return }
        let item = CornerSticker(id: UUID().uuidString, stickerId: id, x: 0.5, y: 0.65, rotation: 0)
        edit { $0.stickers.append(item) }; selected = item.id
    }
    func move(x: Double? = nil, y: Double? = nil, dx: Double = 0, dy: Double = 0, rotate: Bool = false) {
        edit { value in
            guard let i = value.stickers.firstIndex(where: { $0.id == selected }) else { return }
            value.stickers[i].x = min(1, max(0, x ?? value.stickers[i].x + dx))
            value.stickers[i].y = min(1, max(0, y ?? value.stickers[i].y + dy))
            if rotate { value.stickers[i].rotation = value.stickers[i].rotation >= 180 ? -165 : value.stickers[i].rotation + 15 }
        }
    }
    func remove() { edit { $0.stickers.removeAll { $0.id == selected } }; selected = nil }
    func useLatest() { guard let latest else { return }; draft = latest; self.latest = nil; dirty = false; selected = nil; message = "Latest saved corner loaded." }
    func keepDraft() { guard let latest else { return }; draft?.revision = latest.revision; self.latest = nil; message = "Save changes will replace the latest version you reviewed." }
}
