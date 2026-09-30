#if SCREEN_TIME_SETUP_STANDALONE
import Foundation
class XCTestCase {}
private func XCTAssertTrue(_ value: Bool) { precondition(value) }
private func XCTAssertFalse(_ value: Bool) { precondition(!value) }
private func XCTAssertEqual<T: Equatable>(_ actual: T, _ expected: T) { precondition(actual == expected) }
#else
import XCTest
@testable import FamETC
#endif

final class ScreenTimeSetupFlowTests: XCTestCase {
    private var policy: ScreenTimePolicy { ScreenTimePolicy(version: 5, enabled: true, limits: [], downtime: []) }
    private var agreement: ScreenTimeAgreement {
        ScreenTimeAgreement(kidPromises: ["Ask before new apps"], parentPromises: ["Review together"], kidStamp: "🐼",
                            parentSigner: "Parent", rules: ScreenTimeAgreementRules(policy: policy), signedAt: "2026-09-30T12:00:00Z")
    }

    func testNormalFlowCombinesReviewButRetainsPermissionsAndBothSignatures() {
        XCTAssertEqual(ScreenTimeSetupFlow.stages(requiresAgreement: true, needsPermission: true),
                       [.review, .permission, .signatures, .verification])
        XCTAssertEqual(ScreenTimeSetupFlow.stages(requiresAgreement: true, needsPermission: false),
                       [.review, .signatures, .verification])
    }

    func testRecoveryCannotBypassMissingOrUnsavedAgreement() {
        let valid = ScreenTimeSetupFlow.currentSignedAgreement(agreement, policy: policy, hasPendingDraft: false)
        XCTAssertTrue(valid)
        XCTAssertFalse(ScreenTimeSetupFlow.requiresAgreement(requested: false, hasCurrentSignedAgreement: valid))
        XCTAssertTrue(ScreenTimeSetupFlow.requiresAgreement(requested: true, hasCurrentSignedAgreement: valid))
        for invalid in [nil, agreementWithoutSignature(), agreementWithoutParentPromise()] {
            let saved = ScreenTimeSetupFlow.currentSignedAgreement(invalid, policy: policy, hasPendingDraft: false)
            XCTAssertFalse(saved)
            let required = ScreenTimeSetupFlow.requiresAgreement(requested: false, hasCurrentSignedAgreement: saved)
            XCTAssertTrue(required)
            XCTAssertEqual(ScreenTimeSetupFlow.stages(requiresAgreement: required, needsPermission: false), [.review, .signatures, .verification])
        }
        XCTAssertFalse(ScreenTimeSetupFlow.currentSignedAgreement(agreement, policy: policy, hasPendingDraft: true))
        var changed = policy
        changed.limits = [ScreenTimeLimit(id: "total", name: "Daily", minutesPerDay: 60)]
        XCTAssertFalse(ScreenTimeSetupFlow.currentSignedAgreement(agreement, policy: changed, hasPendingDraft: false))
    }

    private func agreementWithoutSignature() -> ScreenTimeAgreement { var value = agreement; value.signedAt = nil; return value }
    private func agreementWithoutParentPromise() -> ScreenTimeAgreement { var value = agreement; value.parentPromises = []; return value }

    func testBothPromisesRulesReviewAndSignaturesAreRequired() {
        XCTAssertFalse(ScreenTimeSetupFlow.validPromises(kid: [], parent: ["Review together"]))
        XCTAssertFalse(ScreenTimeSetupFlow.validPromises(kid: ["Ask"], parent: []))
        XCTAssertFalse(ScreenTimeSetupFlow.validPromises(kid: [" "], parent: ["Review"]))
        XCTAssertFalse(ScreenTimeSetupFlow.validPromises(kid: Array(repeating: "Promise", count: 4), parent: ["Review"]))
        for validPromises in [false, true] {
            for reviewed in [false, true] {
                for child in [false, true] {
                    for parent in [false, true] {
                        XCTAssertEqual(ScreenTimeSetupFlow.canEnterVerification(requiresAgreement: true, hasCurrentSignedAgreement: false,
                                                                               validPromises: validPromises, reviewedRules: reviewed,
                                                                               kidSigned: child, parentSigned: parent),
                                       validPromises && reviewed && child && parent)
                    }
                }
            }
        }
        XCTAssertFalse(ScreenTimeSetupFlow.canEnterVerification(requiresAgreement: false, hasCurrentSignedAgreement: false,
                                                               validPromises: true, reviewedRules: true, kidSigned: true, parentSigned: true))
    }

    func testReadyRequiresSuccessfulHealthForExactCurrentPolicy() {
        var health = ScreenTimeDeviceHealth(policyVersion: 5, state: "applied", registeredActivities: 4,
                                            expectedActivities: 4, hasUsageSelection: true, failures: [])
        XCTAssertTrue(ScreenTimeSetupFlow.deviceReady(health: health, policy: policy, authorized: true))
        XCTAssertFalse(ScreenTimeSetupFlow.deviceReady(health: nil, policy: policy, authorized: true))
        XCTAssertFalse(ScreenTimeSetupFlow.deviceReady(health: health, policy: policy, authorized: false))
        health.policyVersion = 4
        XCTAssertFalse(ScreenTimeSetupFlow.deviceReady(health: health, policy: policy, authorized: true))
        health.policyVersion = 6
        XCTAssertFalse(ScreenTimeSetupFlow.deviceReady(health: health, policy: policy, authorized: true))
        health.policyVersion = 5; health.registeredActivities = 3
        XCTAssertFalse(ScreenTimeSetupFlow.deviceReady(health: health, policy: policy, authorized: true))
        health.registeredActivities = 4; health.failures = ["registration_failed"]
        XCTAssertFalse(ScreenTimeSetupFlow.deviceReady(health: health, policy: policy, authorized: true))
        health.failures = []; health.state = "partial"
        XCTAssertFalse(ScreenTimeSetupFlow.deviceReady(health: health, policy: policy, authorized: true))
        health.state = "applied"; health.hasUsageSelection = false
        var dailyPolicy = policy
        dailyPolicy.limits = [ScreenTimeLimit(id: "total", name: "Daily", minutesPerDay: 60)]
        XCTAssertFalse(ScreenTimeSetupFlow.deviceReady(health: health, policy: dailyPolicy, authorized: true))
        var downtimePolicy = policy
        downtimePolicy.downtime = [ScreenTimeDowntime(id: "bedtime", name: "Bedtime", start: "21:00", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7])]
        XCTAssertTrue(ScreenTimeSetupFlow.deviceReady(health: health, policy: downtimePolicy, authorized: true))
    }

    func testCompleteRequiresSavedAgreementEvenOnAlreadyProtectedDevice() {
        XCTAssertFalse(ScreenTimeSetupFlow.complete(requiresAgreement: true, agreementSaved: false, hasCurrentSignedAgreement: false, deviceReady: true))
        XCTAssertFalse(ScreenTimeSetupFlow.complete(requiresAgreement: false, agreementSaved: false, hasCurrentSignedAgreement: false, deviceReady: true))
        XCTAssertFalse(ScreenTimeSetupFlow.complete(requiresAgreement: true, agreementSaved: true, hasCurrentSignedAgreement: true, deviceReady: false))
        XCTAssertTrue(ScreenTimeSetupFlow.complete(requiresAgreement: true, agreementSaved: true, hasCurrentSignedAgreement: true, deviceReady: true))
        XCTAssertTrue(ScreenTimeSetupFlow.complete(requiresAgreement: false, agreementSaved: false, hasCurrentSignedAgreement: true, deviceReady: true))
    }
}

#if SCREEN_TIME_SETUP_STANDALONE
@main struct ScreenTimeSetupFlowRunner {
    static func main() {
        let tests = ScreenTimeSetupFlowTests()
        tests.testNormalFlowCombinesReviewButRetainsPermissionsAndBothSignatures()
        tests.testRecoveryCannotBypassMissingOrUnsavedAgreement()
        tests.testBothPromisesRulesReviewAndSignaturesAreRequired()
        tests.testReadyRequiresSuccessfulHealthForExactCurrentPolicy()
        tests.testCompleteRequiresSavedAgreementEvenOnAlreadyProtectedDevice()
        print("Screen Time setup flow: 5 focused Foundation regression tests passed")
    }
}
#endif
