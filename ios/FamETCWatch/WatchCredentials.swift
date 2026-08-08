import Foundation
import Security

enum WatchCredentialKind: String, Codable {
    case cookieHeader
    case bearerToken
}

struct WatchCredential: Codable, Equatable {
    let kind: WatchCredentialKind
    let value: String

    init(kind: WatchCredentialKind = .cookieHeader, value: String) {
        self.kind = kind
        self.value = value
    }
}

/// The watch foundation has no login or pairing flow. It only asks this
/// abstraction for a credential that a future approved provisioning surface
/// may place in the watch keychain. Missing credentials are a normal,
/// user-visible disconnected state rather than a reason to attempt auth.
protocol WatchCredentialStore {
    func credential() throws -> WatchCredential?
    func save(_ credential: WatchCredential) throws
}

extension WatchCredentialStore {
    func save(_ credential: WatchCredential) throws {
        throw WatchCredentialError.persistenceUnavailable
    }
}

/// Read-only Keychain bridge for the standalone watch target. The value may be
/// either a JSON-encoded WatchCredential or a legacy raw cookie header. Keeping
/// the latter fallback makes the store useful to a provisioning tool without
/// coupling this target to iPhone auth or WatchConnectivity.
struct KeychainWatchCredentialStore: WatchCredentialStore {
    static let defaultService = "com.fametc.watch"
    static let defaultAccount = "session"

    let service: String
    let account: String

    init(service: String = KeychainWatchCredentialStore.defaultService,
         account: String = KeychainWatchCredentialStore.defaultAccount) {
        self.service = service
        self.account = account
    }

    func credential() throws -> WatchCredential? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw WatchCredentialError.keychainStatus(status)
        }
        guard let data = result as? Data, !data.isEmpty else {
            throw WatchCredentialError.invalidValue
        }

        if let decoded = try? JSONDecoder().decode(WatchCredential.self, from: data) {
            return decoded
        }
        guard let raw = String(data: data, encoding: .utf8), !raw.isEmpty else {
            throw WatchCredentialError.invalidValue
        }
        return WatchCredential(kind: .cookieHeader, value: raw)
    }

    func save(_ credential: WatchCredential) throws {
        guard !credential.value.isEmpty else { throw WatchCredentialError.invalidValue }
        let data = try JSONEncoder().encode(credential)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw WatchCredentialError.keychainStatus(addStatus) }
        } else if status != errSecSuccess {
            throw WatchCredentialError.keychainStatus(status)
        }
    }
}

enum WatchCredentialError: Error, LocalizedError {
    case keychainStatus(OSStatus)
    case invalidValue
    case persistenceUnavailable

    var errorDescription: String? {
        switch self {
        case .keychainStatus:
            return "The watch credential could not be read."
        case .invalidValue:
            return "The saved watch credential is invalid."
        case .persistenceUnavailable:
            return "This watch could not save the Fam ETC credential."
        }
    }
}

enum WatchConfiguration {
    static var baseURL: URL {
        if let raw = ProcessInfo.processInfo.environment["FAM_BASE_URL"],
           let url = URL(string: raw),
           isAcceptableOverride(url) {
            return url
        }
        return URL(string: "https://www.fametc.com")!
    }

    static var clientKey: String {
        let raw = Bundle.main.object(forInfoDictionaryKey: "FAMIOSClientKey") as? String
        return (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isAcceptableOverride(_ url: URL) -> Bool {
        if url.scheme == "https" { return true }
        #if DEBUG
        if url.scheme == "http", let host = url.host,
           host == "localhost" || host == "127.0.0.1" {
            return true
        }
        #endif
        return false
    }
}
