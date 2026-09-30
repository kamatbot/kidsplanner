#if SCREEN_TIME_STANDALONE
import Foundation
class XCTestCase {}
private func XCTAssertNil<T>(_ value: T?) { precondition(value == nil) }
private func XCTAssertTrue(_ value: Bool) { precondition(value) }
private func XCTAssertFalse(_ value: Bool) { precondition(!value) }
private func XCTAssertEqual<T: Equatable>(_ actual: T, _ expected: T) { precondition(actual == expected) }
#else
import XCTest
@testable import FamETC
#endif

final class ScreenTimeCoreContractTests: XCTestCase {
#if !SCREEN_TIME_STANDALONE
    func testReassignmentClearsOldPolicyBeforeAcceptingLowerVersion() {
        let suiteName = "fam_st_contract_\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let enforcer = ScreenTimeEnforcer(defaults: defaults)
        enforcer.storedKidId = "first"
        enforcer.storedPolicy = ScreenTimePolicy(version: 20, enabled: true, limits: [], downtime: [])
        enforcer.recordUsage(minutes: 15)
        XCTAssertEqual(enforcer.todayUsage()?.minutes, 15)
        XCTAssertTrue(enforcer.acceptAssignment(kidId: "second", kidName: "Second", generation: 2))
        XCTAssertNil(enforcer.storedPolicy)
        let next = ScreenTimePolicy(version: 1, enabled: true, limits: [], downtime: [])
        XCTAssertTrue(enforcer.shouldAccept(next, kidId: "second", generation: 2))
        XCTAssertFalse(enforcer.shouldAccept(next, kidId: "first", generation: 1))
        XCTAssertNil(enforcer.todayUsage())
        XCTAssertNil(enforcer.pendingAgreement)
    }
#endif
    func testLegacyPayloadsRemainUnverified() throws {
        let response = try JSONDecoder().decode(ScreenTimePolicyResponse.self, from: Data(#"{"policy":{"version":1,"enabled":false,"limits":[],"downtime":[]}}"#.utf8))
        XCTAssertNil(response.assignmentGeneration)
        XCTAssertNil(response.policy.essentialApps)
        let device = try JSONDecoder().decode(ScreenTimeDevice.self, from: Data(#"{"id":"d","label":"iPhone","mode":"cooperative","authStatus":"approved","state":"ok"}"#.utf8))
        XCTAssertNil(device.health)
        XCTAssertNil(device.assignmentGeneration)
    }

    func testAssignmentGenerationCannotMoveBackwards() {
        XCTAssertTrue(ScreenTimeSchedule.acceptsAssignment(incoming: nil, current: 1))
        XCTAssertTrue(ScreenTimeSchedule.acceptsAssignment(incoming: 2, current: 1))
        XCTAssertTrue(ScreenTimeSchedule.acceptsAssignment(incoming: 2, current: 2))
        XCTAssertFalse(ScreenTimeSchedule.acceptsAssignment(incoming: 1, current: 2))
        XCTAssertFalse(ScreenTimeSchedule.acceptsAssignment(incoming: nil, current: 2))
        XCTAssertFalse(ScreenTimeSchedule.acceptsAssignment(incoming: 0, current: 1))
        XCTAssertTrue(ScreenTimeSchedule.acceptsEnrollment(incomingGeneration: 1, currentGeneration: 3,
                                                           incomingDeviceId: "new", currentDeviceId: "old"))
        XCTAssertFalse(ScreenTimeSchedule.acceptsEnrollment(incomingGeneration: 1, currentGeneration: 3,
                                                            incomingDeviceId: "same", currentDeviceId: "same"))
    }

    func testPartialFailureAndMissingSelectionAreNotApplied() {
        XCTAssertEqual(ScreenTimeSchedule.healthState(enabled: true, failures: [], missingSelection: false, registered: 11), "applied")
        XCTAssertEqual(ScreenTimeSchedule.healthState(enabled: false, failures: [], missingSelection: true, registered: 4), "off")
        XCTAssertEqual(ScreenTimeSchedule.healthState(enabled: true, failures: [], missingSelection: true, registered: 11), "needsSelection")
        XCTAssertEqual(ScreenTimeSchedule.healthState(enabled: true, failures: ["activity_registration_failed"], missingSelection: false, registered: 10), "partial")
        XCTAssertEqual(ScreenTimeSchedule.healthState(enabled: false, failures: ["heartbeat_registration_failed"], missingSelection: false, registered: 0), "failed")
    }

    func testPendingEssentialAppsCannotDecodeAsApprovedSelection() throws {
        let apps = try JSONDecoder().decode(ScreenTimeEssentialApps.self, from: Data(#"{"selection":null,"summary":null,"pending":{"id":"p","summary":{"apps":2,"categories":0,"webDomains":0},"note":"School"}}"#.utf8))
        XCTAssertNil(apps.selection)
        XCTAssertEqual(apps.pending?.summary.apps, 2)
    }

    func testUsageDeviceUnknownAndHistoricalAllowanceRemainOptional() throws {
        let device = try JSONDecoder().decode(ScreenTimeUsageDevice.self, from: Data(#"{"deviceId":"d","label":"iPad","minutes":null,"limitReachedAt":null}"#.utf8))
        XCTAssertNil(device.minutes)
        XCTAssertNil(device.updatedAt)
        XCTAssertNil(device.limitMinutes)
        XCTAssertNil(device.remainingMinutes)
    }

    func testAssignmentDayExcludesPastActivityAndRetainsCoarseProgress() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let reset = calendar.date(from: DateComponents(year: 2026, month: 9, day: 30, hour: 12))!
        let now = reset.addingTimeInterval(45 * 60)
        let day = ScreenTimeSchedule.dayString(now, calendar: calendar)
        let fresh = ScreenTimeSchedule.registrationUsage(assignmentResetAt: reset, now: now, retained: nil, calendar: calendar)
        XCTAssertFalse(fresh.includesPastActivity)
        XCTAssertEqual(fresh.baseMinutes, 0)
        let previousChild = ScreenTimeUsageRecord(date: day, minutes: 180)
        let invalid = ScreenTimeSchedule.registrationUsage(assignmentResetAt: reset, now: now, retained: previousChild, calendar: calendar)
        XCTAssertFalse(invalid.includesPastActivity)
        XCTAssertEqual(invalid.baseMinutes, 0)
        XCTAssertFalse(ScreenTimeSchedule.isPlausibleAssignmentUsage(minutes: 180, assignmentResetAt: reset, now: now, calendar: calendar))
        let currentChild = ScreenTimeUsageRecord(date: day, minutes: 30)
        let retry = ScreenTimeSchedule.registrationUsage(assignmentResetAt: reset, now: now, retained: currentChild, calendar: calendar)
        XCTAssertFalse(retry.includesPastActivity)
        XCTAssertEqual(retry.baseMinutes, 30)
        XCTAssertEqual(ScreenTimeSchedule.countedMilestone(minutes: 15, baseMinutes: retry.baseMinutes), 45)
        XCTAssertEqual(ScreenTimeSchedule.countedMilestone(minutes: 90, baseMinutes: retry.baseMinutes), 120)
        let tomorrow = ScreenTimeSchedule.registrationUsage(assignmentResetAt: reset, now: reset.addingTimeInterval(24 * 3600), retained: currentChild, calendar: calendar)
        XCTAssertTrue(tomorrow.includesPastActivity)
        XCTAssertEqual(tomorrow.baseMinutes, 0)
        XCTAssertEqual(ScreenTimeSchedule.countedMilestone(minutes: 15, baseMinutes: tomorrow.baseMinutes), 15)
        let oldDate = ScreenTimeUsageRecord(date: "2026-09-29", minutes: 30)
        XCTAssertEqual(ScreenTimeSchedule.registrationUsage(assignmentResetAt: reset, now: now, retained: oldDate, calendar: calendar).baseMinutes, 0)
    }

    func testChangedHealthNeedsAcknowledgementEvenWithoutVersionAdvance() {
        let applied = ScreenTimeDeviceHealth(policyVersion: 4, state: "applied", registeredActivities: 11,
                                             expectedActivities: 11, hasUsageSelection: true, failures: [])
        XCTAssertFalse(ScreenTimeSchedule.needsHealthAcknowledgement(previous: applied, current: applied,
                                                                    previousVersion: 4, currentVersion: 4))
        var failed = applied
        failed.state = "partial"
        failed.registeredActivities = 10
        failed.failures = ["registration_mismatch"]
        XCTAssertTrue(ScreenTimeSchedule.needsHealthAcknowledgement(previous: applied, current: failed,
                                                                   previousVersion: 4, currentVersion: 4))
        XCTAssertTrue(ScreenTimeSchedule.needsHealthAcknowledgement(previous: applied, current: applied,
                                                                   previousVersion: 3, currentVersion: 4))
    }
}

#if SCREEN_TIME_STANDALONE
@main struct ScreenTimeCoreContractRunner {
    static func main() throws {
        let tests = ScreenTimeCoreContractTests()
        try tests.testLegacyPayloadsRemainUnverified()
        tests.testAssignmentGenerationCannotMoveBackwards()
        tests.testPartialFailureAndMissingSelectionAreNotApplied()
        try tests.testPendingEssentialAppsCannotDecodeAsApprovedSelection()
        try tests.testUsageDeviceUnknownAndHistoricalAllowanceRemainOptional()
        tests.testAssignmentDayExcludesPastActivityAndRetainsCoarseProgress()
        tests.testChangedHealthNeedsAcknowledgementEvenWithoutVersionAdvance()
        print("Screen Time core: 7 Foundation contract tests passed")
    }
}
#endif
