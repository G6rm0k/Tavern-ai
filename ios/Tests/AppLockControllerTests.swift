import XCTest
@testable import wesaid

/// Exercises the locking *decisions* through a fake authenticator — the real
/// `LAContextAuthenticator` needs biometric hardware this project's toolchain
/// never has access to (no simulator, no device, until a sideload).
@MainActor
final class AppLockControllerTests: XCTestCase {

    private final class StubAuthenticator: BiometricAuthenticating {
        var result = true
        var callCount = 0
        func authenticate(reason: String) async -> Bool {
            callCount += 1
            return result
        }
    }

    private func makeSettingsStore(requireBiometrics: Bool) -> SettingsStore {
        let paths = AppPaths(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let store = SettingsStore(paths: paths)
        store.settings.requireBiometrics = requireBiometrics
        return store
    }

    func testStartsUnlockedWhenLockIsOff() {
        let controller = AppLockController(settingsStore: makeSettingsStore(requireBiometrics: false),
                                            authenticator: StubAuthenticator())
        XCTAssertTrue(controller.isUnlocked)
        XCTAssertFalse(controller.isLockEnabled)
    }

    func testStartsLockedWhenLockIsOn() {
        let controller = AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true),
                                            authenticator: StubAuthenticator())
        XCTAssertFalse(controller.isUnlocked)
    }

    func testLockIsANoOpWhenTheSettingIsOff() {
        let controller = AppLockController(settingsStore: makeSettingsStore(requireBiometrics: false),
                                            authenticator: StubAuthenticator())
        controller.lock()
        XCTAssertTrue(controller.isUnlocked, "must never show a lock screen nobody turned on")
    }

    func testUnlockSucceedsWhenTheAuthenticatorApproves() async {
        let auth = StubAuthenticator()
        auth.result = true
        let controller = AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true), authenticator: auth)
        await controller.unlock()
        XCTAssertTrue(controller.isUnlocked)
        XCTAssertEqual(auth.callCount, 1)
    }

    func testUnlockStaysLockedWhenTheAuthenticatorDenies() async {
        let auth = StubAuthenticator()
        auth.result = false
        let controller = AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true), authenticator: auth)
        await controller.unlock()
        XCTAssertFalse(controller.isUnlocked)
    }

    func testLockAfterUnlockRequiresAuthenticatingAgain() async {
        let auth = StubAuthenticator()
        auth.result = true
        let controller = AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true), authenticator: auth)
        await controller.unlock()
        XCTAssertTrue(controller.isUnlocked)

        controller.lock()
        XCTAssertFalse(controller.isUnlocked)
    }

    func testUnlockWhenLockIsDisabledNeverTouchesTheAuthenticator() async {
        let auth = StubAuthenticator()
        let controller = AppLockController(settingsStore: makeSettingsStore(requireBiometrics: false), authenticator: auth)
        await controller.unlock()
        XCTAssertEqual(auth.callCount, 0, "lock disabled must never prompt")
    }

    func testUnlockWhenAlreadyUnlockedDoesNotReauthenticate() async {
        let auth = StubAuthenticator()
        let controller = AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true), authenticator: auth)
        await controller.unlock()
        XCTAssertEqual(auth.callCount, 1)

        await controller.unlock()
        XCTAssertEqual(auth.callCount, 1, "already unlocked must not prompt a second time")
    }
}
