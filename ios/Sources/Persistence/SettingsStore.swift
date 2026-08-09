import Foundation
import Combine

/// Providers, model parameters, persona. Use from the main thread.
///
/// API keys are *not* part of `settings`: they are read and written through
/// `apiKey(for:)` / `setAPIKey(_:for:)`, which go to the Keychain. Keeping them
/// off the `AppSettings` value is what guarantees a key cannot end up in
/// `settings.json` or in a backup by accident.
final class SettingsStore: ObservableObject {

    @Published var settings: AppSettings {
        didSet { store.saveSoon(settings) }
    }

    private let store: JSONStore<AppSettings>
    private let keychain: KeychainService

    init(paths: AppPaths = .documents, keychain: KeychainService = .shared) {
        store = JSONStore(fileURL: paths.settingsFile, defaultValue: AppSettings())
        self.keychain = keychain
        settings = store.load()
    }

    // MARK: - Providers

    var activeProvider: Provider? {
        settings.activeProvider
    }

    func addProvider(_ provider: Provider, apiKey: String) {
        settings.providers.append(provider)
        if settings.activeProviderId == nil { settings.activeProviderId = provider.id }
        setAPIKey(apiKey, for: provider.id)
    }

    func updateProvider(_ provider: Provider, apiKey: String? = nil) {
        guard let index = settings.providers.firstIndex(where: { $0.id == provider.id }) else { return }
        settings.providers[index] = provider
        if let apiKey { setAPIKey(apiKey, for: provider.id) }
    }

    func removeProvider(id: String) {
        settings.providers.removeAll { $0.id == id }
        if settings.activeProviderId == id {
            settings.activeProviderId = settings.providers.first?.id
        }
        // The key outlives the provider otherwise: nothing would ever reference
        // that Keychain entry again, and it would sit on the device forever.
        keychain.delete(for: KeychainService.providerKeyAccount(id))
    }

    // MARK: - Secrets

    func apiKey(for providerID: String) -> String {
        keychain.string(for: KeychainService.providerKeyAccount(providerID)) ?? ""
    }

    @discardableResult
    func setAPIKey(_ key: String, for providerID: String) -> OSStatus {
        keychain.set(key, for: KeychainService.providerKeyAccount(providerID))
    }

    // MARK: - Model parameters

    func applyPreset(_ preset: ModelParams) {
        settings.modelParams = settings.modelParams.applying(preset: preset)
    }

    func flush() {
        store.flush()
    }
}
