import Foundation
import WidgetKit

/// Turns the app's calendar state into the small snapshot the calendar widgets
/// read. Uses the same visibility rules as the Calendar tab (a kid sees
/// family-wide events plus their own; parents see everything except the
/// imported school timetable).
enum FamilyCalendarSnapshotBuilder {
    static let daysAhead = 14
    static let maxEvents = 80

    static func build(user: User, family: Family, events: [CalendarEvent], familyEvents: [FamilyEvent],
                      now: Date = Date(), calendar: Calendar = .current) -> FamilyCalendarSnapshot {
        let today = FamilyCalendarEvent.dayKey(now, calendar: calendar)
        let limitDate = calendar.date(byAdding: .day, value: daysAhead, to: calendar.startOfDay(for: now)) ?? now
        let limit = FamilyCalendarEvent.dayKey(limitDate, calendar: calendar)
        let kidIDs = Set(family.kids.map(\.id))

        let school: [FamilyCalendarEvent] = events.compactMap { event in
            guard let raw = event.start, raw.count >= 10 else { return nil }
            let allDay = event.allDay == true || raw.count <= 10
            if allDay {
                let day = String(raw.prefix(10))
                var endDay: String?
                if let end = event.end, end.count >= 10 {
                    // iCal all-day ends are exclusive: an end of the 5th means the 4th.
                    let exclusive = String(end.prefix(10))
                    if exclusive > day, let d = FamilyCalendarEvent.date(fromDayKey: exclusive, calendar: calendar),
                       let last = calendar.date(byAdding: .day, value: -1, to: d) {
                        endDay = FamilyCalendarEvent.dayKey(last, calendar: calendar)
                    }
                }
                return FamilyCalendarEvent(id: "school:\(event.id)", title: clean(event.title, fallback: "School event"),
                    dayKey: day, endDayKey: endDay, start: nil, end: nil, allDay: true,
                    memberID: event.kidId.flatMap { kidIDs.contains($0) ? $0 : nil })
            }
            guard let start = Agenda.parseISO(raw) else { return nil }
            let end = event.end.flatMap(Agenda.parseISO)
            return FamilyCalendarEvent(id: "school:\(event.id)", title: clean(event.title, fallback: "School event"),
                dayKey: FamilyCalendarEvent.dayKey(start, calendar: calendar), endDayKey: nil,
                start: start, end: end, allDay: false,
                memberID: event.kidId.flatMap { kidIDs.contains($0) ? $0 : nil })
        }

        let manual: [FamilyCalendarEvent] = familyEvents.map { event in
            let start = event.time.flatMap { dateTime(day: event.date, time: $0, calendar: calendar) }
            let end = event.endTime.flatMap { dateTime(day: event.endDate ?? event.date, time: $0, calendar: calendar) }
            let endDay = (event.endDate ?? "") > event.date ? event.endDate : nil
            return FamilyCalendarEvent(id: "event:\(event.id):\(event.date)", title: clean(event.title, fallback: "Family event"),
                dayKey: event.date, endDayKey: endDay, start: start, end: end, allDay: start == nil,
                memberID: event.kidId.flatMap { kidIDs.contains($0) ? $0 : nil })
        }

        let upcoming = (school + manual).filter { event in
            guard event.dayKey <= limit, event.lastDayKey >= today else { return false }
            if !event.allDay, event.start != nil { return event.effectiveEnd > now }
            return true
        }
        .sorted(by: order)

        // Drop exact duplicates (the same thing on two feeds) by title + time.
        var seen = Set<String>()
        let unique = upcoming.filter { event in
            let key = "\(event.title.lowercased())|\(event.dayKey)|\(event.start?.timeIntervalSince1970 ?? 0)|\(event.memberID ?? "")"
            return seen.insert(key).inserted
        }

        let visibleKids = user.role == "kid" ? family.kids.filter { $0.id == user.kidId } : family.kids
        let members = visibleKids.map {
            FamilyCalendarMember(id: $0.id, name: clean($0.name, fallback: "Child"), colorHex: validHex($0.color))
        }
        return FamilyCalendarSnapshot(accountID: user.id, familyID: family.id, generatedAt: now,
            members: members, events: Array(unique.prefix(maxEvents)))
    }

    static func order(_ lhs: FamilyCalendarEvent, _ rhs: FamilyCalendarEvent) -> Bool {
        if lhs.dayKey != rhs.dayKey { return lhs.dayKey < rhs.dayKey }
        // All-day rows first, then by start time.
        if lhs.allDay != rhs.allDay { return lhs.allDay }
        let l = lhs.start ?? .distantPast, r = rhs.start ?? .distantPast
        if l != r { return l < r }
        return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
    }

    private static func dateTime(day: String, time: String, calendar: Calendar) -> Date? {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.date(from: "\(day) \(time)")
    }

    private static func clean(_ value: String, fallback: String) -> String {
        let text = value.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String((text.isEmpty ? fallback : text).prefix(120))
    }

    private static func validHex(_ value: String) -> String? {
        let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return candidate.range(of: #"^#[0-9a-fA-F]{6}$"#, options: .regularExpression) == nil ? nil : candidate
    }
}

/// Keeps the calendar widgets in step with the app. AppStore calls `schedule`
/// whenever events, the account or the family change; writes are coalesced.
@MainActor
enum FamilyCalendarWidgetPublisher {
    private static var pending: Task<Void, Never>?
    private static var lastWritten: FamilyCalendarSnapshot?

    static func schedule(from store: AppStore) {
        pending?.cancel()
        pending = Task { @MainActor [weak store] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let store else { return }
            publish(from: store)
        }
    }

    static func publish(from store: AppStore, now: Date = Date()) {
        guard !store.needsAuth, let user = store.me, let family = store.family else {
            clear()
            return
        }
        if user.role == "kid", user.kidId == nil { clear(); return }
        let snapshot = FamilyCalendarSnapshotBuilder.build(user: user, family: family,
            events: store.visibleEvents, familyEvents: store.visibleFamilyEvents, now: now)
        // Skip identical rewrites (ignoring the timestamp) so widgets are not
        // reloaded on every poll; still refresh once an hour for "updated" text.
        if let last = lastWritten, last.accountID == snapshot.accountID, last.familyID == snapshot.familyID,
           last.members == snapshot.members, last.events == snapshot.events,
           now.timeIntervalSince(last.generatedAt) < 60 * 60 {
            return
        }
        FamilyCalendarSnapshotStore.save(snapshot)
        lastWritten = snapshot
        WidgetCenter.shared.reloadTimelines(ofKind: FamilyCalendarSnapshot.widgetKind)
    }

    static func clear() {
        pending?.cancel()
        pending = nil
        guard lastWritten != nil || FamilyCalendarSnapshotStore.load() != nil else { return }
        lastWritten = nil
        FamilyCalendarSnapshotStore.clear()
        WidgetCenter.shared.reloadTimelines(ofKind: FamilyCalendarSnapshot.widgetKind)
    }
}
