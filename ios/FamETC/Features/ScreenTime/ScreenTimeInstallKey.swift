import Foundation
import Security

/// A random per-install id that survives an app reinstall (Keychain items outlive a
/// deleted app, unlike the App Group container), so the server can recognize "same
/// device, reinstalled" instead of creating a ghost device record. `ThisDeviceOnly` so a
/// new phone restored from a backup gets its own key rather than inheriting this one.
enum ScreenTimeInstallKey {
    private static let service = "com.fametc.app.screentime"
    private static let account = "installKey"

    /// Reads the stored key, or creates, stores and returns a new one. `nil` only if the
    /// Keychain write itself fails; enroll then just proceeds without an install key.
    static func value() -> String? {
        if let existing = read() { return existing }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        let key = encode(Data(bytes))
        return store(key) ? key : nil
    }

    /// base64url (RFC 4648 §5) without padding, e.g. 32 bytes → 43 chars of [A-Za-z0-9_-].
    /// Pure so it's unit-testable without touching the Keychain.
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let key = String(data: data, encoding: .utf8) else { return nil }
        return key
    }

    private static func store(_ key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        var attributes = query
        attributes[kSecValueData as String] = Data(key.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            return SecItemUpdate(query as CFDictionary, [kSecValueData as String: Data(key.utf8)] as CFDictionary) == errSecSuccess
        }
        return status == errSecSuccess
    }
}
