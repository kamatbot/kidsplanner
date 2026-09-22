import AppIntents

private enum FamilyNeedsDay {
    case today, tomorrow

    var label: String { self == .today ? "today" : "tomorrow" }

    func dialog(child entity: FamilyChildEntity) async -> IntentDialog {
        guard let snapshot = FamilyAssistanceSnapshotStore.load() else {
            return "Sign in to Fam ETC and refresh your family before asking."
        }
        guard snapshot.isFresh() else {
            return "Fam ETC's family information is out of date. Open the app and refresh before asking again."
        }
        guard let child = snapshot.child(id: entity.id) else {
            return "That child is not available in the signed-in family. Open Fam ETC and choose again."
        }
        guard await SiriFamilyAuthorization.isCurrentParent(of: snapshot, childID: entity.id) else {
            await ParentFamilyAssistancePublisher.clear()
            return "Fam ETC couldn't verify the signed-in parent and family. Open the app and sign in again."
        }
        let activities = self == .today ? child.todayActivities : child.tomorrowActivities
        let homework = self == .today ? child.todayHomework : child.tomorrowHomework
        let activityCount = self == .today ? child.todayActivityCount : child.tomorrowActivityCount
        let homeworkCount = self == .today ? child.todayHomeworkCount : child.tomorrowHomeworkCount
        var facts: [String] = []
        if child.calendarAvailable {
            facts.append(activities.isEmpty ? "no scheduled activities" : summarized(activities.map { itemText($0) }, total: activityCount))
        } else {
            facts.append("calendar information is unavailable")
        }
        if child.homeworkAvailable {
            facts.append(homework.isEmpty ? "no open homework due" : summarized(homework.map {
                let due: String
                if self == .today && $0.dateKey < snapshot.dayKey {
                    due = "overdue homework due \($0.dateKey)"
                } else if self == .today {
                    due = "homework due today"
                } else {
                    due = "homework due tomorrow"
                }
                return "\(due): \($0.title)"
            }, total: homeworkCount))
        } else {
            facts.append("homework information is unavailable")
        }
        return "For \(child.name) \(label): \(facts.joined(separator: "; "))."
    }

    private func itemText(_ item: FamilyAssistanceItem) -> String {
        item.timeText.map { "\(item.title) at \($0)" } ?? item.title
    }

    private func summarized(_ items: [String], total: Int) -> String {
        let more = max(0, total - items.count)
        return items.joined(separator: ", ") + (more > 0 ? ", and \(more) more" : "")
    }
}

enum SiriFamilyAuthorization {
    /// Siri does not trust the cached projection as proof of authorization.
    /// Every spoken query validates the live cookie session, parent identity,
    /// family membership, and the exact account/family that wrote the file.
    static func isCurrentParent(of snapshot: FamilyAssistanceSnapshot, childID: String) async -> Bool {
        do {
            guard let user = try await APIClient.shared.me().user else { return false }
            let families = try await APIClient.shared.families()
            return isAuthorized(user: user, families: families, snapshot: snapshot, childID: childID)
        } catch {
            return false
        }
    }

    static func isAuthorized(user: User, families: [Family], snapshot: FamilyAssistanceSnapshot, childID: String) -> Bool {
        guard user.id == snapshot.accountID, user.role != "kid",
              let family = families.first(where: { $0.id == snapshot.familyID }),
              family.parentIds.contains(user.id) else { return false }
        return family.kids.contains { $0.id == childID }
    }
}

struct ChildNeedsTodayIntent: AppIntent {
    static let title: LocalizedStringResource = "What does my child need today?"
    static let description = IntentDescription("Reads today's saved family schedule and homework without making changes.")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Child") var child: FamilyChildEntity

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await FamilyNeedsDay.today.dialog(child: child))
    }
}

struct ChildNeedsTomorrowIntent: AppIntent {
    static let title: LocalizedStringResource = "What does my child need tomorrow?"
    static let description = IntentDescription("Reads tomorrow's saved family schedule and homework without making changes.")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Child") var child: FamilyChildEntity

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await FamilyNeedsDay.tomorrow.dialog(child: child))
    }
}

struct FamETCFamilyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ChildNeedsTodayIntent(), phrases: [
            "What does \(\.$child) need today in \(.applicationName)",
            "Ask \(.applicationName) what \(\.$child) needs today"
        ], shortTitle: "Child needs today", systemImageName: "sun.max")
        AppShortcut(intent: ChildNeedsTomorrowIntent(), phrases: [
            "What does \(\.$child) need tomorrow in \(.applicationName)",
            "Ask \(.applicationName) what \(\.$child) needs tomorrow"
        ], shortTitle: "Child needs tomorrow", systemImageName: "calendar")
    }
}
