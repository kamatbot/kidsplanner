import Foundation
import DeviceActivity
import ManagedSettings

/// Enforces Screen Time schedules while the app is closed. Stays well under the
/// ~6 MB extension memory cap: no SwiftUI, only the shared enforcer.
final class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let enforcer = ScreenTimeEnforcer.shared

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        enforcer.recordMonitorFire()
        let name = activity.rawValue
        if name.hasPrefix("day.") {
            enforcer.clearLimitStores()
        } else if activity == .pause {
            enforcer.shieldAll(.pause, reason: "Paused by a parent")
        } else if name.hasPrefix("downtime.") {
            enforcer.downtimeDidStart(id: String(name.dropFirst("downtime.".count)))
        } else if name.hasPrefix("heartbeat.") {
            heartbeat()
        }
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        enforcer.recordMonitorFire()
        if activity == .pause {
            enforcer.clear(.pause)
        } else if activity.rawValue.hasPrefix("downtime.") {
            // ponytail: one shared `downtime` store — overlapping windows end together; per-window stores if that matters.
            enforcer.clear(.downtime)
        }
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        enforcer.recordMonitorFire()
        let name = event.rawValue
        if name.hasPrefix("limit.") {
            let id = String(name.dropFirst("limit.".count))
            enforcer.shieldLimit(id: id)
            if id == "total" {
                enforcer.recordUsage(limitReached: true)
                heartbeat()
            }
        } else if let minutes = ScreenTimeSchedule.usageMinutes(fromEvent: name) {
            // Coarse total only (the highest 15-minute step today) — never which apps.
            enforcer.recordUsage(minutes: minutes)
            if enforcer.claimUsageHeartbeat() { heartbeat() }
        }
    }

    /// The extension may be suspended as soon as a callback returns, so block
    /// (bounded) until the heartbeat finishes. A newer policy is only stored;
    /// the app applies it on its next wake.
    private func heartbeat() {
        guard enforcer.isEnrolled else { return }
        let done = DispatchSemaphore(value: 0)
        enforcer.heartbeat(source: "monitor") { _ in done.signal() }
        _ = done.wait(timeout: .now() + 25)
    }
}
