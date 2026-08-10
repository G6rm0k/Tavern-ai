import Foundation

/// Decides when the app should be showing its lock screen. Kept separate
/// from `LAContextAuthenticator` so this — what `SettingsView`'s Face ID
/// toggle actually does to app behaviour — is testable without real
/// biometric hardware.
@MainActor
final class AppLockController: ObservableObject {
    @Published private(set) var isUnlocked: Bool
    @Published private(set) var isAuthenticating = false

    private let settingsStore: SettingsStore
    private let authenticator: BiometricAuthenticating

    init(settingsStore: SettingsStore, authenticator: BiometricAuthenticating = LAContextAuthenticator()) {
        self.settingsStore = settingsStore
        self.authenticator = authenticator
        isUnlocked = !settingsStore.settings.requireBiometrics
    }

    /// Read live off settings rather than cached, so flipping the toggle in
    /// `SettingsView` takes effect the next time the app backgrounds without
    /// this controller needing to observe changes itself.
    var isLockEnabled: Bool { settingsStore.settings.requireBiometrics }

    /// Called when the app leaves the foreground. A no-op when the setting is
    /// off, so nobody ever sees a lock screen they never asked for.
    func lock() {
        guard isLockEnabled else { return }
        isUnlocked = false
    }

    func unlock() async {
        guard isLockEnabled else { isUnlocked = true; return }
        guard !isUnlocked, !isAuthenticating else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }
        if await authenticator.authenticate(reason: "Разблокируйте wesaid") {
            isUnlocked = true
        }
    }
}
