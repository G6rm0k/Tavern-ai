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

struct BackupSettingsView: View {
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var characters: CharacterStore
    @EnvironmentObject private var chats: ChatStore

    @State private var exportDocument: BackupDocument?
    @State private var showingExporter = false
    @State private var showingImporter = false
    @State private var restoreMessage: String?
    @State private var restoreErrorMessage: String?

    var body: some View {
        Form {
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
                Text("В копию входят персонажи, чаты, провайдеры и избранные модели. Ключи API нигде не сохраняются — после восстановления на новом устройстве их нужно ввести заново.")
            }
            .listRowBackground(WesaidTheme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(WesaidTheme.background)
        .navigationTitle("Резервная копия")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
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
