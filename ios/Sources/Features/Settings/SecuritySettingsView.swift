import SwiftUI

struct SecuritySettingsView: View {
    @EnvironmentObject private var settings: SettingsStore

    var body: some View {
        Form {
            Section {
                Toggle("Face ID для входа", isOn: Binding(
                    get: { settings.settings.requireBiometrics },
                    set: { settings.settings.requireBiometrics = $0 }
                ))
                .tint(WesaidTheme.accent)
            } footer: {
                Text("Приложение блокируется каждый раз, когда сворачивается. Если Face ID недоступен, сработает пароль устройства.")
            }
            .listRowBackground(WesaidTheme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(WesaidTheme.background)
        .navigationTitle("Безопасность")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
    }
}
