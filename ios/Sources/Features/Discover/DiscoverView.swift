import SwiftUI

/// Search and import from Chub.ai — talks to `api.chub.ai` directly
/// (`ChubAPIClient`), no proxy needed on a native client. Importing reuses
/// the same `PNGCharacterCardParser` as the manual PNG import in
/// `CharacterEditorView`, since a downloaded card is the same file format.
struct DiscoverView: View {
    @EnvironmentObject private var characters: CharacterStore
    @EnvironmentObject private var chats: ChatStore
    @EnvironmentObject private var settings: SettingsStore

    private let client = ChubAPIClient()
    private let translator = TranslatorClient()

    private struct Category: Identifiable {
        let id: String
        let label: String
        let tags: String
        let nsfw: Bool
    }

    // Same list as `Discover.CATS` in `public/js/discover.js`.
    private static let categories: [Category] = [
        Category(id: "russian", label: "🇷🇺 Русские", tags: "russian", nsfw: false),
        Category(id: "anime", label: "⛩ Аниме", tags: "anime", nsfw: false),
        Category(id: "game", label: "🎮 Игры", tags: "video-game", nsfw: false),
        Category(id: "fantasy", label: "🧙 Фэнтези", tags: "fantasy", nsfw: false),
        Category(id: "romance", label: "💕 Романтика", tags: "romance", nsfw: false),
        Category(id: "assistant", label: "✦ Ассистент", tags: "assistant", nsfw: false),
        Category(id: "historical", label: "🏛 История", tags: "historical", nsfw: false),
        Category(id: "scifi", label: "🚀 Sci-Fi", tags: "sci-fi", nsfw: false),
        Category(id: "nsfw", label: "🔞 18+", tags: "nsfw", nsfw: true),
    ]

    @State private var searchText = ""
    @State private var selectedCategoryID: String?
    @State private var results: [ChubAPIClient.Character] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var importingPaths: Set<String> = []
    @State private var navigateTo: CharacterCard?

    private var searchKey: String { "\(searchText)|\(selectedCategoryID ?? "")" }

    var body: some View {
        ScrollView {
            categoryRow
            resultsGrid
        }
        .background(WesaidTheme.background)
        .navigationTitle("Поиск")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
        .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Поиск персонажей…")
        .navigationDestination(item: $navigateTo) { character in
            ChatView(controller: makeController(for: character))
        }
        .task(id: searchKey) { await runSearch() }
    }

    // MARK: - Categories

    private var categoryRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                categoryChip(label: "✦ Все", isSelected: selectedCategoryID == nil) { selectedCategoryID = nil }
                ForEach(Self.categories) { category in
                    categoryChip(label: category.label, isSelected: selectedCategoryID == category.id) {
                        selectedCategoryID = (selectedCategoryID == category.id) ? nil : category.id
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
    }

    private func categoryChip(label: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? WesaidTheme.accent : WesaidTheme.surface, in: Capsule())
                .foregroundStyle(isSelected ? Color.white : WesaidTheme.text1)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Results

    @ViewBuilder
    private var resultsGrid: some View {
        if isLoading && results.isEmpty {
            ProgressView()
                .padding(.top, 60)
        } else if let errorMessage {
            emptyState(systemImage: "wifi.slash", title: "Не получилось загрузить", detail: errorMessage)
        } else if results.isEmpty {
            emptyState(systemImage: "sparkle.magnifyingglass", title: "Ничего не найдено",
                       detail: "Попробуй другой запрос или фильтр")
        } else {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(results) { character in
                    card(for: character)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
    }

    private func emptyState(systemImage: String, title: String, detail: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 36))
                .foregroundStyle(WesaidTheme.text3)
            Text(title)
                .font(.headline)
                .foregroundStyle(WesaidTheme.text1)
            Text(detail)
                .font(.caption)
                .foregroundStyle(WesaidTheme.text3)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .padding(.top, 60)
    }

    private func card(for character: ChubAPIClient.Character) -> some View {
        let isAdded = characters.characters.contains { $0.name == character.name }
        let isImporting = importingPaths.contains(character.fullPath)

        return VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                avatarView(for: character)
                if isAdded {
                    Image(systemName: "checkmark.circle.fill")
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, WesaidTheme.accent)
                        .padding(6)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(character.name)
                    .font(.subheadline.bold())
                    .foregroundStyle(WesaidTheme.text1)
                    .lineLimit(1)
                if !character.description.isEmpty {
                    Text(character.description)
                        .font(.caption)
                        .foregroundStyle(WesaidTheme.text3)
                        .lineLimit(2)
                }
                if !character.tags.isEmpty {
                    Text(character.tags.prefix(3).joined(separator: " · "))
                        .font(.caption2)
                        .foregroundStyle(WesaidTheme.accent)
                        .lineLimit(1)
                }
            }
            .padding(10)
        }
        .background(WesaidTheme.surface, in: RoundedRectangle(cornerRadius: WesaidTheme.radius))
        .overlay {
            if isImporting {
                RoundedRectangle(cornerRadius: WesaidTheme.radius)
                    .fill(.black.opacity(0.35))
                ProgressView().tint(.white)
            }
        }
        .onTapGesture { handleTap(character) }
    }

    private func avatarView(for character: ChubAPIClient.Character) -> some View {
        Group {
            if let urlString = character.avatarURL, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().aspectRatio(contentMode: .fill)
                    } else {
                        placeholderAvatar
                    }
                }
            } else {
                placeholderAvatar
            }
        }
        .frame(height: 140)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    private var placeholderAvatar: some View {
        Rectangle()
            .fill(WesaidTheme.surface2)
            .overlay(Image(systemName: "sparkle").foregroundStyle(WesaidTheme.text3))
    }

    // MARK: - Search

    private func runSearch() async {
        // Debounce: `.task(id:)` cancels the in-flight task the instant
        // `searchKey` changes again, so a fast typist never fires more than
        // one real request per pause.
        try? await Task.sleep(nanoseconds: 400_000_000)
        guard !Task.isCancelled else { return }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        let category = Self.categories.first { $0.id == selectedCategoryID }
        do {
            let nodes = try await client.search(
                query: searchText.trimmingCharacters(in: .whitespacesAndNewlines),
                tags: category?.tags,
                page: 1,
                nsfw: category?.nsfw ?? false
            )
            guard !Task.isCancelled else { return }
            results = nodes
        } catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { return }
            results = []
            errorMessage = "Chub.ai не отвечает. Проверь соединение и попробуй ещё раз."
        }
    }

    // MARK: - Import / open

    private func handleTap(_ character: ChubAPIClient.Character) {
        if let local = characters.characters.first(where: { $0.name == character.name }) {
            navigateTo = local
            return
        }
        guard !importingPaths.contains(character.fullPath) else { return }
        importingPaths.insert(character.fullPath)

        Task {
            defer { importingPaths.remove(character.fullPath) }
            do {
                let data = try await client.downloadCard(fullPath: character.fullPath)
                let parsed = try PNGCharacterCardParser.parse(pngData: data)
                let card = CharacterCard(
                    name: parsed.name,
                    description: parsed.description,
                    systemPrompt: parsed.systemPrompt,
                    firstMessages: parsed.firstMessages,
                    tags: parsed.tags
                )
                // Translate before the first save: `translated(_:)` works off
                // this freshly-built value, which has no avatar yet — saving
                // it first and mutating a stale local copy afterwards would
                // wipe out the avatar `setAvatar` is about to attach below.
                let finalCard = await translated(card)
                characters.upsert(finalCard)
                characters.setAvatar(data, for: finalCard.id)
                navigateTo = finalCard
            } catch {
                errorMessage = "Не получилось добавить «\(character.name)» — файл карточки повреждён или недоступен."
            }
        }
    }

    /// Chub cards are overwhelmingly written in English; without this a
    /// freshly imported character's greetings and description stay in
    /// whatever language the card happened to ship in. Mirrors
    /// `Translator.translateImportedChar` in `public/js/translator.js` —
    /// same target-language setting, extended (there too, not just here) to
    /// also cover `description`, which the original only left in English.
    private func translated(_ card: CharacterCard) async -> CharacterCard {
        let targetLanguage = settings.settings.preferences.translateLanguage
        let sample = card.firstMessages.first ?? card.description
        guard !sample.isEmpty else { return card }
        let detected = TranslatorClient.detectLanguage(sample)
        guard detected != targetLanguage else { return card }

        var updated = card
        var translatedMessages: [String] = []
        for message in card.firstMessages {
            guard !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                translatedMessages.append(message)
                continue
            }
            translatedMessages.append(await translator.translate(message, from: detected, to: targetLanguage))
        }
        updated.firstMessages = translatedMessages
        if !card.description.isEmpty {
            updated.description = await translator.translate(card.description, from: detected, to: targetLanguage)
        }
        return updated
    }

    /// Same one-conversation-per-character convenience as `HomeView`.
    private func makeController(for character: CharacterCard) -> ChatController {
        let existing = chats.chats(forCharacter: character.id).first
        let session = existing ?? chats.create(with: character)
        return ChatController(chat: session, chatStore: chats, characterStore: characters, settingsStore: settings)
    }
}
