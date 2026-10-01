import Foundation

// Pure decisions behind the Screen Time plan's Home, setup checklist and Family screens
// (docs/SCREEN-TIME-ONLY-PLAN.md §2.1, §4). Everything here is plain Foundation so it can
// be reasoned about (and unit-tested) without views. Status is evidence-based: a step is
// done only when the server (or the child device's own health report) says so.

// MARK: - Setup checklist

/// The five rows of the parent's per-kid device checklist (§2.1), in order.
enum DeviceSetupStep: Int, CaseIterable, Identifiable {
    case getApp, typeCode, approve, deal, check

    var id: Int { rawValue }
}

/// Which checklist rows are done for one kid, derived only from server evidence:
/// `ScreenTimeKidState.setup` (code used, request waiting, kid signed in, deal signed,
/// device count) plus the device-reported protection health already used by the controls.
struct DeviceSetupProgress: Equatable {
    /// A setup code was used for this kid (§2.1 steps 1 and 2 share this evidence: the
    /// server creates the sign-in request when the code is claimed).
    var codeUsed: Bool
    /// A sign-in request is waiting for a parent's OK.
    var requestWaiting: Bool
    /// A kid user exists with a passkey or a completed no-passkey session.
    var signedIn: Bool
    /// The family deal is signed and at least one device is enrolled.
    var dealAndDevice: Bool
    /// Screen Time is on, every recent device reports the current rules applied.
    var protectionConfirmed: Bool
    /// The kid has rules saved and switched on (needed before the deal and the check).
    var rulesOn: Bool
    /// A live setup code exists on the server (shown but not yet used).
    var codeActive: Bool
    var deviceCount: Int

    init(state: ScreenTimeKidState, now: Date = Date()) {
        // Older servers send no `setup`: fall back to what the overview already proves.
        let setup = state.setup ?? ScreenTimeKidSetup(codeActive: false,
                                                      requestPending: false,
                                                      signedIn: !state.devices.isEmpty,
                                                      dealSigned: state.agreement != nil,
                                                      devices: state.devices.count)
        let deviceCount = max(setup.devices, state.devices.count)
        codeUsed = setup.requestPending || setup.signedIn || setup.dealSigned || deviceCount > 0
        requestWaiting = setup.requestPending
        signedIn = setup.signedIn || setup.dealSigned || deviceCount > 0
        dealAndDevice = setup.dealSigned && deviceCount > 0
        rulesOn = state.policy.enabled
        codeActive = setup.codeActive
        self.deviceCount = deviceCount
        let recent = ScreenTimeFormat.statusDevices(state.devices)
        protectionConfirmed = state.policy.enabled && !recent.isEmpty
            && recent.allSatisfy { ScreenTimeEssentialsPresentation.confirmed($0, policy: state.policy, now: now) }
    }

    func isDone(_ step: DeviceSetupStep) -> Bool {
        switch step {
        case .getApp, .typeCode: return codeUsed
        case .approve: return signedIn
        case .deal: return dealAndDevice
        // Protection can only be confirmed for a deal that was made on an enrolled device.
        case .check: return dealAndDevice && protectionConfirmed
        }
    }

    var doneCount: Int { DeviceSetupStep.allCases.filter(isDone).count }
    var isComplete: Bool { doneCount == DeviceSetupStep.allCases.count }

    /// The first row still to do (nil when everything is done).
    var current: DeviceSetupStep? { DeviceSetupStep.allCases.first { !isDone($0) } }

    /// Rows 1 and 2 finish together (one piece of evidence), so they open together: the
    /// parent sends the link and shows the code from the same card.
    func isExpanded(_ step: DeviceSetupStep) -> Bool {
        guard let current else { return false }
        if step == current { return true }
        return current == .getApp && step == .typeCode
    }
}

// MARK: - Setup code display

enum SetupCodeDisplay {
    /// "ABC123" -> ["A", "B", "C", "1", "2", "3"]; spaces and dashes are never part of a code.
    static func characters(_ code: String) -> [String] {
        code.filter { !$0.isWhitespace && $0 != "-" }.map { String($0).uppercased() }
    }

    /// "28:41" — never negative; an hour or more reads "1:02:03".
    static func countdown(remaining: TimeInterval) -> String {
        let total = max(0, Int(remaining.rounded(.down)))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

// MARK: - Matching a waiting sign-in request to a kid

enum KidRequestMatch {
    /// The pending sign-in request for `kid`, or nil when it can't be told apart safely.
    /// `AppStore.kidRequests` carries a display name, not a kid id, so a request is matched
    /// by name; with no name match it is used only when it is the single request and the
    /// single kid the server says is waiting. Callers must also require the server's
    /// `setup.requestPending` for this kid, so an untargeted request is never approved here.
    static func request(for kid: Kid, in requests: [KidAccessRequest], waitingKidIds: [String]) -> KidAccessRequest? {
        func normalized(_ text: String) -> String {
            text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        }
        let named = requests.filter { normalized($0.name) == normalized(kid.name) }
        if named.count == 1 { return named[0] }
        if named.isEmpty, requests.count == 1, waitingKidIds == [kid.id] { return requests[0] }
        return nil
    }
}

// MARK: - Quiet upgrade card

enum UpgradePrompt {
    /// The upgrade card stays hidden for 30 days after "Not now" (docs/SCREEN-TIME-ONLY-PLAN.md §4.1).
    static let snoozeDays: Double = 30

    static func snoozedUntil(from now: Date = Date()) -> Double {
        now.addingTimeInterval(snoozeDays * 24 * 3600).timeIntervalSince1970
    }

    static func isSnoozed(until: Double, now: Date = Date()) -> Bool {
        until > now.timeIntervalSince1970
    }
}

// MARK: - Links

enum ScreenTimePlanLinks {
    /// The public App Store listing (same link as fametc.com's landing and app-only pages).
    static let appStore = URL(string: "https://apps.apple.com/us/app/fam-etc-family-planner-chat/id6787317215")!
}
