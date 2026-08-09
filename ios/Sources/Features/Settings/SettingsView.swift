import SwiftUI
import UniformTypeIdentifiers

/// A backup file is just the JSON `BackupCodec` already produces — this
/// wrapper only exists so `.fileExporter` (the native Files save sheet) has a
/// `FileDocument` to hand it.
struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }

    var data: Data

    init(data: Data) { self.data = data }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

struct SettingsView: View {
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var characters: CharacterStore
    @EnvironmentObject private var chats: ChatStore
    @State private var editingProvider: Provider?
    @State private var showingAddProvider = false

    @State private var exportDocument: BackupDocument?
    @State private var showingExporter = false
    @State private var showingImporter = false
    @State private var restoreMessage: String?
    @State private var restoreErrorMessage: String?

    var body: some View {
        Form {
            providersSection
            modelParamsSection
            instructionsSection
            personaSection
            memorySection
            thinkingSection
            faceIDSection
            backupSection
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
        Section {
            HStack(spacing: 8) {
                presetButton("Творческий", preset: .creative)
                presetButton("Баланс", preset: .balanced)
                presetButton("Точный", preset: .precise)
            }
            .padding(.vertical, 4)

            // Presets just fill in these same sliders — applying one is a
            // starting point, not a locked-in mode, matching the web version
            // (MP_PRESETS + full manual sliders, not either/or).
            sliderRow(title: "Температура", hint: "Ниже — отвечает чётко и по делу. Выше — фантазирует и удивляет.",
                      value: doubleBinding(\.temperature), range: 0...2, step: 0.05, format: { String(format: "%.2f", $0) })
            sliderRow(title: "Длина ответа", hint: "Максимальный размер одного ответа.",
                      value: intBinding(\.maxTokens), range: 64...4096, step: 64, format: { String(Int($0)) })
            sliderRow(title: "Память", hint: "Сколько последних сообщений персонаж помнит.",
                      value: intBinding(\.contextMessages), range: 2...100, step: 2, format: { String(Int($0)) })
            sliderRow(title: "Top P", hint: "Из какой доли вероятных слов выбирать. Обычно не трогают.",
                      value: doubleBinding(\.topP), range: 0.1...1, step: 0.05, format: { String(format: "%.2f", $0) })
            sliderRow(title: "Top K", hint: "Сколько вариантов слов рассматривать. Обычно не трогают.",
                      value: intBinding(\.topK), range: 1...100, step: 1, format: { String(Int($0)) })
        } header: {
            Text("Параметры модели")
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

    private func sliderRow(title: String, hint: String, value: Binding<Double>,
                            range: ClosedRange<Double>, step: Double, format: @escaping (Double) -> String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                Spacer()
                Text(format(value.wrappedValue))
                    .foregroundStyle(WesaidTheme.text3)
                    .monospacedDigit()
            }
            Slider(value: value, in: range, step: step)
                .tint(WesaidTheme.accent)
            Text(hint)
                .font(.caption2)
                .foregroundStyle(WesaidTheme.text3)
        }
        .padding(.vertical, 2)
    }

    private func doubleBinding(_ keyPath: WritableKeyPath<ModelParams, Double>) -> Binding<Double> {
        Binding(
            get: { settings.settings.modelParams[keyPath: keyPath] },
            set: { settings.settings.modelParams[keyPath: keyPath] = $0 }
        )
    }

    private func intBinding(_ keyPath: WritableKeyPath<ModelParams, Int>) -> Binding<Double> {
        Binding(
            get: { Double(settings.settings.modelParams[keyPath: keyPath]) },
            set: { settings.settings.modelParams[keyPath: keyPath] = Int($0) }
        )
    }

    private var instructionsSection: some View {
        Section {
            TextField("Например: отвечай только на русском языке.", text: Binding(
                get: { settings.settings.modelParams.globalSystem },
                set: { settings.settings.modelParams.globalSystem = $0 }
            ), axis: .vertical)
            .lineLimit(2...5)
        } header: {
            Text("Общие инструкции для всех персонажей")
        }
        .listRowBackground(WesaidTheme.surface)
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

    private var thinkingSection: some View {
        Section {
            Toggle("Размышлять перед ответом по умолчанию", isOn: Binding(
                get: { settings.settings.preferences.forceThinkingByDefault },
                set: { settings.settings.preferences.forceThinkingByDefault = $0 }
            ))
            .tint(WesaidTheme.accent)
        } footer: {
            Text("Модель сначала подробно рассуждает, потом отвечает — работает с любым провайдером через обычный промт, не через специальный режим конкретной модели. Каждый чат можно переключить отдельно значком мозга у поля ввода.")
        }
        .listRowBackground(WesaidTheme.surface)
    }

    private var faceIDSection: some View {
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

    private var backupSection: some View {
        Section {
            Button {
                exportBackup()
            } label: {
                Label("Экспортировать резервную копию", systemImage: "square.and.arrow.up")
            }
            Button {
                showingImporter = true
            } label: {
                Label("Восстановить из файла", systemImage: "square.and.arrow.down")
            }
            if let restoreMessage {
                Text(restoreMessage)
                    .font(.caption)
                    .foregroundStyle(WesaidTheme.text3)
            }
        } header: {
            Text("Резервная копия")
        } footer: {
            Text("В копию входят персонажи, чаты и список провайдеров. Ключи API нигде не сохраняются — после восстановления на новом устройстве их нужно ввести заново.")
        }
        .listRowBackground(WesaidTheme.surface)
        .fileExporter(isPresented: $showingExporter, document: exportDocument, contentType: .json,
                      defaultFilename: "wesaid-backup") { result in
            if case .failure(let error) = result { restoreErrorMessage = error.localizedDescription }
        }
        .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.json]) { result in
            switch result {
            case .success(let url): importBackup(from: url)
            case .failure(let error): restoreErrorMessage = error.localizedDescription
            }
        }
        .alert("Не получилось восстановить", isPresented: Binding(
            get: { restoreErrorMessage != nil },
            set: { if !$0 { restoreErrorMessage = nil } }
        )) {
            Button("Ок", role: .cancel) {}
        } message: {
            Text(restoreErrorMessage ?? "")
        }
    }

    private func exportBackup() {
        guard let data = try? BackupCodec.export(characters: characters, chats: chats, settings: settings) else {
            restoreErrorMessage = "Не удалось собрать резервную копию."
            return
        }
        exportDocument = BackupDocument(data: data)
        showingExporter = true
    }

    private func importBackup(from url: URL) {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            let stats = try BackupCodec.restore(data: data, into: characters, chats: chats, settings: settings)
            restoreMessage = "Добавлено: персонажей — \(stats.characters), чатов — \(stats.chats)"
                + (stats.providersAdded > 0 ? ", провайдеров — \(stats.providersAdded)" : "")
        } catch BackupCodec.BackupError.wrongFormat {
            restoreErrorMessage = "Это не файл резервной копии wesaid."
        } catch {
            restoreErrorMessage = "Не удалось прочитать файл."
        }
    }
}
