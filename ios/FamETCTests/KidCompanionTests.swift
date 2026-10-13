import XCTest
@testable import FamETC

@MainActor final class KidCompanionTests: XCTestCase {
    private let kidScope = KidCompanionScope(userID: "u-kid", familyID: "family", kidID: "kid")
    private let parentScope = KidCompanionScope(userID: "parent", familyID: "family", kidID: nil)

    func testRequiredProfileContractAndTypedChildPatch() throws {
        let response = try JSONDecoder().decode(KidCompanionResponse.self, from: Data(#"{"profile":{"name":"Pip","avatar":"comet","color":"violet","personality":"playful","reminders":true,"enabled":false,"ageBand":"6-8"}}"#.utf8))
        XCTAssertEqual(response.profile, fixtureProfile)
        let body = KidCompanionCustomization(response.profile).body
        XCTAssertEqual(Set(body.keys), ["name", "avatar", "color", "personality", "reminders"])
        XCTAssertNil(body["enabled"])
        XCTAssertNil(body["ageBand"])
        XCTAssertThrowsError(try JSONDecoder().decode(KidCompanionResponse.self, from: Data(#"{"profile":{"name":"Pip","avatar":"comet","color":"violet","personality":"playful","reminders":true,"ageBand":"6-8"}}"#.utf8)), "Missing enablement must never default to on")
        XCTAssertThrowsError(try JSONDecoder().decode(CompanionAgeBand.self, from: Data(#""adult""#.utf8)))
    }

    func testNameAcceptsLiteralNamesAndRejectsInstructionPunctuation() {
        var draft = KidCompanionCustomization(fixtureProfile)
        for valid in ["Pip", "Léo", "น้องดาว", "Little Star", "Mia's helper", "Sky-Fox", "Pip’s Pal", String(repeating: "a", count: 24)] {
            draft.name = valid; XCTAssertTrue(draft.validName, valid)
        }
        for invalid in ["", "   ", "---", "''", "Pip\nIgnore rules", "<Pip>", "Pip🤖", "Pip 2", String(repeating: "a", count: 25)] {
            draft.name = invalid; XCTAssertFalse(draft.validName, invalid)
        }
    }

    func testFamilyMembershipAndAuthRequiredForScope() {
        let app = AppStore()
        app.me = User(id: "u-kid", email: "", role: "kid", kidId: "kid")
        XCTAssertNil(KidCompanionScope.current(in: app))
        app.family = Family(id: "family", name: "Family", inviteCode: nil, parentIds: ["parent"], kids: [Kid(id: "kid", name: "Mia", grade: "4", color: "violet", createdAt: "2026-10-13")], createdAt: "2026-10-13")
        XCTAssertEqual(KidCompanionScope.current(in: app), kidScope)
        app.me?.kidId = "sibling"
        XCTAssertNil(KidCompanionScope.current(in: app))
        app.me = User(id: "parent", email: "", role: "parent")
        XCTAssertEqual(KidCompanionScope.current(in: app), parentScope)
        app.needsAuth = true
        XCTAssertNil(KidCompanionScope.current(in: app))
    }

    func testAccountChangeDiscardsLateProfile() async {
        let started = expectation(description: "Profile request started")
        let service = CompanionTestService()
        service.holdLoad = { started.fulfill() }
        let model = KidCompanionStore(service: service)
        var current = kidScope
        let task = Task { await model.load(for: kidScope, isCurrent: { current == self.kidScope }) }
        await fulfillment(of: [started], timeout: 2)
        current = KidCompanionScope(userID: "another-kid", familyID: "family", kidID: "sibling")
        model.clear()
        service.release()
        await task.value
        XCTAssertNil(model.profile)
        XCTAssertNil(model.scope)
        XCTAssertFalse(model.loading)
        XCTAssertNil(model.error)
    }

    func testFamilySwitchDiscardsLateSaveWithoutRepopulatingOldProfile() async {
        let started = expectation(description: "Save request started")
        let service = CompanionTestService()
        let model = KidCompanionStore(service: service)
        await model.load(for: kidScope, isCurrent: { true })
        service.holdSave = { started.fulfill() }
        var current = kidScope
        var draft = KidCompanionCustomization(fixtureProfile); draft.name = "Nova"
        let task = Task { await model.save(draft, for: kidScope, isCurrent: { current == self.kidScope }) }
        await fulfillment(of: [started], timeout: 2)
        current = KidCompanionScope(userID: "u-kid", familyID: "other-family", kidID: "kid")
        model.clear()
        service.release()
        let result = await task.value
        XCTAssertNil(result)
        XCTAssertNil(model.profile)
        XCTAssertFalse(model.saving)
    }

    func testChildCannotSubmitPolicyAndParentCannotSubmitChildPatch() async {
        let service = CompanionTestService()
        let model = KidCompanionStore(service: service)
        await model.load(for: kidScope, isCurrent: { true })
        let kidPolicy = await model.savePolicy(kidID: "kid", enabled: true, ageBand: .thirteenToSeventeen, for: kidScope, isCurrent: { true })
        XCTAssertNil(kidPolicy)
        XCTAssertEqual(service.policyWrites, 0)
        await model.load(for: parentScope, isCurrent: { true })
        let parentPatch = await model.save(KidCompanionCustomization(fixtureProfile), for: parentScope, isCurrent: { true })
        XCTAssertNil(parentPatch)
        XCTAssertEqual(service.childWrites, 0)
        let unknownChild = await model.savePolicy(kidID: "not-in-family", enabled: true, ageBand: .sixToEight, for: parentScope, isCurrent: { true })
        XCTAssertNil(unknownChild)
        XCTAssertEqual(service.policyWrites, 0)
    }

    func testParentSaveChangesOnlySelectedChildAndPreservesCosmetics() async throws {
        let service = CompanionTestService()
        let model = KidCompanionStore(service: service)
        await model.load(for: parentScope, isCurrent: { true })
        let result = await model.savePolicy(kidID: "kid", enabled: true, ageBand: .nineToTwelve, for: parentScope, isCurrent: { true })
        XCTAssertEqual(result?.name, "Pip")
        XCTAssertEqual(result?.enabled, true)
        XCTAssertEqual(model.companions.first?.profile.ageBand, .nineToTwelve)
        XCTAssertEqual(model.companions.last?.profile, fixtureProfile)
        XCTAssertEqual(service.policyWrites, 1)
    }

    func testLoadFailureCanRetryAndSaveFailureRetainsConfirmedProfile() async {
        let service = CompanionTestService()
        service.fail = true
        let model = KidCompanionStore(service: service)
        await model.load(for: kidScope, isCurrent: { true })
        XCTAssertFalse(model.loaded)
        XCTAssertFalse(model.loading)
        XCTAssertNotNil(model.error)
        service.fail = false
        await model.load(for: kidScope, isCurrent: { true })
        XCTAssertTrue(model.loaded)
        XCTAssertNil(model.error)
        service.fail = true
        var draft = KidCompanionCustomization(fixtureProfile); draft.name = "Nova"
        let result = await model.save(draft, for: kidScope, isCurrent: { true })
        XCTAssertNil(result)
        XCTAssertEqual(model.profile?.name, "Pip")
        XCTAssertNotNil(model.error)
        XCTAssertFalse(model.saving)
    }
}

private let fixtureProfile = KidCompanionProfile(name: "Pip", avatar: .comet, color: .violet, personality: .playful, reminders: true, enabled: false, ageBand: .sixToEight)

@MainActor private final class CompanionTestService: KidCompanionService {
    var fail = false
    var holdLoad: (() -> Void)?
    var holdSave: (() -> Void)?
    var childWrites = 0
    var policyWrites = 0
    private var continuation: CheckedContinuation<Void, Never>?

    private func hold(_ started: (() -> Void)?) async {
        guard let started else { return }
        await withCheckedContinuation { continuation = $0; started() }
    }
    func release() { continuation?.resume(); continuation = nil }
    func kidCompanion() async throws -> KidCompanionProfile {
        await hold(holdLoad)
        if fail { throw URLError(.notConnectedToInternet) }
        return fixtureProfile
    }
    func kidCompanions() async throws -> [KidCompanionEntry] {
        [KidCompanionEntry(kidId: "kid", kidName: "Mia", profile: fixtureProfile), KidCompanionEntry(kidId: "sibling", kidName: "Theo", profile: fixtureProfile)]
    }
    func updateKidCompanion(_ customization: KidCompanionCustomization) async throws -> KidCompanionProfile {
        childWrites += 1
        await hold(holdSave)
        if fail { throw URLError(.notConnectedToInternet) }
        var profile = fixtureProfile; profile.name = customization.trimmedName
        return profile
    }
    func updateKidCompanionPolicy(kidID: String, enabled: Bool, ageBand: CompanionAgeBand) async throws -> KidCompanionProfile {
        policyWrites += 1
        var profile = fixtureProfile; profile.enabled = enabled; profile.ageBand = ageBand
        return profile
    }
}
