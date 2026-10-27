import SwiftUI
import WidgetKit

private let homeworkOrange = Color(red: 1, green: 159 / 255, blue: 69 / 255)
private let choreTeal = Color(red: 47 / 255, green: 211 / 255, blue: 181 / 255)

private struct FamETCComplicationEntry: TimelineEntry {
    let date: Date
    let snapshot: FamETCWatchComplicationSnapshot
}

private struct FamETCComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> FamETCComplicationEntry {
        FamETCComplicationEntry(date: Date(), snapshot: FamETCWatchComplicationSnapshot(
            urgentCount: 1, homeworkCount: 2, shoppingCount: 3,
            todoDone: 1, todoTotal: 4, nextKind: "homework", nextDueAt: Date().addingTimeInterval(8 * 60)))
    }

    func getSnapshot(in context: Context, completion: @escaping (FamETCComplicationEntry) -> Void) {
        let now = Date()
        completion(FamETCComplicationEntry(date: now, snapshot: snapshotForDisplay(at: now)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FamETCComplicationEntry>) -> Void) {
        let now = Date()
        let stored = WatchComplicationSnapshotStore.load()
        var dates: Set<Date> = [now]
        if let focusEndsAt = stored.focusEndsAt, stored.isFocusActive(at: now), focusEndsAt > now {
            dates.insert(focusEndsAt)
        }
        // "in 8 min" is written per entry: one entry a minute through the last
        // hour before the next to-do, then one at its due time.
        if let due = stored.nextDueAt, due > now {
            let start = max(now, due.addingTimeInterval(-3600))
            var minute = start
            while minute < due {
                if minute > now { dates.insert(minute) }
                minute = minute.addingTimeInterval(60)
            }
            dates.insert(due)
        }
        let entries = dates.sorted().map { date in
            FamETCComplicationEntry(date: date, snapshot: stored.isFocusActive(at: date) ? stored : inactiveSnapshot(from: stored))
        }
        // The watch app explicitly reloads this timeline after each refresh or
        // focus action. Entries carry only aggregates, never assignment content.
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
            updatedAt: snapshot.updatedAt,
            todoDone: snapshot.todoDone,
            todoTotal: snapshot.todoTotal,
            nextKind: snapshot.nextKind,
            nextDueAt: snapshot.nextDueAt
        )
    }
}

/// "in 8 min", "at 5:00 PM", or "Due now" for the entry's moment.
private func famComplicationTimeText(due: Date?, at date: Date) -> String? {
    guard let due else { return nil }
    let seconds = due.timeIntervalSince(date)
    if seconds <= 0 { return "Due now" }
    let minutes = Int((seconds / 60).rounded(.up))
    if minutes <= 60 { return "in \(minutes) min" }
    return "at \(due.formatted(date: .omitted, time: .shortened))"
}

private struct FamETCComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FamETCComplicationEntry

    private var snapshot: FamETCWatchComplicationSnapshot { entry.snapshot }
    private var focus: Bool { snapshot.isFocusActive(at: entry.date) }
    private var nextColor: Color { snapshot.nextKind == "homework" ? homeworkOrange : choreTeal }
    private var nextLabel: String {
        switch snapshot.nextKind {
        case "homework": return "Homework next"
        case "chore": return "Chore next"
        default: return snapshot.todoTotal > 0 && snapshot.todoDone >= snapshot.todoTotal ? "All done!" : "My list"
        }
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                if !focus && snapshot.todoTotal > 0 {
                    ProgressRing(done: snapshot.todoDone, total: snapshot.todoTotal, color: nextColor, lineWidth: 4)
                        .padding(3)
                    Text("\(snapshot.todoTotal - snapshot.todoDone)")
                        .font(.system(.title3, design: .rounded).weight(.heavy))
                } else {
                    VStack(spacing: 0) {
                        Image(systemName: focus ? "timer" : "bolt.fill")
                            .font(.caption2)
                        Text(focus ? "Focus" : "\(snapshot.urgentCount)")
                            .font(.headline)
                    }
                }
            }
            .widgetAccentable()
        case .accessoryInline:
            Text(inlineText)
        default:
            if !focus && snapshot.todoTotal > 0 {
                HStack(spacing: 8) {
                    ZStack {
                        ProgressRing(done: snapshot.todoDone, total: snapshot.todoTotal, color: nextColor, lineWidth: 4)
                        Text("\(snapshot.todoDone)/\(snapshot.todoTotal)")
                            .font(.system(size: 10, weight: .heavy, design: .rounded))
                            .minimumScaleFactor(0.6)
                    }
                    .frame(width: 34, height: 34)
                    .widgetAccentable()
                    VStack(alignment: .leading, spacing: 0) {
                        Text(nextLabel)
                            .font(.system(.headline, design: .rounded).weight(.bold))
                            .foregroundStyle(nextColor)
                            .lineLimit(1)
                        Text(famComplicationTimeText(due: snapshot.nextDueAt, at: entry.date)
                             ?? "\(snapshot.todoDone) of \(snapshot.todoTotal) done")
                            .font(.system(.body, design: .rounded).weight(.semibold))
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            } else {
                HStack(spacing: 6) {
                    Image(systemName: focus ? "timer" : "bolt.fill")
                    VStack(alignment: .leading, spacing: 0) {
                        Text(focus ? "Focus" : "My next")
                            .font(.caption2)
                        Text("\(snapshot.urgentCount) tasks · \(snapshot.homeworkCount) homework")
                            .font(.caption)
                            .lineLimit(2)
                    }
                }
            }
        }
    }

    private var inlineText: String {
        if focus {
            return "Focus · \(snapshot.urgentCount) urgent · \(snapshot.homeworkCount) homework"
        }
        if snapshot.todoTotal > 0 {
            if let time = famComplicationTimeText(due: snapshot.nextDueAt, at: entry.date), snapshot.nextKind != nil {
                return "\(nextLabel.replacingOccurrences(of: " next", with: "")) \(time)"
            }
            return "\(snapshot.todoDone) of \(snapshot.todoTotal) done"
        }
        return "Next: \(snapshot.urgentCount) tasks · \(snapshot.homeworkCount) homework"
    }
}

private struct ProgressRing: View {
    let done: Int
    let total: Int
    let color: Color
    let lineWidth: CGFloat

    var body: some View {
        let progress = total > 0 ? Double(done) / Double(total) : 0
        ZStack {
            Circle().stroke(color.opacity(0.3), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
}

struct FamETCWatchWidget: Widget {
    let kind = "FamETCWatchComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FamETCComplicationProvider()) { entry in
            FamETCComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Fam ETC")
        .description("Your next to-do and today's progress.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// Deep links handled by WatchChatView's onOpenURL (WatchChatRoute.chatURL /
// talkURL in the app target; the widget cannot import app code).
private let famChatURL = URL(string: "fametc-watch://chat")!
private let famTalkURL = URL(string: "fametc-watch://talk")!

private struct FamStaticEntry: TimelineEntry { let date: Date }

private struct FamStaticProvider: TimelineProvider {
    func placeholder(in context: Context) -> FamStaticEntry { FamStaticEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (FamStaticEntry) -> Void) { completion(FamStaticEntry(date: Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<FamStaticEntry>) -> Void) {
        completion(Timeline(entries: [FamStaticEntry(date: Date())], policy: .never))
    }
}

/// Chat shortcut. ponytail: no unread badge yet; the app keeps no read state
/// to aggregate into the complication snapshot.
struct FamETCChatShortcutWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FamETCChatShortcut", provider: FamStaticProvider()) { _ in
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 18, weight: .bold))
                    .widgetAccentable()
            }
            .widgetURL(famChatURL)
            .accessibilityLabel("Family chat")
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Family chat")
        .description("Open family chat.")
        .supportedFamilies([.accessoryCircular])
    }
}

/// Talk shortcut: opens the app straight into recording.
struct FamETCTalkShortcutWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FamETCTalkShortcut", provider: FamStaticProvider()) { _ in
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "mic.fill")
                    .font(.system(size: 20, weight: .bold))
                    .widgetAccentable()
            }
            .widgetURL(famTalkURL)
            .accessibilityLabel("Talk to family")
            .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Talk")
        .description("Record a voice message to the family.")
        .supportedFamilies([.accessoryCircular])
    }
}

@main
struct FamETCWatchWidgets: WidgetBundle {
    var body: some Widget {
        FamETCWatchWidget()
        FamETCChatShortcutWidget()
        FamETCTalkShortcutWidget()
    }
}
