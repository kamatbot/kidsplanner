import SwiftUI

/// The home surface: a greeting, what's on today (events + homework), homework
/// due this week, and a peek at what's coming up. Read from AppStore.events +
/// .homework (school-feed events + the homework hub, both server-synced).
struct TodayScreen: View {
    @Environment(AppStore.self) private var store

    private var firstName: String {
        guard let name = store.me?.name, !name.isEmpty else { return "" }
        return String(name.split(separator: " ").first ?? Substring(name))
    }
    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 12 ? "Good morning" : (h < 18 ? "Good afternoon" : "Good evening")
        return firstName.isEmpty ? part : "\(part), \(firstName)"
    }
    private var todayString: String {
        Date().formatted(.dateTime.weekday(.wide).month(.wide).day())
    }
    private var todayItems: [AgendaItem] {
        Agenda.items(on: Agenda.todayKey(), events: store.events, homework: store.homework)
    }
    private var dueSoon: [AgendaItem] {
        Agenda.rows(homework: Agenda.homeworkDueSoon(store.homework, days: 7))
    }
    private var comingUp: [(day: String, items: [AgendaItem])] {
        Agenda.upcomingSections(events: store.events, homework: store.homework, days: 14)
            .filter { $0.day != Agenda.todayKey() }
    }

    var body: some View {
        SurfaceScaffold(title: greeting, subtitle: todayString) {
            todayCard
            if !dueSoon.isEmpty { dueSoonCard }
            if !comingUp.isEmpty { comingUpCard }
        }
        .refreshable { await store.refreshDashboard() }
    }

    private var todayCard: some View {
        section(header: "Today", icon: "sun.max.fill") {
            if todayItems.isEmpty {
                emptyLine("Nothing scheduled today — enjoy! 🎉")
            } else {
                rows(todayItems)
            }
        }
    }

    private var dueSoonCard: some View {
        section(header: "Homework due this week", icon: "book.closed.fill") {
            rows(dueSoon)
        }
    }

    private var comingUpCard: some View {
        section(header: "Coming up", icon: "calendar") {
            VStack(alignment: .leading, spacing: Space.md) {
                ForEach(comingUp.prefix(5), id: \.day) { s in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Agenda.dayLabel(s.day))
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(Palette.accent)
                        rows(s.items)
                    }
                }
            }
        }
    }

    // MARK: building blocks

    private func section<Content: View>(header: String, icon: String, @ViewBuilder _ content: () -> Content) -> some View {
        let inner = content()
        return Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(spacing: Space.sm) {
                    Image(systemName: icon).font(.system(size: 14, weight: .bold)).foregroundStyle(Palette.accent)
                    Text(header).font(Typography.cardTitle).foregroundStyle(Palette.text)
                }
                inner
            }
        }
    }

    private func rows(_ items: [AgendaItem]) -> some View {
        VStack(spacing: 0) {
            ForEach(items) { item in
                AgendaRow(item: item)
                if item.id != items.last?.id { Divider().overlay(Palette.border) }
            }
        }
    }

    private func emptyLine(_ text: String) -> some View {
        Text(text).font(Typography.body).foregroundStyle(Palette.textSecond)
    }
}
