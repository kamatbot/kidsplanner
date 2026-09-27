import UIKit
import ManagedSettings
import ManagedSettingsUI

/// Fam ETC-branded shield: "Paused by Fam ETC", the reason written to the App
/// Group by ScreenTimeEnforcer (daily screen time / limit name / Downtime / Paused by a parent), one OK button.
final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    private static let violet = UIColor(red: 0x7B / 255, green: 0x4D / 255, blue: 0xFF / 255, alpha: 1)

    override func configuration(shielding application: Application) -> ShieldConfiguration {
        make(subtitle(app: application.token))
    }

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        make(subtitle(app: application.token, category: category.token))
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        make(subtitle(web: webDomain.token))
    }

    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        make(subtitle(web: webDomain.token, category: category.token))
    }

    private func make(_ subtitle: String) -> ShieldConfiguration {
        ShieldConfiguration(
            backgroundBlurStyle: .systemThickMaterial,
            title: .init(text: "Paused by Fam ETC", color: Self.violet),
            subtitle: .init(text: subtitle, color: .secondaryLabel),
            primaryButtonLabel: .init(text: "OK", color: .white),
            primaryButtonBackgroundColor: Self.violet)
    }

    /// Pause beats downtime beats limits; for limits, find the store that shields this token.
    private func subtitle(app: ApplicationToken? = nil, web: WebDomainToken? = nil, category: ActivityCategoryToken? = nil) -> String {
        let reasons = UserDefaults(suiteName: "group.com.fametc.app.family-assistance")?
            .dictionary(forKey: "fam_st_shieldReasons") as? [String: String] ?? [:]
        if reasons["pause"] != nil { return "Paused by a parent" }
        if reasons["downtime"] != nil { return "Downtime" }
        if let total = reasons["limit.total"] { return total }
        let limits = reasons.filter { $0.key.hasPrefix("limit.") }
        let match = limits.first { key, _ in
            let shield = ManagedSettingsStore(named: .init(key)).shield
            if let app, shield.applications?.contains(app) == true { return true }
            if let web, shield.webDomains?.contains(web) == true { return true }
            if let category, case .specific(let set, _)? = shield.applicationCategories, set.contains(category) { return true }
            if let category, case .specific(let set, _)? = shield.webDomainCategories, set.contains(category) { return true }
            return false
        } ?? limits.first
        if let reason = match?.value { return reason }
        return "Screen Time rules from your parents"
    }
}
