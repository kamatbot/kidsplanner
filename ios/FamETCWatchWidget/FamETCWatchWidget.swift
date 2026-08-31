import SwiftUI
import WidgetKit

private struct FamETCComplicationEntry: TimelineEntry {
    let date: Date
    let snapshot: FamETCWatchComplicationSnapshot
}

private struct FamETCComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> FamETCComplicationEntry {
        FamETCComplicationEntry(date: Date(), snapshot: FamETCWatchComplicationSnapshot(urgentCount: 1, homeworkCount: 2, shoppingCount: 3))
    }

    func getSnapshot(in context: Context, completion: @escaping (FamETCComplicationEntry) -> Void) {
        let now = Date()
        completion(FamETCComplicationEntry(date: now, snapshot: snapshotForDisplay(at: now)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FamETCComplicationEntry>) -> Void) {
        let now = Date()
        let stored = WatchComplicationSnapshotStore.load()
        var entries = [FamETCComplicationEntry(
            date: now,
            snapshot: stored.isFocusActive(at: now) ? stored : inactiveSnapshot(from: stored)
        )]
        if let focusEndsAt = stored.focusEndsAt, stored.isFocusActive(at: now), focusEndsAt > now {
            entries.append(FamETCComplicationEntry(
                date: focusEndsAt,
                snapshot: inactiveSnapshot(from: stored)
            ))
        }
        // The watch app explicitly reloads this timeline after each refresh or
        // focus action. The dated entry above also removes aggregate focus at
        // the end of a block without exposing any private assignment content.
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(15 * 60))))
    }

    private func snapshotForDisplay(at date: Date) -> FamETCWatchComplicationSnapshot {
        let stored = WatchComplicationSnapshotStore.load()
        return stored.isFocusActive(at: date) ? stored : inactiveSnapshot(from: stored)
    }

    private func inactiveSnapshot(from snapshot: FamETCWatchComplicationSnapshot) -> FamETCWatchComplicationSnapshot {
        FamETCWatchComplicationSnapshot(
            urgentCount: snapshot.urgentCount,
            homeworkCount: snapshot.homeworkCount,
            shoppingCount: snapshot.shoppingCount,
            updatedAt: snapshot.updatedAt
        )
    }
}

private struct FamETCComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FamETCComplicationEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: entry.snapshot.isFocusActive(at: entry.date) ? "timer" : "bolt.fill")
                        .font(.caption2)
                    Text(entry.snapshot.isFocusActive(at: entry.date) ? "Focus" : "\(entry.snapshot.urgentCount)")
                        .font(.headline)
                }
            }
        case .accessoryInline:
            Text(inlineText)
        default:
            HStack(spacing: 6) {
                Image(systemName: entry.snapshot.isFocusActive(at: entry.date) ? "timer" : "bolt.fill")
                VStack(alignment: .leading, spacing: 0) {
                    Text(entry.snapshot.isFocusActive(at: entry.date) ? "Focus" : "My next")
                        .font(.caption2)
                    Text("\(entry.snapshot.urgentCount) urgent · \(entry.snapshot.homeworkCount) hw · \(entry.snapshot.shoppingCount) groceries")
                        .font(.caption)
                        .lineLimit(2)
                }
            }
        }
    }

    private var inlineText: String {
        if entry.snapshot.isFocusActive(at: entry.date) {
            return "Focus · \(entry.snapshot.urgentCount) urgent · \(entry.snapshot.homeworkCount) homework"
        }
        "My next: \(entry.snapshot.urgentCount) urgent · \(entry.snapshot.homeworkCount) homework · \(entry.snapshot.shoppingCount) groceries"
    }
}

@main
struct FamETCWatchWidget: Widget {
    let kind = "FamETCWatchComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FamETCComplicationProvider()) { entry in
            FamETCComplicationView(entry: entry)
        }
        .configurationDisplayName("Fam ETC")
        .description("See what needs attention next.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
