import Foundation
import DeviceActivity
import ManagedSettings

/// Enforces Screen Time schedules while the app is closed. Stays well under the
/// ~6 MB extension memory cap: no SwiftUI, only the shared enforcer.
///
/// Callbacks are hints to re-check, never truth (docs/SCREEN-TIME-UX.md §5): a shield is
/// added only when the stored policy says so right now, anything ambiguous only removes,
/// and only the app registers or stops DeviceActivity schedules.
final class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let enforcer = ScreenTimeEnforcer.shared

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        enforcer.recordMonitorFire()
        let name = activity.rawValue
        if name.hasPrefix("heartbeat.") { heartbeat() }   // always, even while Screen Time is off
        let now = Date()
        enforcer.reconcileShields(now: now)
        guard enforcer.isEnrolled, enforcer.storedPolicy?.enabled == true else { return }

        if name.hasPrefix("day.") {
            // A day.N start within 60 s of the app (re)registering is its echo, not midnight:
            // the app already cleared what changed, and today's genuine shields stay.
            guard ScreenTimeSchedule.isTodayActivity(name, now: now),
                  !ScreenTimeSchedule.isRegistrationEcho(now: now, registeredAt: enforcer.registeredAt) else { return }
            enforcer.forgetLimitEvents()
            enforcer.clearLimitStores()
        } else if name.hasPrefix("downtime.") {
            let id = String(name.dropFirst("downtime.".count))
            guard enforcer.downtimeShouldShield(id: id, now: now) else { return }
            // Refresh first: a force-quit app never gets the "turned off" push, so the stored
            // policy may be stale. downtimeDidStart re-checks the refreshed policy.
            heartbeat()
            enforcer.downtimeDidStart(id: id, now: now)
        } else if activity == .pause {
            guard enforcer.pauseShouldShield(now: now) else { return }
            heartbeat()
            enforcer.pauseDidStart(now: now)
        }
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        enforcer.recordMonitorFire()
        let now = Date()
        enforcer.reconcileShields(now: now)
        let name = activity.rawValue
        if activity == .pause {
            enforcer.clear(.pause)
        } else if name.hasPrefix("downtime.") {
            // ponytail: one shared `downtime` store — cleared unless another window is still on.
            enforcer.downtimeDidEnd(id: String(name.dropFirst("downtime.".count)), now: now)
        }
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        enforcer.recordMonitorFire()
        let now = Date()
        guard enforcer.isEnrolled, enforcer.storedPolicy?.enabled == true else {
            enforcer.clearAllStores()
            return
        }
        // Only today's day.N counts: another weekday's or a stale activity never shields.
        guard ScreenTimeSchedule.isTodayActivity(activity.rawValue, now: now) else { return }
        let name = event.rawValue
        if let minutes = ScreenTimeSchedule.usageMinutes(fromEvent: name) {
            guard enforcer.canAcceptAssignmentEvent(now: now) else { return }
            // More minutes than have passed since midnight is a spurious milestone: drop it.
            guard ScreenTimeSchedule.isPlausibleUsage(minutes: minutes, now: now) else { return }
            // Coarse total only (the highest 15-minute step today) — never which apps.
            enforcer.recordUsage(minutes: minutes, now: now)
            // Refresh (throttled) before deciding, so a parent's "turn off" wins.
            if enforcer.claimUsageHeartbeat(now: now) { heartbeat() }
            if enforcer.decideTotalShield(now: now) { heartbeat() }
        } else if name.hasPrefix("limit.") {
            if enforcer.claimUsageHeartbeat(now: now) { heartbeat() }
            if enforcer.limitEventDidFire(id: String(name.dropFirst("limit.".count)), now: now) { heartbeat() }
        }
    }

    /// The extension may be suspended as soon as a callback returns, so block
    /// (bounded) until the heartbeat finishes. A newer policy is only stored (and
    /// shields it no longer justifies removed); the app applies it on its next wake.
    private func heartbeat() {
        guard enforcer.isEnrolled else { return }
        let done = DispatchSemaphore(value: 0)
        enforcer.heartbeat(source: "monitor") { _ in done.signal() }
        _ = done.wait(timeout: .now() + 25)
    }
}
