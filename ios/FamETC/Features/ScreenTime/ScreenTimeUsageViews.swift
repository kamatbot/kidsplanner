import SwiftUI
import DeviceActivity

// Screen Time "Usage details" (docs/SCREEN-TIME-PLAN.md). Apple's usage data never
// leaves the device: these views host the FamETCUsageReport extension, which renders
// it in place. Context names must match the extension's scenes.

extension DeviceActivityReport.Context {
    static let kidToday = Self("kidToday")
    static let family = Self("family")
}

enum ScreenTimeUsageFilter {
    /// Today (device-local midnight → midnight), iPhone + iPad. Stable for the whole day,
    /// so re-renders don't reload the report.
    static func today(users: DeviceActivityFilter.Users) -> DeviceActivityFilter {
        let day = Calendar.current.dateInterval(of: .day, for: Date())
            ?? DateInterval(start: Calendar.current.startOfDay(for: Date()), duration: 86_400)
        return DeviceActivityFilter(segment: .daily(during: day), users: users, devices: .init([.iPhone, .iPad]))
    }
}

/// Kid Today: "My screen time today" — total, top apps and categories from Apple's
/// Screen Time on this device. Only on an enrolled, approved kid device.
struct ScreenTimeUsageCard: View {
    @Environment(AppStore.self) private var store
    @ScaledMetric(relativeTo: .body) private var reportHeight: CGFloat = 380
    private var service: ScreenTimeService { .shared }

    var body: some View {
        if !store.isParent, !store.needsAuth, service.isEnrolled, service.authState == .approved,
           service.enrolledKidId == store.me?.kidId {
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    MicroLabel(text: "My screen time today")
                        .accessibilityAddTraits(.isHeader)
                    ScreenTimeLocalRemainingView()
                    ZStack {
                        // Shown until the report draws over it (the report renders async).
                        Text("Counting your screen time…")
                            .font(Typography.label)
                            .foregroundStyle(Palette.textSecond)
                            .accessibilityHidden(true)
                        DeviceActivityReport(.kidToday, filter: ScreenTimeUsageFilter.today(users: .all))
                    }
                    .frame(height: min(reportHeight, 640))
                }
            }
        }
    }
}

/// Local milestone counts describe this device only; Apple's detailed report below
/// may include other signed-in devices and is not an allowance meter.
struct ScreenTimeLocalRemainingView: View {
    private var service: ScreenTimeService { .shared }

    var body: some View {
        TimelineView(.everyMinute) { context in
            VStack(alignment: .leading, spacing: Space.xs) {
                if let policy = service.policy, let usage = ScreenTimeEnforcer.shared.todayUsage(now: context.date),
                   let allowance = ScreenTimeSchedule.todayAllowance(policy, now: context.date) {
                    Text("About \(ScreenTimeFormat.minutes(max(0, allowance - usage.minutes))) remaining on this device")
                        .font(Typography.body.weight(.semibold)).monospacedDigit()
                    Text("Approximate · counts selected apps in 15-minute steps. Report time unavailable; this estimate may lag. Bedtime and a parent pause still apply.")
                        .font(Typography.caption).foregroundStyle(Palette.textSecond)
                } else {
                    Text("No usage count yet on this device · remaining time unavailable")
                        .font(Typography.label).foregroundStyle(Palette.textSecond)
                }
                if let policy = service.policy, policy.enabled {
                    ScreenTimeNextAccessView(policy: policy, now: context.date)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
        }
    }
}

struct ScreenTimeNextAccessView: View {
    let policy: ScreenTimePolicy
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            if let boundary = ScreenTimeEssentialsPresentation.downtimeBoundary(policy.downtime, now: now) {
                Label(boundary.isActive
                      ? "Scheduled quiet time ends \(ScreenTimeFormat.moment(boundary.endsAt, now: now))"
                      : "Next quiet time \(ScreenTimeFormat.moment(boundary.startsAt, now: now)) · ends \(ScreenTimeFormat.moment(boundary.endsAt, now: now))",
                      systemImage: "moon.stars")
                    .font(Typography.label).monospacedDigit()
            }
            if let until = policy.pauseUntilDate, until > now {
                Text("Pause scheduled to end \(ScreenTimeFormat.moment(until, now: now))")
                    .font(Typography.label).monospacedDigit()
                if let boundary = ScreenTimeEssentialsPresentation.downtimeBoundary(policy.downtime, now: until), boundary.isActive {
                    Text("Quiet time continues until \(ScreenTimeFormat.moment(boundary.endsAt, now: now))")
                        .font(Typography.caption).foregroundStyle(Palette.textSecond)
                }
            }
            if !policy.downtime.isEmpty || policy.pauseUntilDate.map({ $0 > now }) == true {
                Text("Schedule in \(TimeZone.current.identifier). Daily and app limits may still apply after it ends.")
                    .font(Typography.caption).foregroundStyle(Palette.textSecond)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

/// Parent sheet (Advanced): Apple's per-child report for Family Sharing children.
struct ScreenTimeFamilyUsageReport: View {
    @ScaledMetric(relativeTo: .body) private var reportHeight: CGFloat = 320

    var body: some View {
        ZStack {
            Text("Loading usage…")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
                .accessibilityHidden(true)
            DeviceActivityReport(.family, filter: ScreenTimeUsageFilter.today(users: .children))
        }
        .frame(height: min(reportHeight, 600))
    }
}
