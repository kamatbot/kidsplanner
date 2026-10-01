import XCTest
@testable import FamETC

/// The pure decisions behind the Screen Time plan's Home and setup checklist
/// (docs/SCREEN-TIME-ONLY-PLAN.md §2.1, §4.1): `DeviceSetupProgress`, `SetupCodeDisplay`,
/// `KidRequestMatch` and `UpgradePrompt` in `ScreenTimePlanLogic.swift`.
final class ScreenTimePlanLogicTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_784_000)

    private func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }

    private func policy(enabled: Bool = true) -> ScreenTimePolicy {
        ScreenTimePolicy(version: 3, enabled: enabled, limits: [], downtime: [])
    }

    /// A device whose own health report confirms policy version 3 right now.
    private func confirmedDevice(id: String = "phone") -> ScreenTimeDevice {
        ScreenTimeDevice(id: id, label: "iPhone", mode: "cooperative", authStatus: "approved", appliedVersion: 3,
                         state: "ok", health: ScreenTimeDeviceHealth(policyVersion: 3, state: "applied",
                                                                   registeredActivities: 4, expectedActivities: 4,
                                                                   hasUsageSelection: true, failures: [], checkedAt: iso(now)))
    }

    /// Enrolled but with no health report yet (a legacy / not-yet-checked device).
    private func unreportedDevice(id: String = "phone") -> ScreenTimeDevice {
        var device = confirmedDevice(id: id)
        device.health = nil
        return device
    }

    private var signedDeal: ScreenTimeAgreement {
        ScreenTimeAgreement(kidPromises: ["Ask before new apps"], parentPromises: ["Review together"], kidStamp: "🐼",
                            parentSigner: "Parent", rules: ScreenTimeAgreementRules(policy: policy()),
                            signedAt: "2026-09-30T12:00:00Z")
    }

    private func setup(codeActive: Bool = false, requestPending: Bool = false, signedIn: Bool = false,
                       dealSigned: Bool = false, devices: Int = 0) -> ScreenTimeKidSetup {
        ScreenTimeKidSetup(codeActive: codeActive, requestPending: requestPending, signedIn: signedIn,
                           dealSigned: dealSigned, devices: devices)
    }

    private func progress(setup: ScreenTimeKidSetup?, devices: [ScreenTimeDevice] = [], agreement: ScreenTimeAgreement? = nil,
                          enabled: Bool = true) -> DeviceSetupProgress {
        let state = ScreenTimeKidState(kidId: "k1", policy: policy(enabled: enabled), devices: devices, alerts: [],
                                       agreement: agreement, requests: nil, setup: setup)
        return DeviceSetupProgress(state: state, now: now)
    }

    // MARK: DeviceSetupProgress

    func testNothingDoneYet() {
        let p = progress(setup: setup())
        XCTAssertFalse(p.codeUsed)
        XCTAssertFalse(p.requestWaiting)
        XCTAssertFalse(p.signedIn)
        XCTAssertFalse(p.dealAndDevice)
        XCTAssertFalse(p.protectionConfirmed)
        XCTAssertEqual(p.doneCount, 0)
        XCTAssertFalse(p.isComplete)
        XCTAssertEqual(p.current, .getApp)
        for step in DeviceSetupStep.allCases { XCTAssertFalse(p.isDone(step)) }
    }

    func testStepsAreInTheDocumentedOrder() {
        XCTAssertEqual(DeviceSetupStep.allCases, [.getApp, .typeCode, .approve, .deal, .check])
        XCTAssertEqual(DeviceSetupStep.allCases.map(\.id), [0, 1, 2, 3, 4])
    }

    func testLiveCodeAloneIsNotEvidenceThatTheCodeWasUsed() {
        let p = progress(setup: setup(codeActive: true))
        XCTAssertTrue(p.codeActive)
        XCTAssertFalse(p.codeUsed)
        XCTAssertEqual(p.current, .getApp)
    }

    func testWaitingRequestFinishesCodeRowsAndPointsAtApprove() {
        let p = progress(setup: setup(requestPending: true))
        XCTAssertTrue(p.requestWaiting)
        XCTAssertTrue(p.codeUsed)
        XCTAssertFalse(p.signedIn)
        XCTAssertTrue(p.isDone(.getApp))
        XCTAssertTrue(p.isDone(.typeCode))
        XCTAssertFalse(p.isDone(.approve))
        XCTAssertEqual(p.current, .approve)
        XCTAssertEqual(p.doneCount, 2)
    }

    func testSignedInFinishesApproveButNotTheDeal() {
        let p = progress(setup: setup(signedIn: true))
        XCTAssertTrue(p.codeUsed)
        XCTAssertTrue(p.isDone(.approve))
        XCTAssertFalse(p.isDone(.deal))
        XCTAssertEqual(p.current, .deal)
        XCTAssertEqual(p.doneCount, 3)
    }

    func testDealWithoutAnEnrolledDeviceDoesNotFinishTheDealRow() {
        let p = progress(setup: setup(dealSigned: true, devices: 0))
        XCTAssertTrue(p.signedIn, "a signed deal proves the kid signed in")
        XCTAssertTrue(p.codeUsed)
        XCTAssertFalse(p.dealAndDevice)
        XCTAssertEqual(p.current, .deal)
    }

    func testDeviceCountTakesTheLargerOfServerSetupAndOverviewDevices() {
        XCTAssertEqual(progress(setup: setup(devices: 2), devices: [confirmedDevice()]).deviceCount, 2)
        XCTAssertEqual(progress(setup: setup(devices: 0), devices: [confirmedDevice()]).deviceCount, 1)
        XCTAssertEqual(progress(setup: setup(devices: 1), devices: []).deviceCount, 1)
    }

    func testAnEnrolledDeviceProvesCodeUseAndSignIn() {
        let p = progress(setup: setup(devices: 1))
        XCTAssertTrue(p.codeUsed)
        XCTAssertTrue(p.signedIn)
        XCTAssertFalse(p.dealAndDevice)
    }

    func testDealAndDeviceFinishesTheDealRowButProtectionNeedsTheDevicesOwnReport() {
        let p = progress(setup: setup(signedIn: true, dealSigned: true, devices: 1), devices: [unreportedDevice()],
                         agreement: signedDeal)
        XCTAssertTrue(p.dealAndDevice)
        XCTAssertTrue(p.isDone(.deal))
        XCTAssertFalse(p.protectionConfirmed)
        XCTAssertFalse(p.isDone(.check))
        XCTAssertEqual(p.current, .check)
        XCTAssertEqual(p.doneCount, 4)
        XCTAssertFalse(p.isComplete)
    }

    func testEverythingDoneWhenTheDeviceConfirmsTheRules() {
        let p = progress(setup: setup(signedIn: true, dealSigned: true, devices: 1), devices: [confirmedDevice()],
                         agreement: signedDeal)
        XCTAssertTrue(p.rulesOn)
        XCTAssertTrue(p.protectionConfirmed)
        XCTAssertEqual(p.doneCount, 5)
        XCTAssertTrue(p.isComplete)
        XCTAssertNil(p.current)
        for step in DeviceSetupStep.allCases {
            XCTAssertTrue(p.isDone(step))
            XCTAssertFalse(p.isExpanded(step), "nothing is open once setup is complete")
        }
    }

    func testRulesSwitchedOffNeverConfirmProtection() {
        let p = progress(setup: setup(signedIn: true, dealSigned: true, devices: 1), devices: [confirmedDevice()],
                         agreement: signedDeal, enabled: false)
        XCTAssertFalse(p.rulesOn)
        XCTAssertFalse(p.protectionConfirmed)
        XCTAssertFalse(p.isDone(.check))
        XCTAssertEqual(p.current, .check)
    }

    func testOneUnconfirmedDeviceBlocksProtection() {
        let p = progress(setup: setup(signedIn: true, dealSigned: true, devices: 2),
                         devices: [confirmedDevice(id: "a"), unreportedDevice(id: "b")], agreement: signedDeal)
        XCTAssertFalse(p.protectionConfirmed)
        XCTAssertFalse(p.isComplete)
    }

    func testProtectionIsNotCheckedOffWithoutADealMadeOnAnEnrolledDevice() {
        // Confirmed device and enabled rules, but the server says no deal was signed.
        let p = progress(setup: setup(signedIn: true, dealSigned: false, devices: 1), devices: [confirmedDevice()])
        XCTAssertTrue(p.protectionConfirmed)
        XCTAssertFalse(p.dealAndDevice)
        XCTAssertFalse(p.isDone(.check))
        XCTAssertEqual(p.current, .deal)
    }

    func testStaleHealthReportDoesNotConfirmProtection() {
        var device = confirmedDevice()
        device.health?.checkedAt = iso(now.addingTimeInterval(-25 * 3600))
        let p = progress(setup: setup(signedIn: true, dealSigned: true, devices: 1), devices: [device], agreement: signedDeal)
        XCTAssertFalse(p.protectionConfirmed)
    }

    // MARK: DeviceSetupProgress, older server (no `setup`)

    func testNilSetupWithNothingFallsBackToNothingDone() {
        let p = progress(setup: nil)
        XCTAssertFalse(p.codeUsed)
        XCTAssertFalse(p.requestWaiting)
        XCTAssertFalse(p.signedIn)
        XCTAssertFalse(p.dealAndDevice)
        XCTAssertFalse(p.codeActive)
        XCTAssertEqual(p.deviceCount, 0)
        XCTAssertEqual(p.current, .getApp)
    }

    func testNilSetupWithADeviceInfersSignedInFromTheDevice() {
        let p = progress(setup: nil, devices: [unreportedDevice()])
        XCTAssertEqual(p.deviceCount, 1)
        XCTAssertTrue(p.codeUsed)
        XCTAssertTrue(p.signedIn)
        XCTAssertFalse(p.requestWaiting)
        XCTAssertFalse(p.dealAndDevice, "no agreement, so the deal row stays open")
        XCTAssertEqual(p.current, .deal)
    }

    func testNilSetupWithADeviceAndAnAgreementInfersTheDeal() {
        let p = progress(setup: nil, devices: [confirmedDevice()], agreement: signedDeal)
        XCTAssertTrue(p.dealAndDevice)
        XCTAssertTrue(p.isComplete)
    }

    func testNilSetupWithAnAgreementButNoDeviceIsNotDealAndDevice() {
        let p = progress(setup: nil, agreement: signedDeal)
        XCTAssertTrue(p.signedIn)
        XCTAssertTrue(p.codeUsed)
        XCTAssertFalse(p.dealAndDevice)
        XCTAssertEqual(p.current, .deal)
    }

    // MARK: Expansion

    func testCodeRowsOpenTogetherAtTheStart() {
        let p = progress(setup: setup())
        XCTAssertTrue(p.isExpanded(.getApp))
        XCTAssertTrue(p.isExpanded(.typeCode))
        XCTAssertFalse(p.isExpanded(.approve))
        XCTAssertFalse(p.isExpanded(.deal))
        XCTAssertFalse(p.isExpanded(.check))
    }

    func testOnlyTheCurrentRowIsOpenOnceTheCodeWasUsed() {
        let waiting = progress(setup: setup(requestPending: true))
        XCTAssertEqual(DeviceSetupStep.allCases.filter(waiting.isExpanded), [.approve])
        let signedIn = progress(setup: setup(signedIn: true))
        XCTAssertEqual(DeviceSetupStep.allCases.filter(signedIn.isExpanded), [.deal])
    }

    // MARK: SetupCodeDisplay

    func testCharactersSplitsAndUppercases() {
        XCTAssertEqual(SetupCodeDisplay.characters("ABC123"), ["A", "B", "C", "1", "2", "3"])
        XCTAssertEqual(SetupCodeDisplay.characters("abc-def"), ["A", "B", "C", "D", "E", "F"])
        XCTAssertEqual(SetupCodeDisplay.characters(" a b-c "), ["A", "B", "C"])
        XCTAssertEqual(SetupCodeDisplay.characters(""), [])
        XCTAssertEqual(SetupCodeDisplay.characters(" - "), [])
    }

    func testCountdownFormatsMinutesAndSeconds() {
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 0), "0:00")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 9), "0:09")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 59), "0:59")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 60), "1:00")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 28 * 60 + 41), "28:41")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 30 * 60), "30:00")
    }

    func testCountdownRoundsDownAndNeverGoesNegative() {
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 59.9), "0:59")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 0.4), "0:00")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: -1), "0:00")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: -3600), "0:00")
    }

    func testCountdownShowsHoursWhenAnHourOrMore() {
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 3599), "59:59")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 3600), "1:00:00")
        XCTAssertEqual(SetupCodeDisplay.countdown(remaining: 3723), "1:02:03")
    }

    // MARK: KidRequestMatch

    private func kid(_ id: String, _ name: String) -> Kid {
        Kid(id: id, name: name, grade: "", color: "", createdAt: "2026-01-01T00:00:00.000Z")
    }

    private func request(_ id: String, name: String, kidId: String? = nil) -> KidAccessRequest {
        KidAccessRequest(id: id, name: name, deviceLabel: "iPad", createdAt: "2026-10-01T09:00:00.000Z", kidId: kidId)
    }

    func testKidIdMatchesFirstEvenWhenTheTypedNameDiffers() {
        let requests = [request("r1", name: "Zed", kidId: "k1"), request("r2", name: "Maya", kidId: "k2")]
        XCTAssertEqual(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: [])?.id, "r1")
        XCTAssertEqual(KidRequestMatch.request(for: kid("k2", "Zed"), in: requests, waitingKidIds: [])?.id, "r2")
    }

    func testKidIdBeatsANameMatchOnAnotherRequest() {
        let requests = [request("byName", name: "Maya"), request("byId", name: "Someone else", kidId: "k1")]
        XCTAssertEqual(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: ["k1"])?.id, "byId")
    }

    func testSeveralRequestsForTheSameKidOfferTheOldest() {
        let requests = [request("old", name: "Maya", kidId: "k1"), request("new", name: "Maya", kidId: "k1")]
        XCTAssertEqual(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: ["k1"])?.id, "old")
    }

    func testARequestTargetedAtAnotherKidIsNeverMatchedByName() {
        let other = [request("r1", name: "Maya", kidId: "k2")]
        XCTAssertNil(KidRequestMatch.request(for: kid("k1", "Maya"), in: other, waitingKidIds: ["k1"]))
        let renamed = [request("r1", name: "Zed", kidId: "k2")]
        XCTAssertNil(KidRequestMatch.request(for: kid("k1", "Maya"), in: renamed, waitingKidIds: ["k1"]))
    }

    func testOldServerFallsBackToCaseAndWhitespaceInsensitiveNameMatch() {
        let requests = [request("r1", name: "  maYa "), request("r2", name: "Ben")]
        XCTAssertEqual(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: [])?.id, "r1")
    }

    func testTwoNameMatchesAreAmbiguous() {
        let requests = [request("r1", name: "Maya"), request("r2", name: "maya")]
        XCTAssertNil(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: ["k1"]))
    }

    func testSingleUnnamedRequestMatchesOnlyForTheOneWaitingKid() {
        let requests = [request("r1", name: "Tablet")]
        XCTAssertEqual(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: ["k1"])?.id, "r1")
        XCTAssertNil(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: []))
        XCTAssertNil(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: ["k2"]))
        XCTAssertNil(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: ["k1", "k2"]))
    }

    func testSeveralUnnamedRequestsNeverMatch() {
        let requests = [request("r1", name: "Tablet"), request("r2", name: "Phone")]
        XCTAssertNil(KidRequestMatch.request(for: kid("k1", "Maya"), in: requests, waitingKidIds: ["k1"]))
    }

    func testNoRequestsMatchesNothing() {
        XCTAssertNil(KidRequestMatch.request(for: kid("k1", "Maya"), in: [], waitingKidIds: ["k1"]))
    }

    func testAccessRequestDecodesKidIdWhenPresentAndToleratesItsAbsence() throws {
        let decoder = JSONDecoder()
        let targeted = try decoder.decode(KidAccessRequest.self, from: Data(
            #"{"id":"r1","name":"Maya","deviceLabel":"iPad","createdAt":"2026-10-01T09:00:00.000Z","kidId":"k1"}"#.utf8))
        XCTAssertEqual(targeted.kidId, "k1")
        let untargeted = try decoder.decode(KidAccessRequest.self, from: Data(
            #"{"id":"r2","name":"Maya","deviceLabel":"iPad","createdAt":"2026-10-01T09:00:00.000Z","kidId":null}"#.utf8))
        XCTAssertNil(untargeted.kidId)
        let oldServer = try decoder.decode(KidAccessRequest.self, from: Data(
            #"{"id":"r3","name":"Maya","createdAt":"2026-10-01T09:00:00.000Z"}"#.utf8))
        XCTAssertNil(oldServer.kidId)
        XCTAssertNil(oldServer.deviceLabel)
    }

    // MARK: UpgradePrompt

    func testSnoozeIsThirtyDays() {
        XCTAssertEqual(UpgradePrompt.snoozeDays, 30)
        XCTAssertEqual(UpgradePrompt.snoozedUntil(from: now), now.addingTimeInterval(30 * 24 * 3600).timeIntervalSince1970)
    }

    func testSnoozedUntilIsHiddenUntilThatMoment() {
        let until = UpgradePrompt.snoozedUntil(from: now)
        XCTAssertTrue(UpgradePrompt.isSnoozed(until: until, now: now))
        XCTAssertTrue(UpgradePrompt.isSnoozed(until: until, now: now.addingTimeInterval(29 * 24 * 3600)))
        XCTAssertFalse(UpgradePrompt.isSnoozed(until: until, now: Date(timeIntervalSince1970: until)))
        XCTAssertFalse(UpgradePrompt.isSnoozed(until: until, now: now.addingTimeInterval(31 * 24 * 3600)))
    }

    func testNeverSnoozedShowsThePrompt() {
        XCTAssertFalse(UpgradePrompt.isSnoozed(until: 0, now: now))
    }
}
