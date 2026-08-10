import XCTest
@testable import wesaid

/// Deliberately does not touch `generate()`/`send()` — those go through
/// `ChatCompletionService` and would need the same `StubURLProtocol`
/// plumbing `CharacterWizardControllerTests` uses. `effectiveModel`,
/// `effectiveProvider` and `modelChoices` are plain computed properties with
/// no network involved, so testing them this way keeps the same
/// "no stubbing needed" property `ChatLogicTests` already relies on for the
/// rest of the chat logic.
final class ChatControllerModelSwitchingTests: XCTestCase {

    private func makeController(favorites: [(providerID: String, model: String)] = [],
                                 hasProvider: Bool = true,
                                 secondProvider: Bool = false) async -> ChatController {
        let paths = AppPaths(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let keychain = InMemoryKeychain()
        let characters = CharacterStore(paths: paths, seedOnFirstLaunch: false)
        let chats = ChatStore(paths: paths)
        let settings = SettingsStore(paths: paths, keychain: keychain)
        if hasProvider {
            settings.addProvider(Provider(id: "p1", name: "Test", baseUrl: "https://api.openai.com/v1", model: "gpt-4o"), apiKey: "k")
        }
        if secondProvider {
            settings.addProvider(Provider(id: "p2", name: "Other", baseUrl: "https://api.anthropic.com/v1", model: "claude-opus-4"), apiKey: "k2")
        }
        for favorite in favorites {
            settings.setFavoriteModels(settings.favoriteModels(for: favorite.providerID).union([favorite.model]), for: favorite.providerID)
        }

        let character = CharacterCard(name: "Мия")
        characters.upsert(character)
        let session = chats.create(with: character)
        return await ChatController(chat: session, chatStore: chats, characterStore: characters, settingsStore: settings)
    }

    func testEffectiveModelFallsBackToProviderModelWhenNoOverride() async {
        let controller = await makeController()
        let effective = await controller.effectiveModel
        XCTAssertEqual(effective, "gpt-4o")
    }

    func testEffectiveModelUsesOverrideWhenSet() async {
        let controller = await makeController(favorites: [("p1", "gpt-4o-mini")])
        await MainActor.run { controller.modelOverride = ModelChoice(providerID: "p1", model: "gpt-4o-mini") }
        let effective = await controller.effectiveModel
        XCTAssertEqual(effective, "gpt-4o-mini")
    }

    func testEffectiveModelIsEmptyWithNoActiveProvider() async {
        let controller = await makeController(hasProvider: false)
        let effective = await controller.effectiveModel
        XCTAssertEqual(effective, "")
    }

    func testModelChoicesIncludesProviderDefaultEvenWhenNotFavorited() async {
        let controller = await makeController(favorites: [("p1", "claude-opus-4")])
        let choices = await controller.modelChoices
        XCTAssertEqual(choices, [ModelChoice(providerID: "p1", model: "gpt-4o"), ModelChoice(providerID: "p1", model: "claude-opus-4")])
    }

    func testModelChoicesDoesNotDuplicateProviderDefaultAlreadyFavorited() async {
        let controller = await makeController(favorites: [("p1", "gpt-4o"), ("p1", "claude-opus-4")])
        let choices = await controller.modelChoices
        XCTAssertEqual(choices, [ModelChoice(providerID: "p1", model: "gpt-4o"), ModelChoice(providerID: "p1", model: "claude-opus-4")])
    }

    func testModelChoicesIsEmptyWithNoActiveProvider() async {
        let controller = await makeController(hasProvider: false)
        let choices = await controller.modelChoices
        XCTAssertEqual(choices, [])
    }

    // MARK: - Cross-provider favorites

    func testModelChoicesIncludesFavoritesFromAnInactiveProvider() async {
        let controller = await makeController(favorites: [("p2", "claude-opus-4")], secondProvider: true)
        let choices = await controller.modelChoices
        XCTAssertTrue(choices.contains(ModelChoice(providerID: "p2", model: "claude-opus-4")))
    }

    func testEffectiveProviderSwitchesToTheOverridesOwnProvider() async {
        let controller = await makeController(favorites: [("p2", "claude-opus-4")], secondProvider: true)
        await MainActor.run { controller.modelOverride = ModelChoice(providerID: "p2", model: "claude-opus-4") }
        let provider = await controller.effectiveProvider
        XCTAssertEqual(provider?.id, "p2")
        let effective = await controller.effectiveModel
        XCTAssertEqual(effective, "claude-opus-4")
    }

    func testEffectiveProviderFallsBackToActiveWhenOverridesProviderWasDeleted() async {
        let controller = await makeController(favorites: [("p1", "gpt-4o-mini")])
        await MainActor.run { controller.modelOverride = ModelChoice(providerID: "gone", model: "some-model") }
        let provider = await controller.effectiveProvider
        XCTAssertEqual(provider?.id, "p1")
        // Provider and model must fall back together — otherwise a stale
        // override could pair the active provider's key with a model name
        // that was only ever valid for the since-deleted one.
        let effective = await controller.effectiveModel
        XCTAssertEqual(effective, "gpt-4o")
    }
}
