import XCTest
@testable import wesaid

final class BackupCodecTests: XCTestCase {

    private func makeStores() -> (characters: CharacterStore, chats: ChatStore, settings: SettingsStore) {
        let paths = AppPaths(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        // In-memory, not the real Keychain — see `KeychainServicing`.
        let keychain = InMemoryKeychain()
        return (
            CharacterStore(paths: paths, seedOnFirstLaunch: false),
            ChatStore(paths: paths),
            SettingsStore(paths: paths, keychain: keychain)
        )
    }

    private let onePixelPNG = Data([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xAA, 0xBB, 0xCC, 0xDD,
    ])

    // MARK: - Export

    func testExportInlinesTheAvatarFileAsADataURI() throws {
        let (characters, chats, settings) = makeStores()
        let fileName = characters.avatars.save(onePixelPNG, fileExtension: "png")!
        var card = CharacterCard(name: "Рэйк")
        card.avatar = fileName
        characters.upsert(card)

        let data = try BackupCodec.export(characters: characters, chats: chats, settings: settings)

        // Decoded rather than a raw substring check: `JSONEncoder` escapes
        // `/` as `\/` by default, so the literal text `data:image/png` never
        // appears verbatim in the encoded bytes even though it round-trips
        // correctly through the decoder.
        let file = try StoreCoding.decoder.decode(BackupCodec.BackupFile.self, from: data)
        XCTAssertEqual(file.characters.first?.avatar?.hasPrefix("data:image/png;base64,"), true)

        let json = String(decoding: data, as: UTF8.self)
        XCTAssertFalse(json.contains(fileName), "the local-only file name must not leak into a portable backup")
    }

    func testExportLeavesACharacterWithNoAvatarUntouched() throws {
        let (characters, chats, settings) = makeStores()
        characters.upsert(CharacterCard(name: "Без аватара"))

        let data = try BackupCodec.export(characters: characters, chats: chats, settings: settings)
        let file = try StoreCoding.decoder.decode(BackupCodec.BackupFile.self, from: data)

        XCTAssertEqual(file.characters.count, 1)
        XCTAssertNil(file.characters[0].avatar)
    }

    func testExportNeverIncludesAnAPIKey() throws {
        let (characters, chats, settings) = makeStores()
        settings.addProvider(Provider(name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o"),
                              apiKey: "sk-super-secret")

        let data = try BackupCodec.export(characters: characters, chats: chats, settings: settings)
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("sk-super-secret"))
    }

    // MARK: - Round trip

    func testRoundTripRestoresCharacterAndAvatarBytesOnAFreshDevice() throws {
        let source = makeStores()
        let fileName = source.characters.avatars.save(onePixelPNG, fileExtension: "png")!
        var card = CharacterCard(name: "Рэйк", description: "Пират", tags: ["rp"])
        card.avatar = fileName
        source.characters.upsert(card)

        let backupData = try BackupCodec.export(characters: source.characters, chats: source.chats, settings: source.settings)

        let target = makeStores()
        let stats = try BackupCodec.restore(data: backupData, into: target.characters, chats: target.chats, settings: target.settings)

        XCTAssertEqual(stats.characters, 1)
        let restored = try XCTUnwrap(target.characters.characters.first)
        XCTAssertEqual(restored.name, "Рэйк")
        XCTAssertEqual(restored.description, "Пират")
        XCTAssertEqual(restored.tags, ["rp"])
        XCTAssertNotEqual(restored.avatar, fileName, "restored avatar must be this device's own new file")
        XCTAssertEqual(target.characters.avatars.data(for: restored.avatar), onePixelPNG)
    }

    func testRoundTripRestoresChatMessages() throws {
        let source = makeStores()
        let character = CharacterCard(name: "Мия")
        source.characters.upsert(character)
        _ = source.chats.create(with: character, greeting: "Привет!")

        let backupData = try BackupCodec.export(characters: source.characters, chats: source.chats, settings: source.settings)

        let target = makeStores()
        let stats = try BackupCodec.restore(data: backupData, into: target.characters, chats: target.chats, settings: target.settings)

        XCTAssertEqual(stats.chats, 1)
        XCTAssertEqual(target.chats.chats.first?.messages.first?.content, "Привет!")
    }

    // MARK: - Never clobber

    func testRestoreSkipsACharacterThatAlreadyExistsLocally() throws {
        let target = makeStores()
        let existing = CharacterCard(id: "dup", name: "Локальный")
        target.characters.upsert(existing)

        let incoming = CharacterCard(id: "dup", name: "Из бэкапа")
        let backupFile = BackupCodec.BackupFile(characters: [incoming], chats: [], settings: AppSettings())
        let data = try StoreCoding.encoder.encode(backupFile)

        let stats = try BackupCodec.restore(data: data, into: target.characters, chats: target.chats, settings: target.settings)

        XCTAssertEqual(stats.characters, 0)
        XCTAssertEqual(target.characters.characters.first?.name, "Локальный", "an existing character must never be overwritten")
    }

    func testRestoreSkipsAChatThatAlreadyExistsLocally() throws {
        let target = makeStores()
        let character = CharacterCard(name: "Мия")
        target.characters.upsert(character)
        let existingChat = target.chats.create(with: character, greeting: "Локальное")

        var incoming = existingChat
        incoming.messages = [ChatMessage(role: .assistant, content: "Из бэкапа")]
        let backupFile = BackupCodec.BackupFile(characters: [], chats: [incoming], settings: AppSettings())
        let data = try StoreCoding.encoder.encode(backupFile)

        let stats = try BackupCodec.restore(data: data, into: target.characters, chats: target.chats, settings: target.settings)

        XCTAssertEqual(stats.chats, 0)
        XCTAssertEqual(target.chats.chats.first?.messages.first?.content, "Локальное")
    }

    // MARK: - Providers

    func testRestoreMergesNewProvidersAndKeepsExistingOnes() throws {
        let target = makeStores()
        target.settings.addProvider(Provider(id: "a", name: "Existing"), apiKey: "")

        let backupFile = BackupCodec.BackupFile(
            characters: [], chats: [],
            settings: AppSettings(providers: [Provider(id: "a", name: "Should be ignored"), Provider(id: "b", name: "New")])
        )
        let data = try StoreCoding.encoder.encode(backupFile)

        let stats = try BackupCodec.restore(data: data, into: target.characters, chats: target.chats, settings: target.settings)

        XCTAssertEqual(stats.providersAdded, 1)
        XCTAssertEqual(target.settings.settings.providers.map(\.id).sorted(), ["a", "b"])
        XCTAssertEqual(target.settings.settings.providers.first { $0.id == "a" }?.name, "Existing",
                       "a provider already on this device must not be replaced by the backup's copy")
    }

    // MARK: - Format validation

    func testRestoreRejectsAFileThatIsNotAWesaidBackup() throws {
        let target = makeStores()
        let data = Data(#"{"format":"something-else","characters":[],"chats":[],"settings":{}}"#.utf8)

        XCTAssertThrowsError(try BackupCodec.restore(data: data, into: target.characters, chats: target.chats, settings: target.settings)) {
            XCTAssertEqual($0 as? BackupCodec.BackupError, .wrongFormat)
        }
    }

    func testRestoreRejectsAFileMissingTheFormatKeyEntirely() throws {
        let target = makeStores()
        let data = Data(#"{"characters":[],"chats":[]}"#.utf8)

        XCTAssertThrowsError(try BackupCodec.restore(data: data, into: target.characters, chats: target.chats, settings: target.settings)) {
            XCTAssertEqual($0 as? BackupCodec.BackupError, .wrongFormat)
        }
    }
}
