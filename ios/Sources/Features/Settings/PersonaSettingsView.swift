import SwiftUI

struct PersonaSettingsView: View {
    @EnvironmentObject private var settings: SettingsStore

    var body: some View {
        Form {
            // "Подставляется вместо {{user}} и помогает персонажу говорить с
            // тобой, а не с пустотой." — persona.hint in i18n.js.
            Section {
                TextField("Имя", text: Binding(
                    get: { settings.settings.persona.name },
                    set: { settings.settings.persona.name = $0 }
                ))
                TextField("Пара слов о себе", text: Binding(
                    get: { settings.settings.persona.description },
                    set: { settings.settings.persona.description = $0 }
                ), axis: .vertical)
                .lineLimit(2...4)
            } header: {
                Text("Кто ты в чатах")
            } footer: {
                Text("Подставляется вместо {{user}} и помогает персонажу говорить с тобой, а не с пустотой.")
            }
            .listRowBackground(WesaidTheme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(WesaidTheme.background)
        .navigationTitle("Кто ты")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
    }
}
