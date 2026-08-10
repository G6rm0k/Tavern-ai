import Foundation

/// Export/import of the whole local library as one JSON file — the on-device
/// equivalent of `/api/backup` + `/api/restore` (`server/index.js:1602-1694`).
///
/// Same envelope and the same avatar-inlining trick the server uses: a
/// character's `avatar` briefly holds a `data:image/…;base64,…` URI instead
/// of a file name, which is exactly why `CharacterCard.avatar` and
/// `ChatSession.characterAvatar` are left as untyped `String?` rather than a
/// strict "must be a local file name" type — this is the one place that
/// looseness is used on purpose, and it is what lets a desktop backup import
/// here without a translation layer, and vice versa.
///
/// API keys never enter this file at all: `Provider` has no `apiKey` field
/// (see `AppSettings.swift`), so encoding `AppSettings.providers` as-is is
/// already safe — restoring on a new device leaves providers configured but
/// keyless, matching the desktop version's backup made without `?keys=1`.
enum BackupCodec {

    struct BackupFile: Codable {
        var format: String
        var version: Int
        var exportedAt: Double
        var characters: [CharacterCard]
        var chats: [ChatSession]
        var settings: AppSettings

        init(format: String = "wesaid-backup", version: Int = 1, exportedAt: Double = Date.nowMilliseconds,
             characters: [CharacterCard], chats: [ChatSession], settings: AppSettings) {
            self.format = format
            self.version = version
            self.exportedAt = exportedAt
            self.characters = characters
            self.chats = chats
            self.settings = settings
        }

        enum CodingKeys: String, CodingKey {
            case format, version, exportedAt, characters, chats, settings
        }

        // Field-by-field with a fallback, same as every other persisted type
        // here — a partial or hand-edited backup file must degrade to "import
        // what's readable" rather than fail the whole restore.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            format     = (try? c.decode(String.self, forKey: .format)) ?? ""
            version    = (try? c.decode(Int.self, forKey: .version)) ?? 1
            exportedAt = (try? c.decode(Double.self, forKey: .exportedAt)) ?? 0
            characters = (try? c.decode([CharacterCard].self, forKey: .characters)) ?? []
            chats      = (try? c.decode([ChatSession].self, forKey: .chats)) ?? []
            settings   = (try? c.decode(AppSettings.self, forKey: .settings)) ?? AppSettings()
        }
    }

    enum BackupError: Error, Equatable {
        case wrongFormat
    }

    struct RestoreStats: Equatable {
        var characters = 0
        var chats = 0
        var providersAdded = 0
    }

    // MARK: - Export

    static func export(characters characterStore: CharacterStore, chats chatStore: ChatStore,
                        settings settingsStore: SettingsStore) throws -> Data {
        let inlinedCharacters = characterStore.characters.map { character -> CharacterCard in
            var copy = character
            copy.avatar = inlineAvatar(character.avatar, from: characterStore.avatars)
            return copy
        }
        let inlinedChats = chatStore.chats.map { chat -> ChatSession in
            var copy = chat
            copy.characterAvatar = inlineAvatar(chat.characterAvatar, from: characterStore.avatars)
            return copy
        }
        let file = BackupFile(characters: inlinedCharacters, chats: inlinedChats, settings: settingsStore.settings)
        return try StoreCoding.encoder.encode(file)
    }

    /// Reads the file behind a stored avatar name and turns it into a
    /// `data:` URI, so the exported JSON is self-contained and portable to
    /// another device — mirrors `inlineAvatar()` in `server/index.js:418-427`.
    /// A name that can't be resolved (already gone, or none) passes through
    /// unchanged rather than failing the whole export.
    private static func inlineAvatar(_ fileName: String?, from avatars: AvatarStore) -> String? {
        guard let fileName, let data = avatars.data(for: fileName) else { return fileName }
        let ext = (fileName as NSString).pathExtension.lowercased()
        let mime = (ext == "jpg" || ext == "jpeg") ? "image/jpeg" : "image/png"
        return "data:\(mime);base64," + data.base64EncodedString()
    }

    // MARK: - Import

    /// Never overwrites what's already on the device — a character or chat
    /// whose `id` already exists locally is skipped, matching the server's
    /// restore semantics (`server/index.js:1646-1667`, "never clobber what is
    /// already here"). Providers are merged in by id for the same reason;
    /// model parameters, persona and the Face ID toggle are deliberately left
    /// as this device already has them — a backup is for not losing your
    /// characters and chat history, not for overwriting per-device tuning.
    @discardableResult
    static func restore(data: Data, into characterStore: CharacterStore, chats chatStore: ChatStore,
                         settings settingsStore: SettingsStore) throws -> RestoreStats {
        let file = try StoreCoding.decoder.decode(BackupFile.self, from: data)
        guard file.format == "wesaid-backup" else { throw BackupError.wrongFormat }

        var stats = RestoreStats()
        for character in file.characters where !character.name.isEmpty {
            var localized = character
            localized.avatar = storeAvatar(character.avatar, into: characterStore.avatars)
            if characterStore.restore(localized) { stats.characters += 1 }
        }
        for chat in file.chats {
            var localized = chat
            localized.characterAvatar = storeAvatar(chat.characterAvatar, into: characterStore.avatars)
            if chatStore.restore(localized) { stats.chats += 1 }
        }

        let existingProviderIDs = Set(settingsStore.settings.providers.map(\.id))
        let newProviders = file.settings.providers.filter { !existingProviderIDs.contains($0.id) }
        if !newProviders.isEmpty {
            settingsStore.settings.providers.append(contentsOf: newProviders)
            if settingsStore.settings.activeProviderId == nil {
                settingsStore.settings.activeProviderId = newProviders.first?.id
            }
            stats.providersAdded = newProviders.count

            // Favorites for a provider that already existed on this device
            // are left alone (same "this device's own tuning wins" rule as
            // model params/persona above) — only favorites belonging to the
            // providers just added above come along with them.
            let newProviderIDs = Set(newProviders.map(\.id))
            let existingFavoriteIDs = Set(settingsStore.settings.favoriteModels.map(\.id))
            let newFavorites = file.settings.favoriteModels.filter {
                newProviderIDs.contains($0.providerID) && !existingFavoriteIDs.contains($0.id)
            }
            settingsStore.settings.favoriteModels.append(contentsOf: newFavorites)
        }
        return stats
    }

    /// The inverse of `inlineAvatar` — decodes a `data:` URI back to a file,
    /// mirroring `storeAvatar()` in `server/index.js:394-409`. A value that
    /// isn't a data URI (already a bare file name from a malformed file, or
    /// nothing) becomes `nil`: it isn't this device's job to guess at a
    /// stranger's file name.
    private static func storeAvatar(_ value: String?, into avatars: AvatarStore) -> String? {
        guard let value, value.hasPrefix("data:image/"),
              let commaIndex = value.firstIndex(of: ",") else { return nil }
        let header = value[value.startIndex..<commaIndex]
        let base64 = String(value[value.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: base64), !data.isEmpty else { return nil }
        let ext = (header.contains("jpeg") || header.contains("jpg")) ? "jpg" : "png"
        return avatars.save(data, fileExtension: ext)
    }
}
