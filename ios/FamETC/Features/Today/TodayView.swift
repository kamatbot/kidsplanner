import SwiftUI

/// The home dashboard — a colorful widget grid matching the web app: a greeting
/// hero, today's plan + homework (server-synced), and the daily "of the day"
/// widgets (quote, SAT word, fun fact, news, brain teaser).
///
/// Layout: a MASONRY of top-aligned columns (widgets pack down each column
/// independently) rather than a LazyVGrid — a plain grid center-floats short
/// widgets in tall rows and leaves big uneven gaps. Column count adapts to the
/// available width: 1 on iPhone, 2–3 on iPad.
struct TodayScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var contentWidth: CGFloat = 0

    private var firstName: String {
        guard let name = store.me?.name, !name.isEmpty else { return "" }
        return String(name.split(separator: " ").first ?? Substring(name))
    }
    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 12 ? "Good morning" : (h < 18 ? "Good afternoon" : "Good evening")
        return firstName.isEmpty ? part : "\(part), \(firstName)"
    }
    private var todayString: String { Date().formatted(.dateTime.weekday(.wide).month(.wide).day()) }

    private var columnCount: Int {
        guard contentWidth > 0 else { return hSize == .compact ? 1 : 2 }
        return max(1, min(3, Int(contentWidth / 330)))
    }
    private var widgets: [AnyView] {
        [AnyView(TodayPlanWidget()), AnyView(HomeworkWeekWidget()), AnyView(QuoteWidget()),
         AnyView(WordWidget()), AnyView(NewsWidget()), AnyView(QuizWidget())]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.lg) {
                hero
                masonry
            }
            .padding(Space.lg)
            .padding(.bottom, hSize == .compact ? Layout.tabBarClearance : Space.xl)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
            // Chat-style: tapping anywhere that isn't a field/button/card control
            // puts the keyboard away. (Controls consume their own taps first.)
            .contentShape(Rectangle())
            .onTapGesture { famDismissKeyboard() }
        }
        .background(ScreenBackground())
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await store.refreshDashboard() }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(greeting).font(Typography.largeTitle).foregroundStyle(Palette.onAccent)
            Text(todayString).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.onAccent.opacity(0.92))
        }
        .padding(Space.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Signal.gradient(.topLeading, .bottomTrailing), in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .shadow(color: Palette.accent.opacity(0.25), radius: 16, x: 0, y: 8)
    }

    /// Round-robin the widgets into `columnCount` top-aligned VStacks so each
    /// column packs down independently (no center-float gaps).
    private var masonry: some View {
        let cols = columnCount
        // A bit more breathing room: wider gutters between columns (iPad) and
        // between stacked widgets (both platforms).
        return HStack(alignment: .top, spacing: Space.xl) {
            ForEach(0..<cols, id: \.self) { col in
                VStack(spacing: Space.lg + 4) {
                    ForEach(Array(widgets.enumerated()).filter { $0.offset % cols == col }, id: \.offset) { entry in
                        entry.element
                    }
                }
                .frame(maxWidth: .infinity, alignment: .top)
            }
        }
    }
}

// MARK: - Schedule + homework widgets (share the AgendaRow)

private struct TodayPlanWidget: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        let items = Agenda.items(on: Agenda.todayKey(), events: store.events, familyEvents: store.familyEvents, homework: store.homework)
        return DashCard("☀️", "Today", tint: Palette.amber) {
            if items.isEmpty {
                Text("Nothing scheduled today — enjoy! 🎉")
                    .font(Typography.body).foregroundStyle(Palette.textSecond)
            } else {
                rowList(Array(items.prefix(4)), moreCount: items.count - 4)
            }
        }
    }
}

private struct HomeworkWeekWidget: View {
    @Environment(AppStore.self) private var store
    var body: some View {
        let due = Agenda.rows(homework: Agenda.homeworkDueSoon(store.homework, days: 7))
        return DashCard("📚", "Homework This Week", tint: Palette.blue) {
            if due.isEmpty {
                Text("No homework due this week 🎉")
                    .font(Typography.body).foregroundStyle(Palette.textSecond)
            } else {
                rowList(Array(due.prefix(5)), moreCount: due.count - 5)
            }
        }
    }
}

/// Compact list of AgendaRows with dividers and a "+N more" footer.
@ViewBuilder
private func rowList(_ items: [AgendaItem], moreCount: Int) -> some View {
    VStack(spacing: 0) {
        ForEach(items) { item in
            AgendaRow(item: item)
            if item.id != items.last?.id { Divider().overlay(Palette.border) }
        }
        if moreCount > 0 {
            Text("+\(moreCount) more")
                .font(Typography.caption.weight(.semibold))
                .foregroundStyle(Palette.textSecond)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, Space.sm)
        }
    }
}
