import Foundation

/// My list, chores and complication helpers. Everything here reads public
/// store state; durable writes go through `submitChore`/`completeAction`/
/// `finishAssignment`, which persist before any request.
extension WatchStore {
    /// Today's homework + chores, for My list.
    var myListItems: [WatchMyListItem] { WatchMyList.items(snapshot: snapshot) }

    /// Open homework + timed family actions + pending Fams chores for today.
    /// Shown on the chat header's to-do capsule.
    var openTodoCount: Int { WatchMyList.openCount(snapshot: snapshot) }

    /// Completes a My list row and returns the Done screen content, or nil when
    /// the item was already finished.
    @discardableResult
    func completeMyListItem(_ item: WatchMyListItem, now: Date = Date()) async -> WatchDoneSummary? {
        guard !item.isDone else { return nil }
        switch item.source {
        case .homework(let work):
            guard let current = snapshot.homework.first(where: { $0.id == work.id }), !current.isDone else { return nil }
            await finishAssignment(current)
        case .action(let action):
            guard let current = snapshot.actions.first(where: { $0.id == action.id }), !current.isDone else { return nil }
            await completeAction(current)
        case .fams(let chore):
            guard let current = snapshot.chores?.first(where: { $0.id == chore.id }), current.isOpen else { return nil }
            await submitChore(current)
        }
        return WatchMyList.summary(after: item, snapshot: snapshot, now: now)
    }

    /// The aggregate the complication reads: counts, focus timing, today's
    /// progress, and the next item's category and time. Never a title.
    func complicationSnapshot(now: Date = Date()) -> FamETCWatchComplicationSnapshot {
        let items = WatchMyList.items(snapshot: snapshot, now: now)
        let next = items.first { !$0.isDone }
        return FamETCWatchComplicationSnapshot(
            urgentCount: snapshot.urgentActions.count,
            homeworkCount: snapshot.openHomework.count,
            shoppingCount: snapshot.openShopping.count,
            updatedAt: snapshot.updatedAt,
            focusActive: focusSession != nil && focusSession?.pausedAt == nil && !(focusSession?.isComplete(at: now) ?? true),
            focusEndsAt: focusSession?.pausedAt == nil ? focusSession?.endsAt : nil,
            todoDone: items.filter(\.isDone).count,
            todoTotal: items.count,
            nextKind: next?.complicationKind,
            nextDueAt: next?.dueAt
        )
    }
}
