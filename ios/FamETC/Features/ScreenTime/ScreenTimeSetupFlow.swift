import Foundation

/// Required agreement and device verification are independent gates. Recovery
/// can reuse a current signed agreement, but cannot invent or skip one.
enum ScreenTimeSetupFlow {
    enum Stage: Hashable { case review, permission, signatures, verification }

    static func requiresAgreement(requested: Bool, hasCurrentSignedAgreement: Bool) -> Bool {
        requested || !hasCurrentSignedAgreement
    }

    static func currentSignedAgreement(_ agreement: ScreenTimeAgreement?, policy: ScreenTimePolicy?, hasPendingDraft: Bool) -> Bool {
        guard !hasPendingDraft, let agreement, let policy,
              ScreenTimeSchedule.date(fromISO: agreement.signedAt) != nil,
              validPromises(kid: agreement.kidPromises, parent: agreement.parentPromises),
              !agreement.kidStamp.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !agreement.parentSigner.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              agreement.parentSigner.count <= 40 else { return false }
        return !agreement.isStale(for: policy)
    }

    static func stages(requiresAgreement: Bool, needsPermission: Bool) -> [Stage] {
        var result: [Stage] = requiresAgreement ? [.review] : []
        if needsPermission { result.append(.permission) }
        if requiresAgreement { result.append(.signatures) }
        result.append(.verification)
        return result
    }

    static func validPromises(kid: [String], parent: [String]) -> Bool {
        [kid, parent].allSatisfy { values in
            (1...3).contains(values.count) && values.allSatisfy {
                let trimmed = $0.trimmingCharacters(in: .whitespacesAndNewlines)
                return !trimmed.isEmpty && trimmed.count <= 80
            }
        }
    }

    static func canEnterVerification(requiresAgreement: Bool, hasCurrentSignedAgreement: Bool,
                                     validPromises: Bool, reviewedRules: Bool,
                                     kidSigned: Bool, parentSigned: Bool) -> Bool {
        if !requiresAgreement { return hasCurrentSignedAgreement }
        return validPromises && reviewedRules && kidSigned && parentSigned
    }

    static func deviceReady(health: ScreenTimeDeviceHealth?, policy: ScreenTimePolicy?, authorized: Bool) -> Bool {
        guard authorized, let health, let policy else { return false }
        if policy.enabled && policy.limits.contains(where: \.isTotal) && !health.hasUsageSelection { return false }
        return health.policyVersion == policy.version && health.state == (policy.enabled ? "applied" : "off")
            && health.failures.isEmpty && health.registeredActivities == health.expectedActivities
    }

    static func complete(requiresAgreement: Bool, agreementSaved: Bool, hasCurrentSignedAgreement: Bool,
                         deviceReady: Bool) -> Bool {
        (requiresAgreement ? agreementSaved : hasCurrentSignedAgreement) && deviceReady
    }
}
