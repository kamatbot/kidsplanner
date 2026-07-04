import SwiftUI

/// Calendar tab. A full month GRID on iPad and iPhone-landscape (like the web),
/// and a compact AGENDA LIST on iPhone-portrait where a grid would be cramped.
struct CalendarScreen: View {
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.verticalSizeClass) private var vSize

    private var useGrid: Bool { hSize == .regular || vSize == .compact }

    var body: some View {
        if useGrid {
            MonthCalendarView()
        } else {
            CalendarAgendaList()
        }
    }
}

/// Agenda list — upcoming events + homework grouped by day (iPhone portrait).
private struct CalendarAgendaList: View {
    @Environment(AppStore.self) private var store

    private var sections: [(day: String, items: [AgendaItem])] {
        Agenda.upcomingSections(events: store.events, homework: store.homework, days: 45)
    }
    private var monthLabel: String { Date().formatted(.dateTime.month(.wide).year()) }

    var body: some View {
        SurfaceScaffold(title: "Calendar", subtitle: monthLabel) {
            if sections.isEmpty {
                emptyState
            } else {
                ForEach(sections, id: \.day) { s in
                    VStack(alignment: .leading, spacing: Space.sm) {
                        Text(Agenda.dayLabel(s.day))
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.text)
                            .padding(.horizontal, Space.xs)
                        Card {
                            VStack(spacing: 0) {
                                ForEach(s.items) { item in
                                    AgendaRow(item: item)
                                    if item.id != s.items.last?.id { Divider().overlay(Palette.border) }
                                }
                            }
                        }
                    }
                }
            }
        }
        .refreshable { await store.refreshDashboard() }
    }

    private var emptyState: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.md) {
                Image(systemName: "calendar")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                Text("Nothing on the calendar yet")
                    .font(Typography.cardTitle).foregroundStyle(Palette.text)
                Text("School events and homework show up here. Subscribe to your school's calendar and add homework from Settings, then pull to refresh.")
                    .font(Typography.body).foregroundStyle(Palette.textSecond)
            }
        }
    }
}
