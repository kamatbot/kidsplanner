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
        if !store.isParent, !store.needsAuth, service.isEnrolled, service.authState == .approved {
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    MicroLabel(text: "My screen time today")
                        .accessibilityAddTraits(.isHeader)
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
