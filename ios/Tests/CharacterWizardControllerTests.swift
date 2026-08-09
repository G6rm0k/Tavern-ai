import XCTest
@testable import wesaid

@MainActor
final class CharacterWizardControllerTests: XCTestCase {

    override func tearDown() {
        StubURLProtocol.requestHandler = nil
        super.tearDown()
    }

    /// A reference box so the `onApply` closure's captures survive being
    /// handed back out — the test needs to read what was applied after the
    /// fact, not just at closure-creation time.
    private final class AppliedBox {
        var items: [(CharacterWizardController.Field, String)] = []
    }

    private func makeSettingsStore(withProvider: Bool) -> SettingsStore {
        let paths = AppPaths(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let keychain = KeychainService(service: "app.wesaid.tests.\(UUID().uuidString)")
        let store = SettingsStore(paths: paths, keychain: keychain)
        if withProvider {
            store.addProvider(Provider(id: "p1", name: "Test", baseUrl: "https://api.openai.com/v1", model: "gpt-4o"), apiKey: "test-key")
        }
        return store
    }

    private func makeController(withProvider: Bool = true, onApply: @escaping (CharacterWizardController.Field, String) -> Void = { _, _ in }) -> CharacterWizardController {
        CharacterWizardController(
            settingsStore: makeSettingsStore(withProvider: withProvider),
            completionService: ChatCompletionService(session: StubURLProtocol.session()),
            onApply: onApply
        )
    }

    private func stubReply(_ content: String) -> StubURLProtocol.Stub {
        let escaped = content
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"choices":[{"message":{"content":"\#(escaped)"}}]}"#.utf8)])
    }

    // MARK: - Initial state

    func testStartsWithAGreetingMessage() {
        let controller = makeController()
        XCTAssertEqual(controller.messages.count, 1)
        XCTAssertEqual(controller.messages[0].sender, .bot)
        XCTAssertFalse(controller.isDone)
        XCTAssertNil(controller.pendingProposal)
    }

    // MARK: - send()

    func testSendIgnoresBlankInput() async {
        StubURLProtocol.requestHandler = { _ in
            XCTFail("must not make a network call for blank input")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [])
        }
        let controller = makeController()
        controller.draftInputText = "   "
        await controller.send()
        XCTAssertEqual(controller.messages.count, 1, "no user message should have been added")
    }

    func testSendWithoutAnActiveProviderSetsAnErrorMessage() async {
        let controller = makeController(withProvider: false)
        controller.draftInputText = "Хочу персонажа"
        await controller.send()
        XCTAssertEqual(controller.errorMessage, "Нет активного провайдера. Настрой API в настройках.")
    }

    // MARK: - Proposal flow

    func testProposalIsParsedAndExplanationShown() async {
        StubURLProtocol.requestHandler = { _ in
            self.stubReply(#"{"action":"propose","field":"name","value":"Рэйк","explanation":"Звучит по-пиратски"}"#)
        }
        let controller = makeController()

        controller.draftInputText = "Пират"
        await controller.send()

        XCTAssertEqual(controller.pendingProposal?.field, .name)
        XCTAssertEqual(controller.pendingProposal?.value, "Рэйк")
        XCTAssertTrue(controller.messages.contains { $0.text.contains("Звучит по-пиратски") })
    }

    func testAcceptAppliesTheFieldAndClearsTheProposal() async {
        StubURLProtocol.requestHandler = { _ in
            self.stubReply(#"{"action":"propose","field":"description","value":"Пиратский капитан","explanation":""}"#)
        }
        let box = AppliedBox()
        let controller = makeController { field, value in box.items.append((field, value)) }

        controller.draftInputText = "Пират"
        await controller.send()
        XCTAssertNotNil(controller.pendingProposal)

        StubURLProtocol.requestHandler = { _ in self.stubReply(#"{"action":"done","message":"Готово!"}"#) }
        await controller.accept()

        XCTAssertEqual(box.items.count, 1)
        XCTAssertEqual(box.items.first?.0, .description)
        XCTAssertEqual(box.items.first?.1, "Пиратский капитан")
        XCTAssertNil(controller.pendingProposal)
        XCTAssertTrue(controller.isDone)
    }

    func testRejectDoesNotApplyTheField() async {
        StubURLProtocol.requestHandler = { _ in
            self.stubReply(#"{"action":"propose","field":"name","value":"Рэйк","explanation":""}"#)
        }
        let box = AppliedBox()
        let controller = makeController { field, value in box.items.append((field, value)) }

        controller.draftInputText = "Пират"
        await controller.send()

        StubURLProtocol.requestHandler = { _ in self.stubReply("Хорошо, предложу другое имя.") }
        await controller.reject()

        XCTAssertTrue(box.items.isEmpty, "rejecting a proposal must never call onApply")
        XCTAssertNil(controller.pendingProposal)
    }

    func testEditingAProposalThenSendingAppliesTheHandTypedValue() async {
        StubURLProtocol.requestHandler = { _ in
            self.stubReply(#"{"action":"propose","field":"name","value":"Рэйк","explanation":""}"#)
        }
        let box = AppliedBox()
        let controller = makeController { field, value in box.items.append((field, value)) }

        controller.draftInputText = "Пират"
        await controller.send()

        controller.beginEditingProposal()
        XCTAssertEqual(controller.draftInputText, "Рэйк")
        controller.draftInputText = "Капитан Морган"

        StubURLProtocol.requestHandler = { _ in self.stubReply(#"{"action":"done","message":"Готово!"}"#) }
        await controller.send()

        XCTAssertEqual(box.items.count, 1)
        XCTAssertEqual(box.items.first?.0, .name)
        XCTAssertEqual(box.items.first?.1, "Капитан Морган")
    }

    // MARK: - Plain chat / malformed responses

    func testPlainTextReplyIsShownAsIsWithoutAProposal() async {
        StubURLProtocol.requestHandler = { _ in self.stubReply("Какой персонаж тебе нужен?") }
        let controller = makeController()

        controller.draftInputText = "Привет"
        await controller.send()

        XCTAssertNil(controller.pendingProposal)
        XCTAssertTrue(controller.messages.contains { $0.text == "Какой персонаж тебе нужен?" })
    }

    func testMalformedJSONWithoutAnActionKeyFallsBackToPlainText() async {
        StubURLProtocol.requestHandler = { _ in self.stubReply(#"Вот пример: {"foo":"bar"}"#) }
        let controller = makeController()

        controller.draftInputText = "Привет"
        await controller.send()

        XCTAssertNil(controller.pendingProposal)
        XCTAssertTrue(controller.messages.contains { $0.text.contains("Вот пример") })
    }
}
