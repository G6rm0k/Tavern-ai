import SwiftUI

/// Provider CRUD — pulled out of the old single-screen `SettingsView` Form
/// into its own drill-down page, same as every other category here.
struct ProvidersSettingsView: View {
    @EnvironmentObject private var settings: SettingsStore
    @State private var editingProvider: Provider?
    @State private var showingAddProvider = false

    var body: some View {
        Form {
            Section {
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
            } footer: {
                Text("Активный провайдер отвечает за новые сообщения по умолчанию. Модели, отмеченные звёздочкой у любого провайдера, доступны для быстрого переключения прямо в чате.")
            }
            .listRowBackground(WesaidTheme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(WesaidTheme.background)
        .navigationTitle("Провайдеры")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
        .sheet(isPresented: $showingAddProvider) {
            AddProviderView()
        }
        .sheet(item: $editingProvider) { provider in
            AddProviderView(editing: provider, apiKey: settings.apiKey(for: provider.id))
        }
    }
}
