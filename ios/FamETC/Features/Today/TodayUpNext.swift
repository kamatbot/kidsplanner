import SwiftUI

/// Today's "Up next" (docs/design/soft-rings/IOS-BRIEF.md §4): the next
/// calendar event as an art card, then the following two as rows. Calendar
/// events only — homework has its own surfaces. It replaces the Today
/// day-strip timeline; the full timeline remains in Calendar's week view.
/// `kidID` limits a child session to its own and family events.
struct TodayUpNext: View {
    @Environment(AppStore.self) private var store
    @State private var eventRef: TodayEventRef?
    @State private var schoolDetail: AgendaItem?
    var kidID: String? = nil
    var onAddEvent: (() -> Void)? = nil

    private static let time24: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private var upcoming: [AgendaItem] {
        let now = Date()
        let today = Agenda.todayKey()
        let nowMinute = Calendar.current.component(.hour, from: now) * 60 + Calendar.current.component(.minute, from: now)
        return Agenda.upcomingSections(events: store.visibleEvents, familyEvents: store.visibleFamilyEvents, homework: [], days: 7)
            .flatMap { $0.items }
            .filter { item in
                guard item.kind != .homework else { return false }
                guard kidID == nil || item.kidId == nil || item.kidId == kidID else { return false }
                // Today's timed events stay listed until they end.
                guard item.dayKey == today, item.time != nil else { return true }
                return endMinute(item) > nowMinute
            }
    }

    var body: some View {
        let items = upcoming
        VStack(alignment: .leading, spacing: Space.md) {
            if let onAddEvent {
                SectionHeader(title: "Up next", actionTitle: "Add event", actionSystemImage: "plus",
                              actionIdentifier: "today.upnext.add", action: onAddEvent)
            } else {
                SectionHeader(title: "Up next")
            }
            if let next = items.first {
                Button { open(next) } label: {
                    EventArtCard(title: next.title, detail: cardDetail(next), kid: kid(for: next),
                                 activity: EventArt.activity(title: next.title, subtitle: next.subtitle))
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("\(next.title), \(spokenOwner(next)), \(cardDetail(next))")
                .accessibilityHint("Opens the event")
                .accessibilityIdentifier("today.upnext.first")
                ForEach(Array(items.dropFirst().prefix(2))) { item in
                    row(item)
                }
            } else {
                Card(padding: Space.lg) {
                    Text(store.isLoadingCalendar ? "Loading the calendar…" : "Nothing on the calendar this week.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.frInk2)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.upnext")
        .sheet(item: $eventRef) { EventDetailSheet(eventId: $0.eventID, occurrenceDate: $0.occurrenceDate) }
        .sheet(item: $schoolDetail) { SchoolAgendaDetail(item: $0) }
    }

    private func row(_ item: AgendaItem) -> some View {
        let activity = EventArt.activity(title: item.title, subtitle: item.subtitle)
        let tint = Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.frYou
        return Button { open(item) } label: {
            HStack(spacing: Space.md) {
                Image(systemName: EventArt.resolvedSymbol(activity))
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 48, height: 48)
                    .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.frInk)
                        .lineLimit(2)
                    Text("\(spokenOwner(item)) · \(Agenda.dayLabel(item.dayKey)) · \(timeRange(item))")
                        .font(Typography.label)
                        .foregroundStyle(Palette.frInk2)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Palette.frInk3)
                    .accessibilityHidden(true)
            }
            .padding(Space.md)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.card - 4, style: .continuous))
            .cardShadow()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the event")
        .accessibilityIdentifier("today.upnext.\(item.id)")
    }

    private func kid(for item: AgendaItem) -> Kid? {
        guard let id = item.kidId else { return nil }
        return store.kids.first { $0.id == id }
    }

    private func spokenOwner(_ item: AgendaItem) -> String {
        Agenda.kidName(item.kidId, kids: store.kids) ?? "Family"
    }

    /// "Today · 4:30 PM–5:45 PM · Main field": the place only for school
    /// events, whose subtitle is the feed label or location (a family event's
    /// subtitle is its free-text notes).
    private func cardDetail(_ item: AgendaItem) -> String {
        var parts = [Agenda.dayLabel(item.dayKey), timeRange(item)]
        if item.familyEvent == nil, let place = item.subtitle, !place.isEmpty { parts.append(place) }
        return parts.joined(separator: " · ")
    }

    private func timeRange(_ item: AgendaItem) -> String {
        guard let start = item.time else { return "All day" }
        if let end = item.familyEvent?.endTime, let date = Self.time24.date(from: end) {
            return "\(start)–\(Agenda.displayTime(date))"
        }
        if let source = store.visibleEvents.first(where: { "ev-\($0.id)" == item.id }),
           let raw = source.end, let end = Agenda.parseISO(raw), DateFmt.ymd.string(from: end) == item.dayKey {
            return "\(start)–\(Agenda.displayTime(end))"
        }
        return start
    }

    private func endMinute(_ item: AgendaItem) -> Int {
        let start = minute(item.sortKey)
        if let end = item.familyEvent?.endTime { return max(start + 15, minute(end)) }
        if let source = store.visibleEvents.first(where: { "ev-\($0.id)" == item.id }),
           let raw = source.end, let end = Agenda.parseISO(raw) {
            if DateFmt.ymd.string(from: end) > item.dayKey { return 24 * 60 }
            return max(start + 15, Calendar.current.component(.hour, from: end) * 60 + Calendar.current.component(.minute, from: end))
        }
        return start + 60
    }

    private func minute(_ value: String) -> Int {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? parts[0] * 60 + parts[1] : 0
    }

    private func open(_ item: AgendaItem) {
        if let event = item.familyEvent {
            eventRef = TodayEventRef(eventID: event.id, occurrenceDate: item.dayKey)
        } else {
            schoolDetail = item
        }
    }
}

/// Tonight's dinner for parents; opens Meals. Kept as its own card now that
/// the day strip it lived on is gone (`today.tonight` is unchanged).
struct TodayTonightCard: View {
    @Environment(AppStore.self) private var store
    let onOpenMeals: () -> Void

    private var dinner: MenuEntry? {
        store.meals?.menu.first { $0.date == Agenda.todayKey() && ($0.slot ?? "dinner") == "dinner" }
    }

    var body: some View {
        // Opening Meals switches tabs, which plays RootView's selection haptic.
        Button(action: onOpenMeals) {
            HStack(spacing: Space.md) {
                Image(systemName: "fork.knife")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Palette.frFamsInk)
                    .frame(width: 56, height: 56)
                    .background(Palette.frFamsSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tonight")
                        .font(Typography.sectionTitle)
                        .foregroundStyle(Palette.frInk)
                    Text(dinner?.title ?? "Dinner not planned · Plan tonight")
                        .font(Typography.body)
                        .foregroundStyle(Palette.frInk2)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Palette.frYouInk)
                    .frame(width: 44, height: 44)
                    .background(Palette.frYouSoft, in: Circle())
                    .accessibilityHidden(true)
            }
            .padding(Space.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .cardShadow()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(dinner.map { "Tonight: \($0.title)" } ?? "Tonight: dinner not planned")
        .accessibilityHint("Opens Meals")
        .accessibilityIdentifier("today.tonight")
    }
}

struct TodayEventRef: Identifiable {
    let eventID: String
    let occurrenceDate: String
    var id: String { eventID + occurrenceDate }
}

/// Read-only detail for a school-feed event (family events open the editable
/// EventDetailSheet instead).
struct SchoolAgendaDetail: View {
    @Environment(\.dismiss) private var dismiss
    let item: AgendaItem

    var body: some View {
        NavigationStack {
            List {
                Text(item.title).font(Typography.title)
                Text(item.time ?? "All day")
                if let subtitle = item.subtitle { Text(subtitle) }
            }
            .navigationTitle("Calendar event")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
