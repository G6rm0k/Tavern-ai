import XCTest
@testable import wesaid

/// Deliberately does not touch `generate()`/`send()` — those go through
/// `ChatCompletionService` and would need the same `StubURLProtocol`
/// plumbing `CharacterWizardControllerTests` uses. `effectiveModel` and
/// `modelChoices` are plain computed properties with no network involved,
/// so testing them this way keeps the same "no stubbing needed" property
/// `ChatLogicTests` already relies on for the rest of the chat logic.
final class ChatControllerModelSwitchingTests: XCTestCase {

    private func makeController(favoriteModels: [String] = [], hasProvider: Bool = true) async -> ChatController {
        let paths = AppPaths(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let keychain = KeychainService(service: "app.wesaid.tests.\(UUID().uuidString)")
        let characters = CharacterStore(paths: paths, seedOnFirstLaunch: false)
        let chats = ChatStore(paths: paths)
        let settings = SettingsStore(paths: paths, keychain: keychain)
        if hasProvider {
            settings.addProvider(
                Provider(id: "p1", name: "Test", baseUrl: "https://api.openai.com/v1", model: "gpt-4o", favoriteModels: favoriteModels),
                apiKey: "k"
            )
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
        let controller = await makeController(favoriteModels: ["gpt-4o-mini"])
        await controller.modelOverride = "gpt-4o-mini"
        let effective = await controller.effectiveModel
        XCTAssertEqual(effective, "gpt-4o-mini")
    }

    func testEffectiveModelIsEmptyWithNoActiveProvider() async {
        let controller = await makeController(hasProvider: false)
        let effective = await controller.effectiveModel
        XCTAssertEqual(effective, "")
    }

    func testModelChoicesIncludesProviderDefaultEvenWhenNotFavorited() async {
        let controller = await makeController(favoriteModels: ["claude-opus-4"])
        let choices = await controller.modelChoices
        XCTAssertEqual(choices, ["gpt-4o", "claude-opus-4"])
    }

    func testModelChoicesDoesNotDuplicateProviderDefaultAlreadyFavorited() async {
        let controller = await makeController(favoriteModels: ["gpt-4o", "claude-opus-4"])
        let choices = await controller.modelChoices
        XCTAssertEqual(choices, ["gpt-4o", "claude-opus-4"])
    }

    func testModelChoicesIsEmptyWithNoActiveProvider() async {
        let controller = await makeController(hasProvider: false)
        let choices = await controller.modelChoices
        XCTAssertEqual(choices, [])
    }
}
