import Foundation
import SwiftUI
import Observation

/// The single source of truth for the native surfaces: the signed-in user's
/// family (with its kids) and the chat thread. Cache-first load gives an
/// instant, spinner-free cold start; chat is kept fresh with a debounced poll
/// (mirrors the RetireOdds `scheduleSim` debounce pattern, applied to
/// `GET /api/chat/messages?since=`).
@MainActor
@Observable
final class AppStore {
    // State
    var family: Family?
    var messages: [ChatMessage] = []
    var isRefreshing = false
    var needsAuth = false
    var syncError: String?

    var kids: [Kid] { family?.kids ?? [] }

    // Collaborators
    private let api = APIClient.shared
    private let cache = DiskCache()
    private var pollTask: Task<Void, Never>?

    // MARK: Lifecycle

    /// Render from cache immediately (if present), then refresh from the network.
    func load() async {
        loadTheme()
        if family == nil, let cached = cache.load() {
            family = cached.family
            messages = cached.messages
        }
        await refresh()
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let fams = try await api.families()
            family = fams.first
            if family != nil {
                messages = try await api.chatMessages(limit: 50)
            }
            syncError = nil
            needsAuth = false
            persist()
            scheduleChatPoll()
        } catch APIError.unauthenticated {
            needsAuth = true
        } catch {
            syncError = error.localizedDescription
        }
    }

    func signedOut() {
        pollTask?.cancel()
        cache.clear()
        family = nil
        messages = []
        needsAuth = true
    }

    // MARK: Appearance

    /// Effective appearance: an explicit user override, or `nil` to follow the
    /// device (iOS Settings → Display). The whole palette is built from
    /// `Color.adaptive(light, dark)`, so this flips every surface at once.
    var themeOverride: ColorScheme?
    private let themeKey = "fam_theme"

    var colorScheme: ColorScheme? { themeOverride }

    func loadTheme() {
        switch UserDefaults.standard.string(forKey: themeKey) {
        case "light": themeOverride = .light
        case "dark": themeOverride = .dark
        default: themeOverride = nil
        }
    }

    func setTheme(_ scheme: ColorScheme?) {
        themeOverride = scheme
        switch scheme {
        case .light: UserDefaults.standard.set("light", forKey: themeKey)
        case .dark: UserDefaults.standard.set("dark", forKey: themeKey)
        default: UserDefaults.standard.removeObject(forKey: themeKey)
        }
    }

    // MARK: Family mutations

    func createFamily(name: String) async throws {
        family = try await api.createFamily(name: name)
        persist()
    }
    func joinFamily(code: String) async throws {
        family = try await api.joinFamily(code: code)
        persist()
    }
    func addKid(name: String, grade: String, color: String) async {
        do {
            let r = try await api.addKid(name: name, grade: grade, color: color)
            family = r.family
            persist()
        } catch { handle(error) }
    }
    func updateKid(_ kidId: String, _ patch: [String: Any]) async {
        do {
            let r = try await api.updateKid(kidId, patch)
            family = r.family
            persist()
        } catch { handle(error) }
    }
    func deleteKid(_ kidId: String) async {
        do {
            family = try await api.deleteKid(kidId)
            persist()
        } catch { handle(error) }
    }
    func removeMember(_ userId: String) async {
        do {
            family = try await api.removeMember(userId)
            persist()
        } catch { handle(error) }
    }

    // MARK: Chat

    /// Debounced re-poll after sending a message or on a timer (mirrors web
    /// long-poll behavior). Cancels any in-flight poll before scheduling a new one.
    func scheduleChatPoll() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            await self?.pollChat()
        }
    }

    private func pollChat() async {
        guard family != nil else { return }
        if let fresh = try? await api.chatMessages(limit: 50) {
            messages = fresh
            persist()
        }
        scheduleChatPoll()
    }

    func sendMessage(text: String, card: [String: Any]? = nil, senderType: String = "parent", senderId: String) async {
        do {
            let msg = try await api.sendChatMessage(text: text, card: card, senderType: senderType, senderId: senderId)
            messages.append(msg)
            persist()
        } catch { handle(error) }
    }
    func deleteMessage(_ id: String) async {
        do {
            let updated = try await api.deleteChatMessage(id)
            if let idx = messages.firstIndex(where: { $0.id == id }) { messages[idx] = updated }
            persist()
        } catch { handle(error) }
    }
    func flagMessage(_ id: String, reason: String) async {
        do {
            let updated = try await api.flagChatMessage(id, reason: reason)
            if let idx = messages.firstIndex(where: { $0.id == id }) { messages[idx] = updated }
            persist()
        } catch { handle(error) }
    }

    // MARK: Persistence / errors

    private func persist() {
        cache.save(CachedAppData(family: family, messages: messages))
    }

    private func handle(_ error: Error) {
        if case APIError.unauthenticated = error { needsAuth = true }
        else { syncError = error.localizedDescription }
    }
}
