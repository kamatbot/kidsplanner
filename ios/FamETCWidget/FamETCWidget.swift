import AppIntents
import SwiftUI
import WidgetKit

struct SelectFamilyChildIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Choose a child"
    static let description = IntentDescription("Shows a read-only family snapshot for one child.")

    @Parameter(title: "Child") var child: FamilyChildEntity?
}

private struct FamilyWidgetEntry: TimelineEntry {
    let date: Date
    let configuration: SelectFamilyChildIntent
    let snapshot: FamilyAssistanceSnapshot?

    var child: FamilyAssistanceChild? {
        guard let snapshot else { return nil }
        if let id = configuration.child?.id { return snapshot.child(id: id) }
        return snapshot.children.count == 1 ? snapshot.children.first : nil
    }
}

private struct FamilyWidgetProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FamilyWidgetEntry {
        let child = FamilyAssistanceChild(id: "placeholder", name: "Child", colorHex: "#6F43D6",
            nextActivity: FamilyAssistanceItem(id: "activity", kind: .activity, title: "School club",
                dateKey: "", startsAt: nil, timeText: "3:30 PM"),
            todayActivities: [], tomorrowActivities: [],
            todayHomework: [FamilyAssistanceItem(id: "homework", kind: .homework,
                title: "Reading", dateKey: "", startsAt: nil, timeText: nil)],
            tomorrowHomework: [], todayActivityCount: 0, tomorrowActivityCount: 0,
            todayHomeworkCount: 1, tomorrowHomeworkCount: 0,
            dailyFive: FamilyDailyFiveProgress(completed: 2, started: 1, total: 5),
            expectedHomeTime: "4:30 PM",
            calendarAvailable: true, homeworkAvailable: true, dailyFiveAvailable: true)
        let now = Date()
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: now)
        let snapshot = FamilyAssistanceSnapshot(accountID: "", familyID: "", generatedAt: now,
            expiresAt: now.addingTimeInterval(FamilyAssistanceSnapshot.maximumAge),
            dayKey: String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0),
            timeZoneIdentifier: TimeZone.current.identifier, children: [child])
        return FamilyWidgetEntry(date: .now, configuration: SelectFamilyChildIntent(), snapshot: snapshot)
    }

    func snapshot(for configuration: SelectFamilyChildIntent, in context: Context) async -> FamilyWidgetEntry {
        FamilyWidgetEntry(date: .now, configuration: configuration, snapshot: FamilyAssistanceSnapshotStore.load())
    }

    func timeline(for configuration: SelectFamilyChildIntent, in context: Context) async -> Timeline<FamilyWidgetEntry> {
        let now = Date()
        let snapshot = FamilyAssistanceSnapshotStore.load()
        let expiry = snapshot?.expiresAt ?? now.addingTimeInterval(15 * 60)
        let nextCheck = min(expiry, now.addingTimeInterval(15 * 60))
        return Timeline(entries: [FamilyWidgetEntry(date: now, configuration: configuration, snapshot: snapshot)],
            policy: .after(max(nextCheck, now.addingTimeInterval(60))))
    }
}

private struct FamilyWidgetView: View {
    @Environment(\.widgetFamily) private var widgetFamily
    let entry: FamilyWidgetEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot, !snapshot.isFresh(at: entry.date) {
                stateView(symbol: "arrow.clockwise", title: "Refresh Fam ETC",
                    detail: "This family snapshot is out of date.")
            } else if entry.snapshot == nil {
                stateView(symbol: "lock", title: "Open Fam ETC",
                    detail: "Sign in as a parent to create this private snapshot.")
            } else if entry.child == nil {
                stateView(symbol: "person.crop.circle.badge.questionmark", title: "Choose a child",
                    detail: "Touch and hold this widget, then choose a child.")
            } else if let child = entry.child {
                childView(child)
                    .widgetURL(FamilyAssistanceRoute.todayURL(childID: child.id))
                    .privacySensitive()
            }
        }
        .padding(widgetFamily == .systemSmall ? 14 : 16)
        .containerBackground(for: .widget) { Color(.systemBackground) }
    }

    private func childView(_ child: FamilyAssistanceChild) -> some View {
        VStack(alignment: .leading, spacing: widgetFamily == .systemSmall ? 7 : 10) {
            HStack(spacing: 8) {
                Circle().fill(childColor(child.colorHex)).frame(width: 10, height: 10)
                Text(child.name).font(.headline).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "checklist").foregroundStyle(Color.accentColor)
                    .accessibilityHidden(true)
            }
            if widgetFamily == .systemSmall {
                compactRow(symbol: "calendar", value: activityText(child), available: child.calendarAvailable)
                compactRow(symbol: "book.closed", value: homeworkText(child), available: child.homeworkAvailable)
                compactRow(symbol: "sparkles", value: child.dailyFive?.summary ?? "Daily 5 unavailable",
                    available: child.dailyFiveAvailable)
                compactRow(symbol: "house", value: homeTimeText(child), available: child.expectedHomeTime != nil)
            } else {
                widgetRow(symbol: "calendar", title: "Next activity",
                    value: activityText(child), available: child.calendarAvailable)
                widgetRow(symbol: "book.closed", title: "Homework",
                    value: homeworkText(child), available: child.homeworkAvailable)
                widgetRow(symbol: "sparkles", title: "Daily 5",
                    value: child.dailyFive?.summary ?? "Progress unavailable",
                    available: child.dailyFiveAvailable)
                widgetRow(symbol: "house", title: "Expected home",
                    value: homeTimeText(child), available: child.expectedHomeTime != nil)
                if widgetFamily == .systemLarge {
                    Divider()
                    largeDayDetails(child)
                }
            }
            Spacer(minLength: 0)
            if widgetFamily != .systemSmall {
                Text("As of \(entry.snapshot?.generatedAt.formatted(date: .omitted, time: .shortened) ?? "—")")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func compactRow(symbol: String, value: String, available: Bool) -> some View {
        Label {
            Text(value).font(.caption.weight(.semibold)).lineLimit(1)
        } icon: {
            Image(systemName: available ? symbol : "exclamationmark.triangle")
                .foregroundStyle(available ? Color.accentColor : Color.secondary)
        }
    }

    private func largeDayDetails(_ child: FamilyAssistanceChild) -> some View {
        HStack(alignment: .top, spacing: 18) {
            detailColumn(title: "Today", items: child.todayActivities + child.todayHomework,
                available: child.calendarAvailable && child.homeworkAvailable)
            Divider()
            detailColumn(title: "Tomorrow", items: child.tomorrowActivities + child.tomorrowHomework,
                available: child.calendarAvailable && child.homeworkAvailable)
        }
    }

    private func detailColumn(title: String, items: [FamilyAssistanceItem], available: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            if !available {
                Text("Some information is unavailable").font(.caption).foregroundStyle(.secondary)
            } else if items.isEmpty {
                Text("Nothing due or scheduled").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(items.prefix(3)) { item in
                    Label(item.title, systemImage: item.kind == .activity ? "calendar" : "book.closed")
                        .font(.caption).lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func widgetRow(symbol: String, title: String, value: String, available: Bool) -> some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: available ? symbol : "exclamationmark.triangle")
                .foregroundStyle(available ? Color.accentColor : Color.secondary)
                .frame(width: 14).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption2).foregroundStyle(.secondary)
                Text(value).font(.caption.weight(.semibold)).lineLimit(widgetFamily == .systemSmall ? 1 : 2)
            }
        }
    }

    private func activityText(_ child: FamilyAssistanceChild) -> String {
        guard child.calendarAvailable else { return "Calendar unavailable" }
        guard let item = child.nextActivity else { return "No upcoming activity in 7 days" }
        let when = item.startsAt?.formatted(date: .abbreviated,
            time: item.timeText == nil ? .omitted : .shortened)
        return when.map { "\(item.title) · \($0)" } ?? item.title
    }

    private func homeworkText(_ child: FamilyAssistanceChild) -> String {
        FamilyAssistancePresentation.homeworkText(child,
            dayKey: entry.snapshot?.dayKey ?? "")
    }

    private func homeTimeText(_ child: FamilyAssistanceChild) -> String {
        child.expectedHomeTime.map { "\($0) · parent plan" } ?? "Home time not planned"
    }

    private func stateView(symbol: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: symbol).font(.title2).foregroundStyle(Color.accentColor)
            Text(title).font(.headline)
            Text(detail).font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private func childColor(_ hex: String?) -> Color {
        guard let hex, hex.count == 7, let value = UInt64(hex.dropFirst(), radix: 16) else {
            return Color.accentColor
        }
        return Color(red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255)
    }
}

@main
struct FamETCFamilyWidget: Widget {
    let kind = "FamETCFamilyWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: SelectFamilyChildIntent.self,
            provider: FamilyWidgetProvider()) { entry in
            FamilyWidgetView(entry: entry)
        }
        .configurationDisplayName("Child's day")
        .description("A private, read-only snapshot of one child's next activity, homework, and Daily 5 progress.")
        // Home Screen only. No accessory families means child labels are never
        // offered as Lock Screen widgets; privacySensitive adds OS redaction.
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
