import Foundation
import Security

/// Secrets store. API keys live here and only here — never in `settings.json`,
/// never in a backup export.
///
/// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` is the strictest option that
/// still works for a foreground app: the key is unreadable while the phone is
/// locked, and it is excluded from iCloud Keychain and from encrypted device
/// backups, so restoring this app onto another phone cannot carry the key over.
struct KeychainService {

    static let shared = KeychainService(service: "app.wesaid.secrets")

    let service: String

    init(service: String) {
        self.service = service
    }

    /// The Keychain account name holding a given provider's API key.
    static func providerKeyAccount(_ providerID: String) -> String {
        "provider.apiKey." + providerID
    }

    func string(for account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Stores `value`, or removes the entry when it is `nil`/empty. Returns the
    /// raw `OSStatus` rather than throwing so callers (and tests on a runner
    /// without Keychain entitlements) can react to a specific failure.
    @discardableResult
    func set(_ value: String?, for account: String) -> OSStatus {
        guard let value, !value.isEmpty else { return delete(for: account) }

        let data = Data(value.utf8)
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        if SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess {
            let attributes: [String: Any] = [kSecValueData as String: data]
            return SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        }

        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(query as CFDictionary, nil)
    }

    @discardableResult
    func delete(for account: String) -> OSStatus {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        // Deleting something that was never there is the outcome the caller
        // wanted, not an error.
        return status == errSecItemNotFound ? errSecSuccess : status
    }
}
