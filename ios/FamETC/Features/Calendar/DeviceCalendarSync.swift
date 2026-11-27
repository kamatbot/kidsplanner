import CryptoKit
import EventKit
import Foundation
import Observation
import UIKit

/// One-way copy of the events in the device's own Calendar app (iCloud,
/// Google, Exchange… whatever the person picked) into the Fam ETC calendar.
///
/// Why: Siri and the stock Calendar app put "Bowling tomorrow 7pm" into Apple
/// Calendar, and the family never saw it in Fam ETC.
///
/// How it stays duplicate-free:
/// - Every device event gets an opaque `sourceId` ("ek-" + 32 hex) hashed from
///   its calendar-item external identifier (plus the occurrence date for
///   repeating events). The server dedups on (sourceType "device", sourceId),
///   so a shared iCloud calendar imported from both parents' phones lands once.
/// - This device remembers which Fam ETC event it made for each sourceId and a
///   fingerprint of the copied fields, so a later sync updates changed events,
///   removes ones deleted from the phone (or from a calendar that was turned
///   off), and never re-adds one the family deleted inside Fam ETC.
///
/// Imports are silent (no "New event" chat card per row) and scoped to the
/// signed-in person: a parent's events go on the family calendar, a kid's go
/// on that kid's own calendar.
@MainActor
@Observable
final class DeviceCalendarSync {
    static let shared = DeviceCalendarSync()

    /// Rolling window, same as the school feeds (CLAUDE.md): 2 weeks back,
    /// ~3 months ahead.
    static let pastDays = 14
    static let futureDays = 92
    /// Upper bound per sync so a busy work calendar can't flood the family.
    static let maxEvents = 400
    static let sourceType = "device"

    struct DeviceCalendar: Identifiable, Hashable {
        let id: String
        let title: String
        let account: String
        let color: UIColor
    }

    /// What this device created (or adopted) in Fam ETC for one device event.
    struct Mapping: Codable, Equatable {
        /// nil once the family deleted the Fam ETC copy: never re-add it.
        var famEventId: String?
        var fingerprint: String
        /// YYYY-MM-DD of the device event's start, for window bookkeeping.
        var date: String
        var calendarId: String
        /// false when another family member's device had already imported it;
        /// that device owns updates and removal.
        var createdHere: Bool
    }

    private(set) var authorization: EKAuthorizationStatus = EKEventStore.authorizationStatus(for: .event)
    private(set) var calendars: [DeviceCalendar] = []
    private(set) var selectedIds: Set<String> = []
    private(set) var isSyncing = false
    private(set) var lastSync: Date?
    private(set) var lastSummary: String?
    /// Exact error text for the screen (each device test costs an archive).
    private(set) var lastErrors: [String] = []
    private(set) var bannerDismissed = false

    private let eventStore = EKEventStore()
    private let api = APIClient.shared
    private var accountKey: String?
    private var kidId: String?
    private var isParent = true
    private var changeObserver: NSObjectProtocol?
    private var pendingChangeTask: Task<Void, Never>?
    /// Called after a sync that changed Fam ETC so the Calendar tab reloads.
    var onImported: (() async -> Void)?

    var hasFullAccess: Bool { authorization == .fullAccess }
    var isEnabled: Bool { hasFullAccess && !selectedIds.isEmpty }
    var needsSetup: Bool { !isEnabled }

    private init() {
        changeObserver = NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged, object: eventStore, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.scheduleSyncAfterChange() }
        }
    }

    // MARK: Account binding

    /// Bind to the signed-in person. Settings and the event map are kept per
    /// account + family so a shared iPad never mixes two people's calendars.
    func bind(userId: String?, familyId: String?, role: String?, kidId: String?) {
        let key = (userId != nil && familyId != nil) ? "\(userId!)_\(familyId!)" : nil
        self.isParent = role != "kid"
        self.kidId = role == "kid" ? kidId : nil
        guard key != accountKey else { return }
        accountKey = key
        selectedIds = Set(defaults.stringArray(forKey: storageKey("ids")) ?? [])
        bannerDismissed = defaults.bool(forKey: storageKey("bannerDismissed"))
        lastSync = defaults.object(forKey: storageKey("lastSync")) as? Date
        lastSummary = nil
        lastErrors = []
        refreshAuthorization()
    }

    func refreshAuthorization() {
        authorization = EKEventStore.authorizationStatus(for: .event)
        if hasFullAccess { reloadCalendars() } else { calendars = [] }
    }

    /// Asks iOS for full calendar access (reading needs full access; iOS 17+).
    /// Returns the exact problem text on failure.
    @discardableResult
    func requestAccess() async -> String? {
        do {
            let granted = try await eventStore.requestFullAccessToEvents()
            refreshAuthorization()
            if granted {
                // First time on: preselect the calendar Siri and the Calendar
                // app add new events to, so "Bowling 7pm" shows up right away.
                if selectedIds.isEmpty, let def = eventStore.defaultCalendarForNewEvents {
                    setSelected([def.calendarIdentifier])
                }
                return nil
            }
            return Self.deniedMessage(for: authorization)
        } catch {
            refreshAuthorization()
            return "iOS couldn't ask for calendar access: \(error.localizedDescription)"
        }
    }

    nonisolated static func deniedMessage(for status: EKAuthorizationStatus) -> String {
        switch status {
        case .restricted:
            return "Calendar access is restricted on this device (Screen Time or a device profile)."
        case .writeOnly:
            return "Fam ETC can only add to Calendar, not read it. In Settings › Fam ETC › Calendars, choose Full Access."
        default:
            return "Calendar access is off. In Settings › Fam ETC › Calendars, choose Full Access."
        }
    }

    func reloadCalendars() {
        calendars = eventStore.calendars(for: .event)
            .map { DeviceCalendar(id: $0.calendarIdentifier, title: $0.title,
                                  account: $0.source?.title ?? "", color: UIColor(cgColor: $0.cgColor)) }
            .sorted { ($0.account, $0.title) < ($1.account, $1.title) }
    }

    func setSelected(_ ids: Set<String>) {
        selectedIds = ids
        defaults.set(Array(ids), forKey: storageKey("ids"))
    }

    func toggle(_ id: String) {
        var ids = selectedIds
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
        setSelected(ids)
    }

    func dismissBanner() {
        bannerDismissed = true
        defaults.set(true, forKey: storageKey("bannerDismissed"))
    }

    // MARK: Sync

    private func scheduleSyncAfterChange() {
        guard isEnabled else { return }
        pendingChangeTask?.cancel()
        pendingChangeTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            await self?.sync()
        }
    }

    /// Copies the chosen calendars into Fam ETC. Safe to call often: it's a
    /// no-op when nothing changed. Also cleans up when calendars were turned off.
    func sync() async {
        guard accountKey != nil, !isSyncing else { return }
        refreshAuthorization()
        // Nothing chosen and nothing previously imported: nothing to do.
        var map = loadMap()
        guard hasFullAccess, !(selectedIds.isEmpty && map.isEmpty) else { return }
        isSyncing = true
        defer { isSyncing = false }

        var errors: [String] = []
        var added = 0, updated = 0, removed = 0

        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let windowStart = cal.date(byAdding: .day, value: -Self.pastDays, to: today)!
        let windowEnd = cal.date(byAdding: .day, value: Self.futureDays, to: today)!
        let fromKey = Self.ymd(windowStart)

        // Calendars still on the device. Events from one that vanished (an
        // account briefly signing out) are left alone rather than deleted.
        let presentCalendarIds = Set(eventStore.calendars(for: .event).map(\.calendarIdentifier))
        let chosen = eventStore.calendars(for: .event).filter { selectedIds.contains($0.calendarIdentifier) }
        if !selectedIds.isEmpty && chosen.isEmpty {
            errors.append("The calendars you picked aren't on this device anymore. Pick them again in Phone calendar.")
        }

        // 1. Read device events.
        var wanted: [String: (event: EKEvent, fields: Fields)] = [:]
        var truncated = false
        if !chosen.isEmpty {
            let predicate = eventStore.predicateForEvents(withStart: windowStart, end: windowEnd, calendars: chosen)
            var found = eventStore.events(matching: predicate)
                .filter { !Self.isDeclined($0) }
                .sorted { $0.startDate < $1.startDate }
            if found.count > Self.maxEvents { found = Array(found.prefix(Self.maxEvents)); truncated = true }
            for ev in found {
                guard let id = Self.sourceId(for: ev) else { continue }
                wanted[id] = (ev, Fields(ev))
            }
        }

        // 2. What the family calendar holds now (to spot copies deleted in Fam ETC
        //    and keep a driver/category someone set there).
        var serverById: [String: FamilyEvent] = [:]
        do {
            let list = try await api.familyEvents(from: fromKey, to: Self.ymd(windowEnd))
            for e in list where e.sourceType == Self.sourceType { serverById[e.seriesId ?? e.id] = e }
        } catch {
            lastErrors = ["Couldn't read the Fam ETC calendar: \(error.localizedDescription)"]
            lastSummary = nil
            return
        }

        // 3. Add or update.
        for (sid, item) in wanted.sorted(by: { $0.value.event.startDate < $1.value.event.startDate }) {
            let f = item.fields
            let calendarId = item.event.calendar?.calendarIdentifier ?? ""
            if var m = map[sid] {
                guard let famId = m.famEventId else { continue }       // deleted in Fam ETC
                guard let server = serverById[famId] else {
                    // Gone from Fam ETC: someone deleted it there. Respect that.
                    m.famEventId = nil
                    map[sid] = m
                    continue
                }
                m.calendarId = calendarId
                m.date = f.date
                if m.createdHere && m.fingerprint != f.fingerprint {
                    do {
                        _ = try await api.updateFamilyEvent(
                            famId, title: f.title, date: f.date, time: f.time, notes: f.notes,
                            category: server.category, kidId: server.kidId, endDate: f.endDate,
                            repeatRule: nil, repeatUntil: nil, driverMemberId: server.driverMemberId,
                            endTime: .some(f.endTime))
                        m.fingerprint = f.fingerprint
                        updated += 1
                    } catch APIError.http(404, _) {
                        m.famEventId = nil
                    } catch APIError.http(403, _) {
                        m.createdHere = false                         // not ours to edit
                    } catch {
                        errors.append("Couldn't update “\(f.title)”: \(error.localizedDescription)")
                    }
                }
                map[sid] = m
            } else {
                do {
                    let r = try await api.addFamilyEventResult(
                        title: f.title, date: f.date, time: f.time, notes: f.notes,
                        category: "other", kidId: isParent ? nil : kidId, endDate: f.endDate,
                        sourceType: Self.sourceType, sourceId: sid, endTime: f.endTime, silent: true)
                    let existing = r.existing == true
                    map[sid] = Mapping(famEventId: r.event.id, fingerprint: f.fingerprint, date: f.date,
                                       calendarId: calendarId, createdHere: !existing)
                    if !existing { added += 1 }
                } catch {
                    errors.append("Couldn't add “\(f.title)” (\(f.date)): \(error.localizedDescription)")
                }
            }
        }

        // 4. Remove copies whose device event is gone, or whose calendar was
        //    turned off. Older-than-window entries are just forgotten.
        for (sid, m) in map where wanted[sid] == nil {
            if m.date < fromKey { map[sid] = nil; continue }
            guard presentCalendarIds.contains(m.calendarId) || !selectedIds.contains(m.calendarId) else { continue }
            if truncated && selectedIds.contains(m.calendarId) { continue }   // may just be past the cap
            if m.createdHere, let famId = m.famEventId {
                do {
                    try await api.deleteFamilyEvent(famId)
                    removed += 1
                    map[sid] = nil
                } catch APIError.http(404, _) {
                    map[sid] = nil
                } catch APIError.http(403, _) {
                    map[sid] = nil
                } catch {
                    errors.append("Couldn't remove “\(sid.prefix(10))…”: \(error.localizedDescription)")
                }
            } else {
                map[sid] = nil
            }
        }

        saveMap(map)
        lastSync = Date()
        defaults.set(lastSync, forKey: storageKey("lastSync"))
        lastErrors = Array(errors.prefix(4)) + (errors.count > 4 ? ["…and \(errors.count - 4) more."] : [])
        var parts: [String] = []
        if added > 0 { parts.append("added \(added)") }
        if updated > 0 { parts.append("updated \(updated)") }
        if removed > 0 { parts.append("removed \(removed)") }
        lastSummary = parts.isEmpty ? "Up to date" : parts.joined(separator: ", ").capitalizedFirst
        if truncated { lastSummary! += " · first \(Self.maxEvents) events only" }
        if added + updated + removed > 0 { await onImported?() }
    }

    // MARK: Event → Fam ETC fields

    struct Fields {
        let title: String
        let date: String
        let time: String?
        let endTime: String?
        let endDate: String?
        let notes: String?

        init(_ ev: EKEvent) {
            let rawTitle = (ev.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            title = String((rawTitle.isEmpty ? "Event" : rawTitle).prefix(200))
            let start: Date = ev.startDate
            // EventKit ends all-day events at the next midnight; a timed event
            // ending exactly at midnight belongs to the day before too.
            let endRaw: Date = ev.endDate ?? start
            let lastInstant = endRaw > start ? endRaw.addingTimeInterval(-1) : start
            date = DeviceCalendarSync.ymd(start)
            let lastDay = DeviceCalendarSync.ymd(lastInstant)
            endDate = lastDay > date ? lastDay : nil
            if ev.isAllDay {
                time = nil
                endTime = nil
            } else {
                time = DeviceCalendarSync.hm(start)
                endTime = (endDate == nil && endRaw > start) ? DeviceCalendarSync.hm(endRaw) : nil
            }
            var noteParts: [String] = []
            if let loc = ev.location?.trimmingCharacters(in: .whitespacesAndNewlines), !loc.isEmpty {
                noteParts.append("📍 \(loc)")
            }
            if let n = ev.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty {
                noteParts.append(n)
            }
            let joined = noteParts.joined(separator: "\n")
            notes = joined.isEmpty ? nil : String(joined.prefix(1000))
        }

        var fingerprint: String {
            [title, date, time ?? "", endTime ?? "", endDate ?? "", notes ?? ""].joined(separator: "\u{1F}")
        }
    }

    /// Stable across edits and across devices on the same account; repeating
    /// events add their (original) occurrence date so each instance is its own
    /// Fam ETC event.
    nonisolated static func sourceId(for ev: EKEvent) -> String? {
        let base = ev.calendarItemExternalIdentifier ?? ev.eventIdentifier
        guard let base, !base.isEmpty else { return nil }
        var key = base
        if ev.hasRecurrenceRules, let occ = ev.occurrenceDate {
            key += "|" + String(Int(occ.timeIntervalSince1970))
        }
        let digest = SHA256.hash(data: Data(key.utf8))
        return "ek-" + digest.prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    nonisolated static func isDeclined(_ ev: EKEvent) -> Bool {
        guard let me = ev.attendees?.first(where: { $0.isCurrentUser }) else { return false }
        return me.participantStatus == .declined
    }

    nonisolated static func ymd(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    nonisolated static func hm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    // MARK: Storage

    private var defaults: UserDefaults { .standard }
    private func storageKey(_ name: String) -> String { "fam_deviceCal_\(name)_\(accountKey ?? "none")" }

    private func loadMap() -> [String: Mapping] {
        guard let data = defaults.data(forKey: storageKey("map")),
              let map = try? JSONDecoder().decode([String: Mapping].self, from: data) else { return [:] }
        return map
    }

    private func saveMap(_ map: [String: Mapping]) {
        if let data = try? JSONEncoder().encode(map) { defaults.set(data, forKey: storageKey("map")) }
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
