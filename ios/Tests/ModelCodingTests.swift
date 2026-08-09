import XCTest
@testable import wesaid

/// Coding is the one place where a mistake costs the user their data rather
/// than throwing a compiler error, and none of it can be exercised by hand
/// before a build reaches a phone — so it gets covered here instead.
final class ModelCodingTests: XCTestCase {

    private func roundTrip<T: Codable & Equatable>(_ value: T) throws -> T {
        let data = try StoreCoding.encoder.encode(value)
        return try StoreCoding.decoder.decode(T.self, from: data)
    }

    // MARK: - Round trips

    func testCharacterCardRoundTripsUnchanged() throws {
        let card = CharacterCard(
            id: "char-1",
            name: "Капитан Рэйк",
            description: "Пиратское приключение",
            systemPrompt: "Ты — {{char}}, говоришь с {{user}}",
            firstMessages: ["*сплёвывает за борт*", "Ну?"],
            avatar: "abc.png",
            avatarEmoji: "⚓",
            tags: ["rp", "pirate"],
            lorebook: [LorebookEntry(id: "l1", keys: ["башня", "маяк"], content: "Маяк давно погас.")],
            createdAt: 1_700_000_000_000
        )
        XCTAssertEqual(try roundTrip(card), card)
    }

    func testChatSessionRoundTripsUnchanged() throws {
        let session = ChatSession(
            id: "chat-1",
            characterId: "char-1",
            characterName: "Мия",
            characterAvatar: nil,
            characterAvatarEmoji: "☕",
            title: "Мия #2",
            messages: [
                ChatMessage(id: "m1", role: .assistant, content: "Привет", ts: 1, variants: ["Привет", "Здорово"], variantIndex: 1),
                ChatMessage(id: "m2", role: .user, content: "Как дела?", ts: 2, variants: [], variantIndex: 0)
            ],
            summary: "Познакомились",
            summarisedUpTo: 2,
            createdAt: 10,
            updatedAt: 20
        )
        XCTAssertEqual(try roundTrip(session), session)
    }

    func testAppSettingsRoundTripsUnchanged() throws {
        let settings = AppSettings(
            providers: [Provider(id: "p1", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o")],
            activeProviderId: "p1",
            modelParams: ModelParams(temperature: 1.1, maxTokens: 700, topP: 0.8, topK: 33, contextMessages: 25, globalSystem: "Отвечай кратко"),
            persona: Persona(name: "Гера", description: "Любит море"),
            requireBiometrics: true,
            preferences: AppPreferences(memoryEnabled: true, forceThinkingByDefault: true)
        )
        XCTAssertEqual(try roundTrip(settings), settings)
    }

    /// The web version stores this under `settings.app.memory` — a nested
    /// object, not a top-level key. Getting the `CodingKeys` wrong here would
    /// silently decode `preferences` to its default on every load.
    func testAppSettingsPreferencesUsesNestedAppKeyOnDisk() throws {
        let json = String(decoding: try StoreCoding.encoder.encode(AppSettings(preferences: AppPreferences(memoryEnabled: true))), as: UTF8.self)
        XCTAssertTrue(json.contains(#""app":{"memory":true}"#), json)
    }

    // MARK: - Tolerating older / foreign files

    /// The whole point of hand-written `init(from:)`: a file written by an
    /// earlier version, missing everything added since, must still load.
    func testCharacterCardDecodesFromMinimalJSON() throws {
        let json = Data(#"{"name":"Мия"}"#.utf8)
        let card = try StoreCoding.decoder.decode(CharacterCard.self, from: json)

        XCTAssertEqual(card.name, "Мия")
        XCTAssertFalse(card.id.isEmpty, "a missing id must be generated, not left blank")
        XCTAssertEqual(card.avatarEmoji, "✦")
        XCTAssertEqual(card.firstMessages, [])
        XCTAssertEqual(card.lorebook, [])
        XCTAssertNil(card.avatar)
    }

    func testChatSessionDecodesFromMinimalJSON() throws {
        let json = Data(#"{"characterName":"Мия"}"#.utf8)
        let session = try StoreCoding.decoder.decode(ChatSession.self, from: json)

        XCTAssertEqual(session.characterName, "Мия")
        XCTAssertEqual(session.messages, [])
        XCTAssertEqual(session.summarisedUpTo, 0)
        XCTAssertEqual(session.updatedAt, session.createdAt, "updatedAt should fall back to createdAt")
    }

    func testSettingsDecodeFromMinimalJSONUseDefaults() throws {
        let settings = try StoreCoding.decoder.decode(AppSettings.self, from: Data("{}".utf8))

        XCTAssertEqual(settings.providers, [])
        XCTAssertNil(settings.activeProviderId)
        XCTAssertEqual(settings.modelParams, ModelParams())
        XCTAssertFalse(settings.requireBiometrics, "biometrics must be opt-in")
        XCTAssertFalse(settings.preferences.memoryEnabled, "memory summarisation must be opt-in")
        XCTAssertFalse(settings.preferences.forceThinkingByDefault, "forced thinking must be opt-in")
    }

    /// Cards exported by other clients carry roles we do not know. Dropping the
    /// message would silently delete part of someone's conversation.
    func testUnknownMessageRoleFallsBackToAssistant() throws {
        let json = Data(#"{"id":"m1","role":"tool","content":"..."}"#.utf8)
        let message = try StoreCoding.decoder.decode(ChatMessage.self, from: json)
        XCTAssertEqual(message.role, .assistant)
        XCTAssertEqual(message.content, "...")
    }

    /// `avatar_emoji` and `vi` and `mp` are the keys the web version writes;
    /// keeping them is what lets a desktop backup import without translation.
    func testWebFieldNamesAreUsedOnDisk() throws {
        let card = CharacterCard(name: "X", avatarEmoji: "🎓")
        let cardJSON = String(decoding: try StoreCoding.encoder.encode(card), as: UTF8.self)
        XCTAssertTrue(cardJSON.contains("\"avatar_emoji\""), cardJSON)

        let message = ChatMessage(role: .assistant, content: "hi")
        let messageJSON = String(decoding: try StoreCoding.encoder.encode(message), as: UTF8.self)
        XCTAssertTrue(messageJSON.contains("\"vi\""), messageJSON)

        let settingsJSON = String(decoding: try StoreCoding.encoder.encode(AppSettings()), as: UTF8.self)
        XCTAssertTrue(settingsJSON.contains("\"mp\""), settingsJSON)
    }

    /// An API key must never reach the JSON, whatever the encoder is handed.
    func testProviderEncodingCarriesNoAPIKeyField() throws {
        let json = String(decoding: try StoreCoding.encoder.encode(Provider(id: "p1", name: "OpenAI")), as: UTF8.self)
        XCTAssertFalse(json.lowercased().contains("apikey"), json)
    }

    // MARK: - Behaviour on the models

    func testDisplayedContentSurvivesOutOfRangeVariantIndex() {
        let message = ChatMessage(id: "m", role: .assistant, content: "actual", variants: ["a", "b"], variantIndex: 7)
        XCTAssertEqual(message.displayedContent, "actual")
    }

    func testApplyingPresetKeepsGlobalInstructions() {
        let current = ModelParams(temperature: 0.8, globalSystem: "Отвечай по-русски")
        let next = current.applying(preset: .creative)

        XCTAssertEqual(next.temperature, ModelParams.creative.temperature)
        XCTAssertEqual(next.contextMessages, ModelParams.creative.contextMessages)
        XCTAssertEqual(next.globalSystem, "Отвечай по-русски", "switching preset must not wipe what the user typed")
    }

    func testActiveProviderFallsBackToFirstWhenIdIsStale() {
        let a = Provider(id: "a", name: "A")
        let b = Provider(id: "b", name: "B")
        var settings = AppSettings(providers: [a, b], activeProviderId: "deleted-long-ago")
        XCTAssertEqual(settings.activeProvider?.id, "a")

        settings.activeProviderId = "b"
        XCTAssertEqual(settings.activeProvider?.id, "b")
    }

    func testDisplayTitleFallsBackToCharacterName() {
        XCTAssertEqual(ChatSession(characterName: "Мия").displayTitle, "Мия")
        XCTAssertEqual(ChatSession(characterName: "Мия", title: "Мия #2").displayTitle, "Мия #2")
    }
}
