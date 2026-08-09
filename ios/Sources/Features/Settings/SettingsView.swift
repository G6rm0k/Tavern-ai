import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var settings: SettingsStore
    @State private var editingProvider: Provider?
    @State private var showingAddProvider = false

    var body: some View {
        Form {
            providersSection
            modelParamsSection
            personaSection
            memorySection
        }
        .scrollContentBackground(.hidden)
        .background(WesaidTheme.background)
        .navigationTitle("Настройки")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
        .sheet(isPresented: $showingAddProvider) {
            AddProviderView()
        }
        .sheet(item: $editingProvider) { provider in
            AddProviderView(editing: provider, apiKey: settings.apiKey(for: provider.id))
        }
    }

    private var providersSection: some View {
        Section("Провайдеры") {
            ForEach(settings.settings.providers) { provider in
                Button {
                    editingProvider = provider
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(provider.name).foregroundStyle(WesaidTheme.text1)
                            Text(provider.baseUrl)
                                .font(.caption)
                                .foregroundStyle(WesaidTheme.text3)
                                .lineLimit(1)
                        }
                        Spacer()
                        if provider.id == settings.settings.activeProviderId {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(WesaidTheme.accent)
                        }
                    }
                }
                .swipeActions {
                    Button("Удалить", role: .destructive) {
                        settings.removeProvider(id: provider.id)
                    }
                    Button("Сделать активным") {
                        settings.settings.activeProviderId = provider.id
                    }
                    .tint(WesaidTheme.accent)
                }
            }
            Button {
                showingAddProvider = true
            } label: {
                Label("Добавить провайдера", systemImage: "plus.circle")
            }
        }
        .listRowBackground(WesaidTheme.surface)
    }

    private var modelParamsSection: some View {
        Section("Параметры модели") {
            HStack(spacing: 8) {
                presetButton("Творческий", preset: .creative)
                presetButton("Баланс", preset: .balanced)
                presetButton("Точный", preset: .precise)
            }
        }
        .listRowBackground(WesaidTheme.surface)
    }

    private func presetButton(_ title: String, preset: ModelParams) -> some View {
        Button {
            settings.applyPreset(preset)
        } label: {
            Text(title)
                .font(.subheadline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
        .buttonStyle(.bordered)
        .tint(WesaidTheme.accent)
    }

    private var personaSection: some View {
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

    private var memorySection: some View {
        Section {
            Toggle("Память длинных чатов", isOn: Binding(
                get: { settings.settings.preferences.memoryEnabled },
                set: { settings.settings.preferences.memoryEnabled = $0 }
            ))
            .tint(WesaidTheme.accent)
        } footer: {
            Text("Кратко пересказывать старые сообщения, чтобы персонаж их не забывал")
        }
        .listRowBackground(WesaidTheme.surface)
    }
}
