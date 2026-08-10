import SwiftUI

/// Every optional behavior in one place, each with its own detailed
/// settings rather than a bare on/off switch buried in a long flat form.
/// The rule for all of them is the same: left untouched, a feature runs on
/// its normal/default values; touch a setting and it runs on exactly what
/// you set, until you change it again.
struct FunctionsSettingsView: View {
    @EnvironmentObject private var settings: SettingsStore

    var body: some View {
        Form {
            memorySection
            thinkingSection
            translationSection
        }
        .scrollContentBackground(.hidden)
        .background(WesaidTheme.background)
        .navigationTitle("Функции")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
    }

    private var memorySection: some View {
        Section {
            Toggle("Память длинных чатов", isOn: Binding(
                get: { settings.settings.preferences.memoryEnabled },
                set: { settings.settings.preferences.memoryEnabled = $0 }
            ))
            .tint(WesaidTheme.accent)
        } header: {
            Text("Память")
        } footer: {
            Text("Выключено по умолчанию. Включённая — кратко пересказывает старые сообщения, когда разговор перерастает окно контекста (настраивается в разделе «Модель» — «Память»), чтобы персонаж не забывал начало беседы.")
        }
        .listRowBackground(WesaidTheme.surface)
    }

    private var thinkingSection: some View {
        Section {
            Toggle("Размышлять перед ответом по умолчанию", isOn: Binding(
                get: { settings.settings.preferences.forceThinkingByDefault },
                set: { settings.settings.preferences.forceThinkingByDefault = $0 }
            ))
            .tint(WesaidTheme.accent)
        } header: {
            Text("Размышление")
        } footer: {
            Text("Выключено по умолчанию. Модель сначала подробно рассуждает, потом отвечает — работает с любым провайдером через обычный промт, не через специальный режим конкретной модели. Независимо от этой настройки каждый чат (и AI-помощник создания персонажа) можно переключить отдельно значком мозга у поля ввода.")
        }
        .listRowBackground(WesaidTheme.surface)
    }

    private var translationSection: some View {
        Section {
            Toggle("Автоперевод импорта с Chub.ai", isOn: Binding(
                get: { settings.settings.preferences.autoTranslateEnabled },
                set: { settings.settings.preferences.autoTranslateEnabled = $0 }
            ))
            .tint(WesaidTheme.accent)

            Picker("Язык", selection: Binding(
                get: { settings.settings.preferences.translateLanguage },
                set: { settings.settings.preferences.translateLanguage = $0 }
            )) {
                Text("🇷🇺 Русский").tag("ru")
                Text("🇬🇧 English").tag("en")
            }
            .pickerStyle(.segmented)
            .disabled(!settings.settings.preferences.autoTranslateEnabled)
        } header: {
            Text("Перевод импортированных персонажей")
        } footer: {
            Text("Включено по умолчанию, язык — русский. Приветствия и описание персонажа с Chub.ai автоматически переводятся на выбранный язык, если ещё не на нём написаны.")
        }
        .listRowBackground(WesaidTheme.surface)
    }
}
