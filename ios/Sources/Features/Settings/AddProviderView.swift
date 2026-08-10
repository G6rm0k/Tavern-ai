import SwiftUI

/// Add (or edit) one provider: pick a preset to prefill the address, paste a
/// key, optionally confirm it actually works before saving.
struct AddProviderView: View {
    @EnvironmentObject private var settings: SettingsStore
    @Environment(\.dismiss) private var dismiss

    /// `nil` when adding a new provider; set when editing an existing one.
    private let editingID: String?
    /// The id this provider will be saved under either way — generated up
    /// front (not just at `save()`) so starring a model before the very
    /// first save still has a stable provider id to attach the favorite to.
    private let providerID: String

    @State private var name: String
    @State private var baseUrl: String
    @State private var model: String
    @State private var apiKey: String
    @State private var selectedPresetID: String?
    @State private var favoriteModels: Set<String>
    @State private var availableModels: [String]
    @State private var isScanningModels = false
    @State private var modelScanErrorMessage: String?

    private enum TestState: Equatable {
        case idle, testing, success, failure(String)
    }
    @State private var testState: TestState = .idle

    init(editing provider: Provider? = nil, apiKey existingKey: String = "") {
        editingID = provider?.id
        providerID = provider?.id ?? UUID().uuidString
        _name = State(initialValue: provider?.name ?? "")
        _baseUrl = State(initialValue: provider?.baseUrl ?? "")
        _model = State(initialValue: provider?.model ?? "")
        _apiKey = State(initialValue: existingKey)
        _selectedPresetID = State(initialValue: nil)
        _favoriteModels = State(initialValue: [])
        _availableModels = State(initialValue: [])
    }

    /// Deferred out of `init` (which has no access to `settings` — it's an
    /// `@EnvironmentObject`, only populated once the view is actually in the
    /// hierarchy) and run once from `.task` instead.
    private func loadFavorites() {
        let existing = settings.favoriteModels(for: providerID)
        favoriteModels = existing
        availableModels = existing.sorted()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Провайдер") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(ProviderPreset.all) { preset in
                                presetChip(preset)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .listRowInsets(EdgeInsets())
                    .padding(.horizontal)
                    .background(WesaidTheme.surface)
                }

                Section("Подключение") {
                    TextField("Название", text: $name)
                    TextField("Base URL", text: $baseUrl)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    TextField("Модель", text: $model)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("API-ключ", text: $apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .listRowBackground(WesaidTheme.surface)

                favoriteModelsSection

                Section {
                    Button {
                        Task { await testConnection() }
                    } label: {
                        HStack {
                            if testState == .testing { ProgressView().tint(WesaidTheme.accent) }
                            Text("Проверить подключение")
                        }
                    }
                    .disabled(baseUrl.trimmingCharacters(in: .whitespaces).isEmpty || testState == .testing)

                    switch testState {
                    case .success:
                        Label("Работает", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    case .failure(let message):
                        Label(message, systemImage: "xmark.circle.fill").foregroundStyle(.red)
                    case .idle, .testing:
                        EmptyView()
                    }
                }
                .listRowBackground(WesaidTheme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(WesaidTheme.background)
            .task { loadFavorites() }
            .navigationTitle(editingID == nil ? "Новый провайдер" : "Провайдер")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { save() }
                        .disabled(baseUrl.trimmingCharacters(in: .whitespaces).isEmpty || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .tint(WesaidTheme.accent)
    }

    private func presetChip(_ preset: ProviderPreset) -> some View {
        Button {
            selectedPresetID = preset.id
            name = preset.name
            baseUrl = preset.baseUrl
            model = preset.models.first ?? model
            testState = .idle
        } label: {
            VStack(spacing: 4) {
                Text(preset.icon).font(.title2)
                Text(preset.name).font(.caption2).lineLimit(1)
            }
            .padding(10)
            .frame(width: 76)
            .background(selectedPresetID == preset.id ? WesaidTheme.accent.opacity(0.25) : WesaidTheme.surface2,
                        in: RoundedRectangle(cornerRadius: WesaidTheme.radiusSM))
            .foregroundStyle(WesaidTheme.text1)
        }
        .buttonStyle(.plain)
    }

    /// Same probe the server used to run: a throwaway one-token completion,
    /// not a real message — just enough to confirm the key and address work.
    private func testConnection() async {
        testState = .testing
        let service = ChatCompletionService()
        let request = ChatCompletionRequest(
            messages: [UpstreamMessage(role: .user, content: "Hi")],
            model: model.isEmpty ? nil : model,
            systemPrompt: "", temperature: 0, maxTokens: 8, topP: 1
        )
        do {
            _ = try await service.complete(request: request, baseURL: baseUrl, apiKey: apiKey)
            testState = .success
        } catch {
            testState = .failure(describeTestFailure(error))
        }
    }

    private func describeTestFailure(_ error: Error) -> String {
        switch error {
        case ChatServiceError.badURL: return "Некорректный адрес"
        case ChatServiceError.noKey: return "Не указан API-ключ"
        case ChatServiceError.httpError(let status, _): return "Ошибка \(status)"
        case ChatServiceError.connectionRefused: return "Сервер недоступен"
        case ChatServiceError.noNetwork: return "Нет сети"
        default: return "Не удалось подключиться"
        }
    }

    // MARK: - Model favorites

    private var favoriteModelsSection: some View {
        Section {
            Button {
                Task { await scanModels() }
            } label: {
                HStack {
                    if isScanningModels { ProgressView().tint(WesaidTheme.accent) }
                    Text("Сканировать модели провайдера")
                }
            }
            .disabled(baseUrl.trimmingCharacters(in: .whitespaces).isEmpty || isScanningModels)

            if let modelScanErrorMessage {
                Text(modelScanErrorMessage).font(.caption).foregroundStyle(.red)
            }

            ForEach(availableModels, id: \.self) { modelID in
                Button {
                    toggleFavorite(modelID)
                } label: {
                    HStack {
                        Text(modelID).foregroundStyle(WesaidTheme.text1)
                        Spacer()
                        if favoriteModels.contains(modelID) {
                            Image(systemName: "star.fill").foregroundStyle(WesaidTheme.accent)
                        }
                    }
                }
            }
        } header: {
            Text("Избранные модели")
        } footer: {
            Text("Появятся быстрым переключателем прямо в чате — вместе с избранными моделями других провайдеров. Переключение действует только на текущий разговор и незаметно использует ключ и адрес нужного провайдера; модель по умолчанию у провайдера не меняется.")
        }
        .listRowBackground(WesaidTheme.surface)
    }

    private func toggleFavorite(_ modelID: String) {
        if favoriteModels.contains(modelID) {
            favoriteModels.remove(modelID)
        } else {
            favoriteModels.insert(modelID)
        }
    }

    private func scanModels() async {
        isScanningModels = true
        modelScanErrorMessage = nil
        defer { isScanningModels = false }
        do {
            let models = try await ModelCatalogClient().fetchModels(baseURL: baseUrl, apiKey: apiKey)
            // Union with existing favorites: a fresh scan coming back shorter
            // (a rate limit, a provider trimming its own list) must not make
            // an already-starred model vanish from view.
            var merged = models
            for favorite in favoriteModels where !merged.contains(favorite) {
                merged.append(favorite)
            }
            availableModels = merged
        } catch {
            modelScanErrorMessage = describeScanFailure(error)
        }
    }

    private func describeScanFailure(_ error: Error) -> String {
        switch error {
        case ModelCatalogClient.CatalogError.badURL: return "Некорректный адрес провайдера"
        case ModelCatalogClient.CatalogError.httpError(let status): return "Провайдер ответил ошибкой \(status)"
        default: return "Не удалось получить список моделей"
        }
    }

    private func save() {
        let provider = Provider(
            id: providerID,
            name: name.trimmingCharacters(in: .whitespaces),
            baseUrl: baseUrl.trimmingCharacters(in: .whitespaces),
            model: model.trimmingCharacters(in: .whitespaces)
        )
        if editingID != nil {
            settings.updateProvider(provider, apiKey: apiKey.isEmpty ? nil : apiKey)
        } else {
            settings.addProvider(provider, apiKey: apiKey)
        }
        settings.setFavoriteModels(favoriteModels, for: providerID)
        dismiss()
    }
}
