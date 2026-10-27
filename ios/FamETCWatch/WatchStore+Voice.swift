import Foundation

/// Voice notes and reactions for family chat. Kept out of WatchStore.swift:
/// voice sends go through `WatchVoiceOutbox` (durable, separate from the
/// check-off outbox) and results come back through `acceptChatMessages`.
@MainActor
extension WatchStore {
    /// Confirmed messages plus local bubbles for unconfirmed voice notes.
    var chatMessagesForDisplay: [WatchChatMessage] {
        let confirmed = snapshot.chat ?? []
        return confirmed + WatchVoiceOutbox.shared.pendingMessages(profile: snapshot.context?.profile, confirmed: confirmed)
    }

    /// Saves the recording durably first, then tries to send it.
    @discardableResult
    func sendVoice(recordingAt url: URL, durationMs: Int) async -> Bool {
        guard let profile = snapshot.context?.profile, !chatUnavailable else {
            try? FileManager.default.removeItem(at: url)
            return false
        }
        do {
            try WatchVoiceOutbox.shared.enqueue(recordingAt: url, durationMs: durationMs, profile: profile)
        } catch {
            try? FileManager.default.removeItem(at: url)
            return false
        }
        await drainVoice()
        return true
    }

    /// Retries queued voice notes; cheap to call whenever the watch is online.
    func drainVoice() async {
        guard !WatchVoiceOutbox.shared.items.isEmpty else { return }
        await WatchVoiceOutbox.shared.drain(profile: snapshot.context?.profile) { [weak self] messages in
            self?.acceptChatMessages(messages)
        }
    }

    /// Reacts with 👍/❤️/😂 through the reactions API. If this watch may not
    /// react (older server) or the emoji has no reaction key, the emoji is
    /// sent as a reply instead, as the brief allows.
    func react(to message: WatchChatMessage, emoji: String) async {
        guard let key = WatchChatEmoji.reactionKey(for: emoji), message.pending != true,
              !message.id.hasPrefix("local-"), !message.id.hasPrefix(WatchVoiceDraft.localPrefix) else {
            await sendChat(emoji)
            return
        }
        do {
            let updated = try await URLSessionWatchAPIClient().toggleReaction(messageId: message.id, reaction: key)
            acceptChatMessages([updated])
        } catch {
            // Refused (403) or offline: a reaction is not queued, but a reply
            // goes through the durable outbox, so the emoji still arrives.
            await sendChat(emoji)
        }
    }

    /// Did the current wearer already choose this reaction?
    func hasReacted(_ message: WatchChatMessage, emoji: String) -> Bool {
        guard let key = WatchChatEmoji.reactionKey(for: emoji), let userId = snapshot.context?.profile.userId else { return false }
        return message.reactions?.contains { $0.key == key && ($0.userIds ?? []).contains(userId) } == true
    }
}
