import Foundation

/// Presentation decisions use reported device evidence, never server acceptance alone.
enum ScreenTimeEssentialsPresentation {
    static let freshness: TimeInterval = 24 * 60 * 60

    static func confirmed(_ device: ScreenTimeDevice, policy: ScreenTimePolicy,
                          now: Date = Date(), after: Date? = nil) -> Bool {
        guard device.authStatus == "approved", device.state == "ok",
              device.appliedVersion == policy.version,
              let health = device.health, health.policyVersion == policy.version,
              health.state == (policy.enabled ? "applied" : "off"),
              health.failures.isEmpty,
              health.registeredActivities == health.expectedActivities,
              !policy.enabled || !policy.limits.contains(where: \.isTotal) || health.hasUsageSelection,
              let checked = ScreenTimeSchedule.date(fromISO: health.checkedAt),
              now.timeIntervalSince(checked) <= freshness,
              checked <= now.addingTimeInterval(60) else { return false }
        return after.map { checked >= $0 } ?? true
    }

    static func protection(_ device: ScreenTimeDevice, policy: ScreenTimePolicy,
                           now: Date = Date(), after: Date? = nil) -> String {
        if device.authStatus == "denied" || device.state == "revoked" { return "Access needs reconnecting" }
        if device.state == "removed" || device.state == "stale" { return "Can't reach this device" }
        if device.authStatus != "approved" { return "Waiting to check device" }
        if confirmed(device, policy: policy, now: now, after: after) {
            return policy.enabled ? "Rules confirmed on this device" : "Off confirmed on this device"
        }
        guard let health = device.health else {
            return after == nil ? "Waiting to check device" : "Check requested · waiting for this device"
        }
        if let after, ScreenTimeSchedule.date(fromISO: health.checkedAt).map({ $0 < after }) ?? true {
            return "Check requested · waiting for this device"
        }
        if health.state == "needsSelection" { return "Setup needs one more step" }
        if health.state == "failed" || health.state == "partial" {
            return "Device check needs another try"
        }
        if let checked = ScreenTimeSchedule.date(fromISO: health.checkedAt), now.timeIntervalSince(checked) > freshness {
            return "Waiting for a fresh device check"
        }
        return "Waiting for this device to confirm the rules"
    }

    static func nextAction(_ device: ScreenTimeDevice, policy: ScreenTimePolicy,
                           now: Date = Date(), after: Date? = nil) -> String? {
        if confirmed(device, policy: policy, now: now, after: after) { return nil }
        if device.authStatus == "denied" || device.state == "revoked" {
            return "Open Fam ETC on this device and reconnect Screen Time access together."
        }
        if device.health?.state == "needsSelection" {
            return "Open Fam ETC on this device and tap Finish setup."
        }
        return "When you have this device, open Fam ETC and tap Check this device."
    }

    /// Legacy alerts are still displayed, but never infer a child's intent or app removal.
    static func neutralAlert(type: String, kidName: String) -> String {
        switch type {
        case "revoked": return "Screen Time access needs reconnecting on \(kidName)'s device."
        case "stale", "removed", "check_needed":
            return "A device check is needed for \(kidName). The device may be off or offline."
        case "restored": return "Screen Time access is available again on \(kidName)'s device. Check the current rules."
        case "selection_changed": return "The app selection changed on \(kidName)'s device. Review it together."
        default: return "Screen Time update for \(kidName). Open the controls to check the device."
        }
    }

    static func showEssentialApps(devices: [ScreenTimeDevice], expanded: Bool) -> Bool {
        expanded || devices.contains { $0.essentialApps?.pending != nil }
    }

    static func remaining(_ usage: ScreenTimeUsageDevice?, now: Date = Date()) -> String {
        guard let usage, let minutes = usage.minutes else { return "No usage report yet · remaining time unavailable" }
        guard let updated = ScreenTimeSchedule.date(fromISO: usage.updatedAt) else {
            return "About \(duration(minutes)) used · report time unavailable"
        }
        if !Calendar.current.isDate(updated, inSameDayAs: now) || now.timeIntervalSince(updated) > freshness {
            return "Usage report is out of date · remaining time unavailable"
        }
        guard let remaining = usage.remainingMinutes, usage.limitMinutes != nil else {
            return "About \(duration(minutes)) used · no reported daily allowance"
        }
        return "About \(duration(max(0, remaining))) remaining on this device"
    }

    static func duration(_ minutes: Int) -> String {
        let safe = max(0, minutes)
        if safe < 60 { return "\(safe) min" }
        return safe % 60 == 0 ? "\(safe / 60) h" : "\(safe / 60) h \(safe % 60) min"
    }

    static func selectionError(apps: Int, categories: Int, websites: Int) -> String? {
        if categories > 0 || websites > 0 { return "Choose individual apps only. Remove categories and websites from your selection." }
        if apps == 0 { return "Choose at least one individual app." }
        if apps > 50 { return "Choose up to 50 individual apps." }
        return nil
    }

    struct DowntimeBoundary: Equatable {
        let startsAt: Date
        let endsAt: Date
        let isActive: Bool
    }

    /// Merge overlapping windows so an access-return time cannot land inside another one.
    static func downtimeBoundary(_ windows: [ScreenTimeDowntime], now: Date = Date(),
                                 calendar: Calendar = .current) -> DowntimeBoundary? {
        var intervals: [DateInterval] = []
        let day = calendar.startOfDay(for: now)
        for offset in -1...7 {
            guard let date = calendar.date(byAdding: .day, value: offset, to: day) else { continue }
            for window in windows where window.days.contains(calendar.component(.weekday, from: date)) {
                let start = window.start.split(separator: ":").compactMap { Int($0) }
                let end = window.end.split(separator: ":").compactMap { Int($0) }
                guard start.count == 2, end.count == 2,
                      start != end,
                      (0...23).contains(start[0]), (0...59).contains(start[1]),
                      (0...23).contains(end[0]), (0...59).contains(end[1]),
                      let from = calendar.date(bySettingHour: start[0], minute: start[1], second: 0, of: date),
                      var to = calendar.date(bySettingHour: end[0], minute: end[1], second: 0, of: date) else { continue }
                if to <= from { to = calendar.date(byAdding: .day, value: 1, to: to) ?? to }
                if to > from { intervals.append(DateInterval(start: from, end: to)) }
            }
        }
        var merged: [DateInterval] = []
        for interval in intervals.sorted(by: { $0.start < $1.start }) {
            if let last = merged.last, interval.start <= last.end {
                merged[merged.count - 1] = DateInterval(start: last.start, end: max(last.end, interval.end))
            } else { merged.append(interval) }
        }
        guard let next = merged.first(where: { $0.end > now }) else { return nil }
        return DowntimeBoundary(startsAt: next.start, endsAt: next.end, isActive: next.start <= now)
    }
}

/// A single device-local review draft, separate from policy/enforcement storage.
/// Tokens can be reopened in Apple's picker only for the same server proposal.
enum ScreenTimeEssentialAppsReviewDraft {
    static let key = "fam_st_essentialAppsReviewDraft"
    static let maxSelectionBytes = 64 * 1024
    static let maxRecordBytes = 70 * 1024

    struct Identity: Codable, Equatable {
        let deviceId: String
        let assignmentGeneration: Int
        let kidId: String
        let accountId: String

        var isValid: Bool {
            assignmentGeneration >= 1 && [deviceId, kidId, accountId].allSatisfy { !$0.isEmpty && $0.utf8.count <= 256 }
        }
    }

    struct Record: Codable, Equatable {
        let identity: Identity
        let pendingId: String
        let selection: String
        let note: String

        var isValid: Bool {
            identity.isValid && !pendingId.isEmpty && pendingId.utf8.count <= 256
                && !selection.isEmpty && selection.utf8.count <= maxSelectionBytes && note.count <= 80
        }

        func matches(identity current: Identity?, pendingId currentPending: String?) -> Bool {
            isValid && identity == current && pendingId == currentPending
        }
    }

    static func save(_ record: Record, defaults: UserDefaults) -> Bool {
        guard record.isValid, let data = try? JSONEncoder().encode(record), data.count <= maxRecordBytes else {
            clear(defaults: defaults); return false
        }
        defaults.set(data, forKey: key)
        return true
    }

    static func restore(identity: Identity?, pendingId: String?, defaults: UserDefaults) -> Record? {
        guard let record = read(defaults: defaults), record.matches(identity: identity, pendingId: pendingId) else {
            clear(defaults: defaults); return nil
        }
        return record
    }

    /// Can run before the policy loads; an unknown pending id must not destroy a
    /// same-account draft while awaiting that response.
    static func reconcileScope(identity: Identity?, defaults: UserDefaults) {
        guard let record = read(defaults: defaults), identity == record.identity else {
            clear(defaults: defaults); return
        }
    }

    private static func read(defaults: UserDefaults) -> Record? {
        guard let data = defaults.data(forKey: key), data.count <= maxRecordBytes,
              let record = try? JSONDecoder().decode(Record.self, from: data), record.isValid else { return nil }
        return record
    }

    static func clear(defaults: UserDefaults) { defaults.removeObject(forKey: key) }
}
