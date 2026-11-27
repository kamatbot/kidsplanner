import AppIntents
import Foundation

/// "Hey Siri, add plans in Fam ETC" on the kid's watch. Siri asks "What should
/// I add?", the kid says everything at once, and the server adds each event and
/// reminder for that kid (same call as the Add plans screen). Siri reads back
/// what was added or the exact reason it wasn't.
struct AddPlansIntent: AppIntent {
    static let title: LocalizedStringResource = "Add plans"
    static let description = IntentDescription("Add events and reminders to your Fam ETC calendar by saying them. You can say several at once.")
    static let openAppWhenRun = false

    @Parameter(title: "Plans", requestValueDialog: IntentDialog("What should I add?"))
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        // The server decides who may add; the cached profile only gives a
        // friendlier answer to a parent's watch without a round trip.
        if let profile = WatchStore.shared.snapshot.context?.profile, profile.role != "kid" {
            return .result(dialog: "Adding plans by voice is for kids' watches. Parents can ask Hermes in the family chat.")
        }
        do {
            let result = try await WatchPlansService.shared.add(text, requestId: UUID().uuidString, via: "siri")
            return .result(dialog: "\(result.spokenReply)")
        } catch {
            return .result(dialog: "\(WatchPlansService.message(for: error))")
        }
    }
}

struct FamETCWatchShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddPlansIntent(), phrases: [
            "Add plans in \(.applicationName)",
            "Add plans to \(.applicationName)",
            "Add to \(.applicationName)",
            "Add an event in \(.applicationName)",
            "Add a reminder in \(.applicationName)",
            "Plan with \(.applicationName)",
        ], shortTitle: "Add plans", systemImageName: "calendar.badge.plus")
    }
}
