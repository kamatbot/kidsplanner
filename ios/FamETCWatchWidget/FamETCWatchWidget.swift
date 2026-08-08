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
        completion(FamETCComplicationEntry(date: Date(), snapshot: WatchComplicationSnapshotStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FamETCComplicationEntry>) -> Void) {
        let now = Date()
        let entry = FamETCComplicationEntry(date: now, snapshot: WatchComplicationSnapshotStore.load())
        // The watch app explicitly reloads this timeline after each successful
        // refresh. This fallback keeps a stale snapshot visible without any
        // widget-side polling or network activity.
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(15 * 60))))
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
                    Image(systemName: "bolt.fill")
                        .font(.caption2)
                    Text("\(entry.snapshot.urgentCount)")
                        .font(.headline)
                }
            }
        case .accessoryInline:
            Text(inlineText)
        default:
            HStack(spacing: 6) {
                Image(systemName: "bolt.fill")
                VStack(alignment: .leading, spacing: 0) {
                    Text("My next")
                        .font(.caption2)
                    Text("\(entry.snapshot.urgentCount) urgent · \(entry.snapshot.homeworkCount) hw · \(entry.snapshot.shoppingCount) groceries")
                        .font(.caption)
                        .lineLimit(2)
                }
            }
        }
    }

    private var inlineText: String {
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
