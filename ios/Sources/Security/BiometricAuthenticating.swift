import LocalAuthentication

/// Abstracts `LAContext` so `AppLockController`'s locking decisions are
/// unit-testable without real biometric hardware — there is no simulator in
/// this project's toolchain to exercise the real thing before a sideload, so
/// this branch has to be written correctly the first time and covered by a
/// test double instead.
protocol BiometricAuthenticating {
    func authenticate(reason: String) async -> Bool
}

/// `.deviceOwnerAuthentication` rather than `...WithBiometrics`: a failed or
/// unenrolled Face ID falls back to the device passcode automatically,
/// instead of locking the user out of their own local data over a Face ID
/// hiccup.
final class LAContextAuthenticator: BiometricAuthenticating {
    func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // No biometrics and no passcode configured on the device at all —
            // there is nothing to gate with, so let the user through rather
            // than permanently locking them out of their own data.
            return true
        }
        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
                continuation.resume(returning: success)
            }
        }
    }
}
