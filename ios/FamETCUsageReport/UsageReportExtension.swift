import DeviceActivity
import ExtensionKit
import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit

// Renders Apple's Screen Time usage inside Fam ETC (docs/SCREEN-TIME-PLAN.md "Usage
// details"). Report extensions can draw but never send data anywhere, so nothing here
// leaves the device. Context names must match the app's `DeviceActivityReport.Context`s.

@main
struct FamETCUsageReport: DeviceActivityReportExtension {
    var body: some DeviceActivityReportScene {
        KidTodayReport { KidTodayView(config: $0) }
        FamilyReport { FamilyView(config: $0) }
    }
}

extension DeviceActivityReport.Context {
    static let kidToday = Self("kidToday")
    static let family = Self("family")
}

// MARK: - Colors (the extension can't import the app's Palette; values mirror Theme.swift)

private enum Ink {
    static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
    }
    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
    static let card = adaptive(0xFFFFFF, 0x1B1D24)       // frCard
    static let rule = adaptive(0xE7E9EE, 0x2C2F38)       // frRule
    static let text = adaptive(0x15171C, 0xF2F3F5)       // frInk
    static let text2 = adaptive(0x6B7280, 0xA1A7B3)      // frInk2
    static let you = adaptive(0x7B4DFF, 0xA68CFF)        // frYou
    static let hw = adaptive(0xF5821F, 0xFF9A3C)         // frHw
    static let danger = adaptive(0xC8283F, 0xFF7A8A)     // frDanger
    /// Matches an inset-grouped List row (parent sheet).
    static let listRow = Color(uiColor: .secondarySystemGroupedBackground)
}

// MARK: - Shared

private struct AppTime: Hashable {
    let token: ApplicationToken?
    let name: String?
    let seconds: TimeInterval
}

private struct CategoryTime: Hashable {
    let token: ActivityCategoryToken?
    let name: String?
    let seconds: TimeInterval
}

private enum Duration {
    /// 105 min → "1 h 45 min"; under a minute → "0 min".
    static func text(_ seconds: TimeInterval) -> String {
        let m = Int(seconds / 60)
        if m < 60 { return "\(m) min" }
        return m % 60 == 0 ? "\(m / 60) h" : "\(m / 60) h \(m % 60) min"
    }

    /// Spoken form for VoiceOver ("1 hour, 45 minutes").
    static func spoken(_ seconds: TimeInterval) -> String {
        let f = DateComponentsFormatter()
        f.allowedUnits = [.hour, .minute]
        f.unitsStyle = .full
        return f.string(from: max(0, (seconds / 60).rounded(.down) * 60)) ?? text(seconds)
    }
}

/// Totals every app and category across the segments of `data` (one user's view).
private func tally(_ segments: DeviceActivityResults<DeviceActivityData.ActivitySegment>,
                   total: inout TimeInterval,
                   apps: inout [Application: TimeInterval],
                   categories: inout [ActivityCategory: TimeInterval]) async {
    for await segment in segments {
        total += segment.totalActivityDuration
        for await category in segment.categories {
            categories[category.category, default: 0] += category.totalActivityDuration
            for await app in category.applications {
                apps[app.application, default: 0] += app.totalActivityDuration
            }
        }
    }
}

private func topApps(_ apps: [Application: TimeInterval], _ n: Int) -> [AppTime] {
    apps.filter { $0.value >= 60 }
        .sorted { $0.value > $1.value }
        .prefix(n)
        .map { AppTime(token: $0.key.token, name: $0.key.localizedDisplayName, seconds: $0.value) }
}

private struct AppRow: View {
    let app: AppTime
    var body: some View {
        HStack(spacing: 10) {
            Group {
                if let token = app.token {
                    Label(token)
                } else {
                    Label(app.name ?? "An app", systemImage: "app")
                }
            }
            .font(.subheadline)
            .foregroundStyle(Ink.text)
            .lineLimit(1)
            Spacer(minLength: 8)
            Text(Duration.text(app.seconds))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Ink.text2)
                .monospacedDigit()
                .accessibilityLabel(Duration.spoken(app.seconds))
        }
        .accessibilityElement(children: .combine)
    }
}

private struct SectionTitle: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .textCase(.uppercase)
            .tracking(1)
            .foregroundStyle(Ink.text2)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Kid: my screen time today

struct KidTodayConfig {
    fileprivate var total: TimeInterval = 0
    fileprivate var apps: [AppTime] = []
    fileprivate var categories: [CategoryTime] = []
    /// Today's allowance in minutes from the App Group policy (nil without a daily limit).
    var allowance: Int?
}

struct KidTodayReport: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .kidToday
    let content: (KidTodayConfig) -> KidTodayView

    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> KidTodayConfig {
        var total: TimeInterval = 0
        var apps: [Application: TimeInterval] = [:]
        var categories: [ActivityCategory: TimeInterval] = [:]
        for await d in data {
            await tally(d.activitySegments, total: &total, apps: &apps, categories: &categories)
        }
        var config = KidTodayConfig()
        config.total = total
        config.apps = topApps(apps, 5)
        config.categories = categories.filter { $0.value >= 60 }
            .sorted { $0.value > $1.value }
            .prefix(4)
            .map { CategoryTime(token: $0.key.token, name: $0.key.localizedDisplayName, seconds: $0.value) }
        let policy = UserDefaults(suiteName: "group.com.fametc.app.family-assistance")?
            .data(forKey: ScreenTimePolicy.storageKey)
            .flatMap { try? JSONDecoder().decode(ScreenTimePolicy.self, from: $0) }
        config.allowance = ScreenTimeSchedule.todayAllowance(policy, now: Date())
        return config
    }
}

struct KidTodayView: View {
    let config: KidTodayConfig

    private var over: Bool {
        guard let a = config.allowance else { return false }
        return config.total >= Double(a * 60)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if config.total < 60 {
                    Text("No screen time yet today.")
                        .font(.subheadline)
                        .foregroundStyle(Ink.text2)
                } else {
                    if !config.apps.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionTitle(text: "Top apps")
                            ForEach(config.apps, id: \.self) { AppRow(app: $0) }
                        }
                    }
                    if !config.categories.isEmpty {
                        categoriesSection
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 2)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Ink.card)
    }

    private var spokenSummary: String {
        guard let a = config.allowance, a > 0 else { return "\(Duration.spoken(config.total)) today" }
        return "\(Duration.spoken(config.total)) of \(Duration.spoken(Double(a * 60))) allowed today"
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(Duration.text(config.total))
                .font(.system(.largeTitle, design: .rounded).weight(.bold))
                .foregroundStyle(Ink.text)
                .monospacedDigit()
                .accessibilityLabel(spokenSummary)
            if let allowance = config.allowance, allowance > 0 {
                Text("of \(Duration.text(Double(allowance * 60))) allowed")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(over ? Ink.danger : Ink.text2)
                    .monospacedDigit()
                    .accessibilityHidden(true)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Ink.rule)
                        Capsule().fill(over ? Ink.danger : Ink.you)
                            .frame(width: geo.size.width * min(1, config.total / Double(allowance * 60)))
                    }
                }
                .frame(height: 8)
                .accessibilityHidden(true)
            }
        }
    }

    private var categoriesSection: some View {
        let longest = config.categories.map(\.seconds).max() ?? 1
        return VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: "By kind of app")
            ForEach(config.categories, id: \.self) { c in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Group {
                            if let token = c.token { Label(token) } else { Text(c.name ?? "Other") }
                        }
                        .font(.footnote)
                        .foregroundStyle(Ink.text)
                        .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(Duration.text(c.seconds))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Ink.text2)
                            .monospacedDigit()
                            .accessibilityLabel(Duration.spoken(c.seconds))
                    }
                    GeometryReader { geo in
                        Capsule().fill(Ink.hw)
                            .frame(width: max(6, geo.size.width * c.seconds / longest))
                    }
                    .frame(height: 6)
                    .accessibilityHidden(true)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: - Parent: Family Sharing children today

struct ChildUsage: Hashable {
    let name: String
    fileprivate let total: TimeInterval
    fileprivate let apps: [AppTime]
}

struct FamilyReport: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .family
    let content: ([ChildUsage]) -> FamilyView

    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> [ChildUsage] {
        // One entry per child, summed over their iPhone + iPad.
        var order: [String] = []
        var names: [String: String] = [:]
        var totals: [String: TimeInterval] = [:]
        var apps: [String: [Application: TimeInterval]] = [:]
        for await d in data {
            let given = d.user.nameComponents?.givenName
            let key = d.user.appleID ?? given ?? "child"
            if names[key] == nil { order.append(key); names[key] = given ?? "Your child" }
            var total: TimeInterval = 0
            var a: [Application: TimeInterval] = apps[key] ?? [:]
            var unused: [ActivityCategory: TimeInterval] = [:]
            await tally(d.activitySegments, total: &total, apps: &a, categories: &unused)
            totals[key, default: 0] += total
            apps[key] = a
        }
        return order.map { ChildUsage(name: names[$0] ?? "Your child", total: totals[$0] ?? 0, apps: topApps(apps[$0] ?? [:], 3)) }
    }
}

struct FamilyView: View {
    let config: [ChildUsage]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if config.isEmpty {
                    Text("No usage from your Family Sharing children yet today.")
                        .font(.subheadline)
                        .foregroundStyle(Ink.text2)
                }
                ForEach(config, id: \.self) { child in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(child.name)
                                .font(.headline)
                                .foregroundStyle(Ink.text)
                            Spacer(minLength: 8)
                            Text(Duration.text(child.total))
                                .font(.headline.weight(.bold))
                                .foregroundStyle(Ink.you)
                                .monospacedDigit()
                                .accessibilityLabel("\(Duration.spoken(child.total)) today")
                        }
                        .accessibilityElement(children: .combine)
                        ForEach(child.apps, id: \.self) { AppRow(app: $0) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 2)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Ink.listRow)
    }
}
