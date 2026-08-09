import SwiftUI

/// Add (or edit) one provider: pick a preset to prefill the address, paste a
/// key, optionally confirm it actually works before saving.
struct AddProviderView: View {
    @EnvironmentObject private var settings: SettingsStore
    @Environment(\.dismiss) private var dismiss

    /// `nil` when adding a new provider; set when editing an existing one.
    private let editingID: String?

    @State private var name: String
    @State private var baseUrl: String
    @State private var model: String
    @State private var apiKey: String
    @State private var selectedPresetID: String?

    private enum TestState: Equatable {
        case idle, testing, success, failure(String)
    }
    @State private var testState: TestState = .idle

    init(editing provider: Provider? = nil, apiKey existingKey: String = "") {
        editingID = provider?.id
        _name = State(initialValue: provider?.name ?? "")
        _baseUrl = State(initialValue: provider?.baseUrl ?? "")
        _model = State(initialValue: provider?.model ?? "")
        _apiKey = State(initialValue: existingKey)
        _selectedPresetID = State(initialValue: nil)
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

    private func save() {
        let provider = Provider(
            id: editingID ?? UUID().uuidString,
            name: name.trimmingCharacters(in: .whitespaces),
            baseUrl: baseUrl.trimmingCharacters(in: .whitespaces),
            model: model.trimmingCharacters(in: .whitespaces)
        )
        if editingID != nil {
            settings.updateProvider(provider, apiKey: apiKey.isEmpty ? nil : apiKey)
        } else {
            settings.addProvider(provider, apiKey: apiKey)
        }
        dismiss()
    }
}
