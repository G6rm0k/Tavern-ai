import Foundation
import Security
@testable import wesaid

/// Plain in-memory `KeychainServicing` for tests — no `Security.framework`
/// call, so nothing here can hit the real Keychain flakiness that was
/// causing `CharacterWizardControllerTests` to intermittently see a just-
/// written provider API key read back as missing (see the comment on
/// `KeychainServicing`). Tests only ever need round-trip storage, never the
/// real thing.
final class InMemoryKeychain: KeychainServicing {
    private var storage: [String: String] = [:]

    func string(for account: String) -> String? {
        storage[account]
    }

    @discardableResult
    func set(_ value: String?, for account: String) -> OSStatus {
        guard let value, !value.isEmpty else { return delete(for: account) }
        storage[account] = value
        return errSecSuccess
    }

    @discardableResult
    func delete(for account: String) -> OSStatus {
        storage.removeValue(forKey: account)
        return errSecSuccess
    }
}
