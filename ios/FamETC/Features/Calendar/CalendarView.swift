import SwiftUI

/// Calendar tab. A full month GRID on iPad and iPhone-landscape (like the web),
/// and a compact AGENDA LIST on iPhone-portrait where a grid would be cramped.
/// On the roomier layouts a Week|Month segmented control (canvas-1b) lets the
/// user pick between the grid and a 7-day agenda window explicitly.
struct CalendarScreen: View {
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(\.verticalSizeClass) private var vSize
    @State private var showAddEvent = false
    @State private var mode: CalendarMode = .month

    private var useGrid: Bool { hSize == .regular || vSize == .compact }
    /// Only offer the Week|Month toggle where there's room to show it above
    /// either surface without crowding the iPhone-portrait agenda list.
    private var canToggleMode: Bool { hSize == .regular }

    var body: some View {
        VStack(spacing: 0) {
            if canToggleMode {
                modeBar
            }
            Group {
                if useGrid && mode == .month {
                    MonthCalendarView(onAdd: { showAddEvent = true })
                } else {
                    CalendarAgendaList(onAdd: { showAddEvent = true }, days: mode == .week ? 7 : 45)
                }
            }
        }
        .background(ScreenBackground())
        .sheet(isPresented: $showAddEvent) { AddEventSheet() }
    }

    private var modeBar: some View {
        HStack {
            Spacer()
            Picker("", selection: $mode) {
                ForEach(CalendarMode.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .tint(Palette.accent)
            .frame(width: 180)
        }
        .padding(.horizontal, Space.lg)
        .padding(.top, Space.md)
    }
}

enum CalendarMode: String, CaseIterable, Identifiable {
    case week, month
    var id: String { rawValue }
    var label: String { self == .week ? "Week" : "Month" }
}

/// Agenda list — upcoming events + homework grouped by day. Used as the
/// iPhone-portrait fallback, and as the "Week" mode on wider layouts.
private struct CalendarAgendaList: View {
    @Environment(AppStore.self) private var store
    var onAdd: () -> Void
    var days: Int = 45
    @State private var eventDetailRef: CalEventRef?

    private var sections: [(day: String, items: [AgendaItem])] {
        Agenda.upcomingSections(events: store.visibleEvents, familyEvents: store.visibleFamilyEvents, homework: store.homework, days: days)
    }
    private var itemCount: Int { sections.reduce(0) { $0 + $1.items.count } }
    private var monthLabel: String { Date().formatted(.dateTime.month(.wide).year()) }

    var body: some View {
        SurfaceScaffold(title: "Calendar", subtitle: monthLabel, trailing: {
            Button(action: onAdd) {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(Palette.onAccent)
                    .frame(width: 38, height: 38).background(Palette.accent, in: Circle())
            }
        }) {
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
                                    if let fe = item.familyEvent {
                                        Button {
                                            eventDetailRef = CalEventRef(id: "\(fe.id)-\(fe.date)", eventId: fe.id, occurrenceDate: fe.date)
                                        } label: { AgendaRow(item: item) }
                                        .buttonStyle(.plain)
                                    } else {
                                        AgendaRow(item: item)
                                    }
                                    if item.id != s.items.last?.id { Divider().overlay(Palette.border) }
                                }
                            }
                        }
                    }
                }
                MicroLabel(text: "\(itemCount) item\(itemCount == 1 ? "" : "s") · next \(days) days")
                    .padding(.horizontal, Space.xs)
            }
        }
        .refreshable { await store.refreshDashboard() }
        .sheet(item: $eventDetailRef) { ref in EventDetailSheet(eventId: ref.eventId, occurrenceDate: ref.occurrenceDate) }
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

/// Wrapper so a (series id, occurrence date) pair can drive `.sheet(item:)` —
/// occurrences of a recurring event share `id`, so the id alone isn't unique.
private struct CalEventRef: Identifiable {
    let id: String
    let eventId: String
    let occurrenceDate: String
}
