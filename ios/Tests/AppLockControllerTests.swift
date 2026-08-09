import XCTest
@testable import wesaid

/// Exercises the locking *decisions* through a fake authenticator — the real
/// `LAContextAuthenticator` needs biometric hardware this project's toolchain
/// never has access to (no simulator, no device, until a sideload).
///
/// Every test here is `async`, even the ones with no real suspension point,
/// and the class itself is deliberately *not* `@MainActor` — `AppLockController`
/// is `@MainActor`-isolated, so touching it needs `await` regardless. Mixing
/// synchronous and asynchronous test methods inside one `@MainActor`-annotated
/// `XCTestCase` crashed the test host outright on CI (`Test crashed with
/// signal trap`, reproducing at the exact same sync-test-after-async-test
/// boundary on every run) — XCTest's synchronous-test invocation path doesn't
/// hop actors the way its `async` test path does. Keeping every method on the
/// same (async) invocation path sidesteps that instability entirely.
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
        // A dedicated Keychain service, not `.shared`: the test host is the
        // real `wesaidApp`, which is itself constructing an `AppStores()`
        // against the real `KeychainService.shared` at the same moment this
        // suite starts touching it — no reason to contend over the same
        // Keychain identifier when the tests here never assert on stored keys.
        let keychain = KeychainService(service: "app.wesaid.tests.\(UUID().uuidString)")
        let store = SettingsStore(paths: paths, keychain: keychain)
        store.settings.requireBiometrics = requireBiometrics
        return store
    }

    func testStartsUnlockedWhenLockIsOff() async {
        let controller = await AppLockController(settingsStore: makeSettingsStore(requireBiometrics: false),
                                                   authenticator: StubAuthenticator())
        let isUnlocked = await controller.isUnlocked
        let isLockEnabled = await controller.isLockEnabled
        XCTAssertTrue(isUnlocked)
        XCTAssertFalse(isLockEnabled)
    }

    func testStartsLockedWhenLockIsOn() async {
        let controller = await AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true),
                                                   authenticator: StubAuthenticator())
        let isUnlocked = await controller.isUnlocked
        XCTAssertFalse(isUnlocked)
    }

    func testLockIsANoOpWhenTheSettingIsOff() async {
        let controller = await AppLockController(settingsStore: makeSettingsStore(requireBiometrics: false),
                                                   authenticator: StubAuthenticator())
        await controller.lock()
        let isUnlocked = await controller.isUnlocked
        XCTAssertTrue(isUnlocked, "must never show a lock screen nobody turned on")
    }

    func testUnlockSucceedsWhenTheAuthenticatorApproves() async {
        let auth = StubAuthenticator()
        auth.result = true
        let controller = await AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true), authenticator: auth)
        await controller.unlock()
        let isUnlocked = await controller.isUnlocked
        XCTAssertTrue(isUnlocked)
        XCTAssertEqual(auth.callCount, 1)
    }

    func testUnlockStaysLockedWhenTheAuthenticatorDenies() async {
        let auth = StubAuthenticator()
        auth.result = false
        let controller = await AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true), authenticator: auth)
        await controller.unlock()
        let isUnlocked = await controller.isUnlocked
        XCTAssertFalse(isUnlocked)
    }

    func testLockAfterUnlockRequiresAuthenticatingAgain() async {
        let auth = StubAuthenticator()
        auth.result = true
        let controller = await AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true), authenticator: auth)
        await controller.unlock()
        let isUnlockedAfterUnlock = await controller.isUnlocked
        XCTAssertTrue(isUnlockedAfterUnlock)

        await controller.lock()
        let isUnlockedAfterLock = await controller.isUnlocked
        XCTAssertFalse(isUnlockedAfterLock)
    }

    func testUnlockWhenLockIsDisabledNeverTouchesTheAuthenticator() async {
        let auth = StubAuthenticator()
        let controller = await AppLockController(settingsStore: makeSettingsStore(requireBiometrics: false), authenticator: auth)
        await controller.unlock()
        XCTAssertEqual(auth.callCount, 0, "lock disabled must never prompt")
    }

    func testUnlockWhenAlreadyUnlockedDoesNotReauthenticate() async {
        let auth = StubAuthenticator()
        let controller = await AppLockController(settingsStore: makeSettingsStore(requireBiometrics: true), authenticator: auth)
        await controller.unlock()
        XCTAssertEqual(auth.callCount, 1)

        await controller.unlock()
        XCTAssertEqual(auth.callCount, 1, "already unlocked must not prompt a second time")
    }
}
