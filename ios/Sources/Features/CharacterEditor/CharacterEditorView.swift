import SwiftUI
import UniformTypeIdentifiers

/// Create or edit a character: basics, greetings, lorebook, and PNG card
/// import. Reachable from `HomeView` via the toolbar `+` (new) or a swipe
/// action (edit existing).
struct CharacterEditorView: View {
    @EnvironmentObject private var characters: CharacterStore
    @Environment(\.dismiss) private var dismiss

    private let editingID: String?
    private let existingAvatarPath: String?

    @State private var name: String
    @State private var description: String
    @State private var systemPrompt: String
    @State private var avatarEmoji: String
    @State private var tags: [String]
    @State private var firstMessages: [String]
    @State private var lorebookRows: [LorebookRow]
    /// Set once a PNG card is imported; saved as the avatar file when the
    /// character itself is saved.
    @State private var pendingAvatarData: Data?
    @State private var showingImporter = false
    @State private var importErrorMessage: String?

    /// A lorebook row's *raw typed text* for keys, kept separate from the
    /// `[String]` array it becomes on save. Deriving the array live on every
    /// keystroke (splitting on `,`) would eat a trailing ", " the instant
    /// it's typed — the array-from-text conversion only happens once, at
    /// save, exactly like the web version's `_collectLore()`.
    private struct LorebookRow: Identifiable {
        var id: String
        var keysText: String
        var content: String
    }

    init(editing character: CharacterCard? = nil) {
        editingID = character?.id
        existingAvatarPath = character?.avatar
        _name = State(initialValue: character?.name ?? "")
        _description = State(initialValue: character?.description ?? "")
        _systemPrompt = State(initialValue: character?.systemPrompt ?? "")
        _avatarEmoji = State(initialValue: character?.avatarEmoji ?? "✦")
        _tags = State(initialValue: character?.tags ?? [])
        _firstMessages = State(initialValue: character?.firstMessages ?? [])
        _lorebookRows = State(initialValue: (character?.lorebook ?? []).map {
            LorebookRow(id: $0.id, keysText: $0.keys.joined(separator: ", "), content: $0.content)
        })
    }

    var body: some View {
        NavigationStack {
            Form {
                importSection
                basicsSection
                greetingsSection
                lorebookSection
            }
            .scrollContentBackground(.hidden)
            .background(WesaidTheme.background)
            .navigationTitle(editingID == nil ? "Новый персонаж" : "Редактирование")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.png]) { result in
                switch result {
                case .success(let url): importPNG(from: url)
                case .failure(let error): importErrorMessage = error.localizedDescription
                }
            }
            .alert("Не получилось разобрать карточку", isPresented: Binding(
                get: { importErrorMessage != nil },
                set: { if !$0 { importErrorMessage = nil } }
            )) {
                Button("Ок", role: .cancel) {}
            } message: {
                Text(importErrorMessage ?? "")
            }
        }
        .tint(WesaidTheme.accent)
    }

    // MARK: - Sections

    private var importSection: some View {
        Section {
            Button {
                showingImporter = true
            } label: {
                Label("Импортировать PNG-карточку", systemImage: "square.and.arrow.down")
            }
            if pendingAvatarData != nil {
                Label("Картинка карточки станет аватаром", systemImage: "checkmark.circle")
                    .font(.caption)
                    .foregroundStyle(WesaidTheme.text3)
            }
        } footer: {
            Text("Карточки Tavern/Chub.ai и похожие в формате PNG — импорт заполнит поля ниже, останется проверить и сохранить.")
        }
        .listRowBackground(WesaidTheme.surface)
    }

    private var basicsSection: some View {
        Section("Основное") {
            HStack {
                TextField("✦", text: $avatarEmoji)
                    .frame(width: 44)
                TextField("Имя персонажа", text: $name)
            }
            TextField("Краткое описание", text: $description, axis: .vertical)
                .lineLimit(2...4)
            TextField("Системный промт — как персонаж себя ведёт. {{char}} и {{user}} подставятся автоматически.",
                      text: $systemPrompt, axis: .vertical)
                .lineLimit(4...10)
        }
        .listRowBackground(WesaidTheme.surface)
    }

    private var greetingsSection: some View {
        Section {
            ForEach(firstMessages.indices, id: \.self) { index in
                HStack(alignment: .top, spacing: 8) {
                    TextField("Приветствие", text: $firstMessages[index], axis: .vertical)
                        .lineLimit(2...5)
                    Button {
                        firstMessages.remove(at: index)
                    } label: {
                        Image(systemName: "minus.circle.fill").foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                }
            }
            Button {
                firstMessages.append("")
            } label: {
                Label("Добавить приветствие", systemImage: "plus.circle")
            }
        } header: {
            Text("Первые сообщения")
        } footer: {
            Text("Одно выбирается случайно при начале нового разговора.")
        }
        .listRowBackground(WesaidTheme.surface)
    }

    private var lorebookSection: some View {
        Section {
            ForEach($lorebookRows) { $row in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        TextField("Ключи через запятую", text: $row.keysText)
                        Button {
                            lorebookRows.removeAll { $0.id == row.id }
                        } label: {
                            Image(systemName: "minus.circle.fill").foregroundStyle(.red)
                        }
                        .buttonStyle(.plain)
                    }
                    TextField("Что персонаж об этом знает", text: $row.content, axis: .vertical)
                        .lineLimit(2...4)
                }
                .padding(.vertical, 2)
            }
            Button {
                lorebookRows.append(LorebookRow(id: UUID().uuidString, keysText: "", content: ""))
            } label: {
                Label("Добавить запись", systemImage: "plus.circle")
            }
        } header: {
            Text("Лорбук")
        } footer: {
            Text("Срабатывает и на изменённые окончания слов — «башня» в ключе сработает на «башню» в сообщении.")
        }
        .listRowBackground(WesaidTheme.surface)
    }

    // MARK: - PNG import

    private func importPNG(from url: URL) {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            let parsed = try PNGCharacterCardParser.parse(pngData: data)
            name = parsed.name
            description = parsed.description
            systemPrompt = parsed.systemPrompt
            firstMessages = parsed.firstMessages
            tags = parsed.tags
            pendingAvatarData = data
        } catch {
            importErrorMessage = describeImportFailure(error)
        }
    }

    private func describeImportFailure(_ error: Error) -> String {
        switch error {
        case PNGCharacterCardParser.ParseError.noCharacterData:
            return "В этом файле нет данных персонажа — это точно карточка Tavern/Chub.ai?"
        case PNGCharacterCardParser.ParseError.invalidBase64, PNGCharacterCardParser.ParseError.invalidJSON:
            return "Данные персонажа в файле повреждены."
        default:
            return "Не удалось прочитать файл."
        }
    }

    // MARK: - Save

    private func save() {
        let cleanedFirstMessages = firstMessages
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        // Same rule as the web version's _collectLore(): a row needs both at
        // least one key and non-empty content, or it is dropped rather than
        // saved as dead weight.
        let cleanedLorebook: [LorebookEntry] = lorebookRows.compactMap { row in
            let keys = row.keysText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            let content = row.content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !keys.isEmpty, !content.isEmpty else { return nil }
            return LorebookEntry(id: row.id, keys: keys, content: content)
        }

        let character = CharacterCard(
            id: editingID ?? UUID().uuidString,
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            systemPrompt: systemPrompt.trimmingCharacters(in: .whitespacesAndNewlines),
            firstMessages: cleanedFirstMessages,
            avatar: existingAvatarPath,
            avatarEmoji: avatarEmoji.isEmpty ? "✦" : avatarEmoji,
            tags: tags,
            lorebook: cleanedLorebook
        )
        characters.upsert(character)
        if let pendingAvatarData {
            characters.setAvatar(pendingAvatarData, for: character.id)
        }
        dismiss()
    }
}
