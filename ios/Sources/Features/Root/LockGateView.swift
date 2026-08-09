import SwiftUI

/// Wraps the whole app: shows a lock screen and requires Face ID (with the
/// system's own passcode fallback) whenever `requireBiometrics` is on,
/// locking again every time the app leaves the foreground. Renders straight
/// through to `content` when the setting is off — off is also the default,
/// so a fresh install is never gated by something nobody turned on.
struct LockGateView<Content: View>: View {
    @StateObject private var lock: AppLockController
    @Environment(\.scenePhase) private var scenePhase
    private let content: Content

    init(settingsStore: SettingsStore, @ViewBuilder content: () -> Content) {
        _lock = StateObject(wrappedValue: AppLockController(settingsStore: settingsStore))
        self.content = content()
    }

    var body: some View {
        ZStack {
            content
            if lock.isLockEnabled && !lock.isUnlocked {
                lockScreen
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                lock.lock()
            case .active:
                if lock.isLockEnabled && !lock.isUnlocked {
                    Task { await lock.unlock() }
                }
            default:
                break
            }
        }
        .task {
            if lock.isLockEnabled && !lock.isUnlocked {
                await lock.unlock()
            }
        }
    }

    private var lockScreen: some View {
        VStack(spacing: 20) {
            Image(systemName: "faceid")
                .font(.system(size: 56))
                .foregroundStyle(WesaidTheme.accent)
            Text("wesaid заблокирован")
                .font(.wesaidRounded(20))
                .foregroundStyle(WesaidTheme.text1)
            Button {
                Task { await lock.unlock() }
            } label: {
                Label(lock.isAuthenticating ? "Проверяю…" : "Разблокировать", systemImage: "lock.open")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .tint(WesaidTheme.accent)
            .disabled(lock.isAuthenticating)
            .padding(.horizontal, 60)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WesaidTheme.background.ignoresSafeArea())
        .transition(.opacity)
        .zIndex(1)
    }
}
