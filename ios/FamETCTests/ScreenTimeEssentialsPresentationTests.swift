import XCTest
#if canImport(FamETC)
@testable import FamETC
#endif

final class ScreenTimeEssentialsPresentationTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_784_000)

    private func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
    private var policy: ScreenTimePolicy { ScreenTimePolicy(version: 3, enabled: true, limits: [], downtime: []) }
    private var device: ScreenTimeDevice {
        ScreenTimeDevice(id: "phone", label: "iPhone", mode: "cooperative", authStatus: "approved", appliedVersion: 3,
                         state: "ok", health: ScreenTimeDeviceHealth(policyVersion: 3, state: "applied",
                                                                   registeredActivities: 4, expectedActivities: 4,
                                                                   hasUsageSelection: true, failures: [], checkedAt: iso(now)))
    }

    func testCurrentCompleteEvidenceConfirmsButLegacyDoesNot() {
        XCTAssertTrue(ScreenTimeEssentialsPresentation.confirmed(device, policy: policy, now: now))
        var legacy = device
        legacy.health = nil
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(legacy, policy: policy, now: now))
        XCTAssertEqual(ScreenTimeEssentialsPresentation.protection(legacy, policy: policy, now: now), "Waiting to check device")
    }

    func testOnlyExactAppliedAndHealthVersionsConfirmCurrentPolicy() {
        for version in [policy.version - 1, policy.version + 1] {
            var mismatched = device
            mismatched.appliedVersion = version
            XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(mismatched, policy: policy, now: now))
            mismatched = device
            mismatched.health?.policyVersion = version
            XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(mismatched, policy: policy, now: now))
            mismatched.appliedVersion = version
            XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(mismatched, policy: policy, now: now))
        }
    }

    func testEnabledDailyLimitRequiresUsageSelectionButDowntimeAndOffDoNot() {
        var noSelection = device
        noSelection.health?.hasUsageSelection = false
        var rules = policy
        rules.downtime = [ScreenTimeDowntime(id: "bedtime", name: "Bedtime", start: "21:00", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7])]
        XCTAssertTrue(ScreenTimeEssentialsPresentation.confirmed(noSelection, policy: rules, now: now))
        rules.limits = [ScreenTimeLimit(id: "total", kind: "total", name: "Daily screen time", minutesPerDay: 120)]
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(noSelection, policy: rules, now: now))
        noSelection.health?.hasUsageSelection = true
        XCTAssertTrue(ScreenTimeEssentialsPresentation.confirmed(noSelection, policy: rules, now: now))
        rules.enabled = false
        noSelection.health?.hasUsageSelection = false
        noSelection.health?.state = "off"
        XCTAssertTrue(ScreenTimeEssentialsPresentation.confirmed(noSelection, policy: rules, now: now))
    }

    func testCheckRequestRequiresNewDeviceEvidence() {
        let requested = now.addingTimeInterval(5)
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(device, policy: policy, now: requested, after: requested))
        XCTAssertTrue(ScreenTimeEssentialsPresentation.protection(device, policy: policy, now: requested, after: requested).contains("waiting"))
        var refreshed = device
        refreshed.health?.checkedAt = iso(requested)
        XCTAssertTrue(ScreenTimeEssentialsPresentation.confirmed(refreshed, policy: policy, now: requested, after: requested))
    }

    func testPartialFailureMissingRegistrationsAndStaleEvidenceAreUnconfirmed() {
        var partial = device
        partial.health?.registeredActivities = 3
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(partial, policy: policy, now: now))
        partial.health?.registeredActivities = 4
        partial.health?.failures = ["registration_failed"]
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(partial, policy: policy, now: now))
        var stale = device
        stale.health?.checkedAt = iso(now.addingTimeInterval(-25 * 3600))
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(stale, policy: policy, now: now))
    }

    func testUnknownAccessWaitsAndDenialRequiresReconnectWithoutBlame() {
        var unknown = device
        unknown.authStatus = "notDetermined"
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(unknown, policy: policy, now: now))
        XCTAssertEqual(ScreenTimeEssentialsPresentation.protection(unknown, policy: policy, now: now), "Waiting to check device")
        unknown.authStatus = "denied"
        XCTAssertEqual(ScreenTimeEssentialsPresentation.protection(unknown, policy: policy, now: now), "Access needs reconnecting")
        XCTAssertTrue(ScreenTimeEssentialsPresentation.nextAction(unknown, policy: policy, now: now)!.contains("reconnect"))
        unknown.authStatus = "approved"; unknown.state = "revoked"
        XCTAssertEqual(ScreenTimeEssentialsPresentation.protection(unknown, policy: policy, now: now), "Access needs reconnecting")
    }

    func testOfflineStatesNeverImplyAppRemovalOrChildIntent() {
        for state in ["stale", "removed"] {
            var offline = device
            offline.state = state
            XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(offline, policy: policy, now: now))
            XCTAssertEqual(ScreenTimeEssentialsPresentation.protection(offline, policy: policy, now: now), "Can't reach this device")
        }
        for type in ["removed", "stale", "check_needed"] {
            let text = ScreenTimeEssentialsPresentation.neutralAlert(type: type, kidName: "Maya")
            XCTAssertTrue(text.contains("may be off or offline"))
            XCTAssertFalse(text.contains("removed"))
            XCTAssertFalse(text.contains("turned off"))
        }
        XCTAssertEqual(ScreenTimeEssentialsPresentation.neutralAlert(type: "revoked", kidName: "Maya"),
                       "Screen Time access needs reconnecting on Maya's device.")
    }

    func testConfirmationFreshnessBoundaryAndFutureClockAreConservative() {
        var dated = device
        dated.health?.checkedAt = iso(now.addingTimeInterval(-ScreenTimeEssentialsPresentation.freshness))
        XCTAssertTrue(ScreenTimeEssentialsPresentation.confirmed(dated, policy: policy, now: now))
        dated.health?.checkedAt = iso(now.addingTimeInterval(-ScreenTimeEssentialsPresentation.freshness - 1))
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(dated, policy: policy, now: now))
        dated.health?.checkedAt = iso(now.addingTimeInterval(61))
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(dated, policy: policy, now: now))
        dated.health?.checkedAt = "not-a-date"
        XCTAssertFalse(ScreenTimeEssentialsPresentation.confirmed(dated, policy: policy, now: now))
    }

    func testUsageMissingIsUnavailableAndAllowanceIsDeviceScoped() {
        XCTAssertTrue(ScreenTimeEssentialsPresentation.remaining(nil, now: now).contains("unavailable"))
        var usage = ScreenTimeUsageDevice(deviceId: "phone", minutes: nil)
        XCTAssertTrue(ScreenTimeEssentialsPresentation.remaining(usage, now: now).contains("No usage report"))
        usage.minutes = 45; usage.limitMinutes = 120; usage.remainingMinutes = 75; usage.updatedAt = iso(now)
        XCTAssertEqual(ScreenTimeEssentialsPresentation.remaining(usage, now: now), "About 1 h 15 min remaining on this device")
        usage.updatedAt = iso(now.addingTimeInterval(-25 * 3600))
        XCTAssertTrue(ScreenTimeEssentialsPresentation.remaining(usage, now: now).contains("out of date"))
        usage.updatedAt = nil
        XCTAssertTrue(ScreenTimeEssentialsPresentation.remaining(usage, now: now).contains("report time unavailable"))
    }

    func testProposalRejectsCategoriesWebsitesAndCountBoundaries() {
        XCTAssertNil(ScreenTimeEssentialsPresentation.selectionError(apps: 1, categories: 0, websites: 0))
        XCTAssertNil(ScreenTimeEssentialsPresentation.selectionError(apps: 50, categories: 0, websites: 0))
        XCTAssertNotNil(ScreenTimeEssentialsPresentation.selectionError(apps: 0, categories: 0, websites: 0))
        XCTAssertNotNil(ScreenTimeEssentialsPresentation.selectionError(apps: 51, categories: 0, websites: 0))
        XCTAssertNotNil(ScreenTimeEssentialsPresentation.selectionError(apps: 1, categories: 1, websites: 0))
        XCTAssertNotNil(ScreenTimeEssentialsPresentation.selectionError(apps: 1, categories: 0, websites: 1))
    }

    func testEssentialAppsStayCollapsedUnlessRequestedOrPending() {
        var phone = device
        phone.essentialApps = ScreenTimeEssentialApps(summary: SelectionSummary(apps: 1, categories: 0, webDomains: 0))
        XCTAssertFalse(ScreenTimeEssentialsPresentation.showEssentialApps(devices: [phone], expanded: false))
        XCTAssertTrue(ScreenTimeEssentialsPresentation.showEssentialApps(devices: [phone], expanded: true))
        phone.essentialApps?.pending = ScreenTimeEssentialAppsPending(id: "proposal", summary: SelectionSummary(apps: 2, categories: 0, webDomains: 0))
        XCTAssertTrue(ScreenTimeEssentialsPresentation.showEssentialApps(devices: [phone], expanded: false))
        XCTAssertFalse(ScreenTimeEssentialsPresentation.showEssentialApps(devices: [], expanded: false))
    }

    func testOvernightAndOverlappingWindowsReturnEndOfAllDowntime() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let date = calendar.date(from: DateComponents(year: 2026, month: 9, day: 30, hour: 6))!
        let yesterday = calendar.component(.weekday, from: calendar.date(byAdding: .day, value: -1, to: date)!)
        let today = calendar.component(.weekday, from: date)
        let windows = [ScreenTimeDowntime(id: "bed", name: "Bedtime", start: "21:00", end: "07:00", days: [yesterday]),
                       ScreenTimeDowntime(id: "quiet", name: "Quiet time", start: "06:30", end: "08:00", days: [today])]
        let boundary = ScreenTimeEssentialsPresentation.downtimeBoundary(windows, now: date, calendar: calendar)
        XCTAssertEqual(boundary?.isActive, true)
        XCTAssertEqual(boundary?.endsAt, calendar.date(from: DateComponents(year: 2026, month: 9, day: 30, hour: 8)))
    }

    func testZeroDurationIsNotShownAsAllDayDowntime() {
        let window = ScreenTimeDowntime(id: "zero", name: "Quiet", start: "07:00", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7])
        XCTAssertNil(ScreenTimeEssentialsPresentation.downtimeBoundary([window], now: now))
    }

    func testReviewDraftRestoresOnlyForExactIdentityAndPendingRequest() {
        let identity = ScreenTimeEssentialAppsReviewDraft.Identity(deviceId: "phone", assignmentGeneration: 3, kidId: "kid", accountId: "account")
        let record = ScreenTimeEssentialAppsReviewDraft.Record(identity: identity, pendingId: "proposal", selection: "opaque-token-blob", note: "Calls")
        XCTAssertTrue(record.matches(identity: identity, pendingId: "proposal"))
        XCTAssertFalse(record.matches(identity: identity, pendingId: "replacement"))
        XCTAssertFalse(record.matches(identity: identity, pendingId: nil))
        XCTAssertFalse(record.matches(identity: nil, pendingId: "proposal"))
        for changed in [ScreenTimeEssentialAppsReviewDraft.Identity(deviceId: "tablet", assignmentGeneration: 3, kidId: "kid", accountId: "account"),
                        .init(deviceId: "phone", assignmentGeneration: 4, kidId: "kid", accountId: "account"),
                        .init(deviceId: "phone", assignmentGeneration: 3, kidId: "sibling", accountId: "account"),
                        .init(deviceId: "phone", assignmentGeneration: 3, kidId: "kid", accountId: "another-account")] {
            XCTAssertFalse(record.matches(identity: changed, pendingId: "proposal"))
        }
    }

    func testReviewDraftIsBoundedAndRejectsMissingIdentity() {
        let identity = ScreenTimeEssentialAppsReviewDraft.Identity(deviceId: "phone", assignmentGeneration: 1, kidId: "kid", accountId: "account")
        XCTAssertFalse(ScreenTimeEssentialAppsReviewDraft.Record(identity: identity, pendingId: "proposal",
                                                                selection: String(repeating: "x", count: 64 * 1024 + 1), note: "").isValid)
        XCTAssertFalse(ScreenTimeEssentialAppsReviewDraft.Record(identity: identity, pendingId: "proposal", selection: "opaque",
                                                                note: String(repeating: "x", count: 81)).isValid)
        XCTAssertFalse(ScreenTimeEssentialAppsReviewDraft.Identity(deviceId: "", assignmentGeneration: 1, kidId: "kid", accountId: "account").isValid)
        XCTAssertFalse(ScreenTimeEssentialAppsReviewDraft.Identity(deviceId: "phone", assignmentGeneration: 0, kidId: "kid", accountId: "account").isValid)
    }
}
