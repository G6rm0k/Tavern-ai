import XCTest
@testable import wesaid

/// Every test method is `async`, and the class itself is deliberately *not*
/// `@MainActor` — same reasoning as `AppLockControllerTests`. Mixing that
/// class-level annotation with a helper closure invoked off the main thread
/// (`StubURLProtocol.requestHandler` fires from URLSession's own delivery
/// queue, not the main actor) produced wrong results here rather than an
/// outright crash: `stubReply` needing a `self` isolated to the main actor,
/// called from a non-isolated context, silently never ran as expected.
/// Making it a plain `static func` with no `self` sidesteps the whole class
/// of problem, and touching `CharacterWizardController`'s `@MainActor`
/// state now goes through explicit `await` everywhere, same as production
/// code calling into it would.
final class CharacterWizardControllerTests: XCTestCase {

    override func tearDown() {
        StubURLProtocol.requestHandler = nil
        super.tearDown()
    }

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

    private func makeController(withProvider: Bool = true,
                                 onApply: @escaping (CharacterWizardController.Field, String) -> Void = { _, _ in }) async -> CharacterWizardController {
        await CharacterWizardController(
            settingsStore: makeSettingsStore(withProvider: withProvider),
            completionService: ChatCompletionService(session: StubURLProtocol.session()),
            onApply: onApply
        )
    }

    private static func stubReply(_ content: String) -> StubURLProtocol.Stub {
        let escaped = content
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"choices":[{"message":{"content":"\#(escaped)"}}]}"#.utf8)])
    }

    // MARK: - Initial state

    func testStartsWithAGreetingMessage() async {
        let controller = await makeController()
        let messages = await controller.messages
        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].sender, .bot)
        let isDone = await controller.isDone
        XCTAssertFalse(isDone)
        let pendingProposal = await controller.pendingProposal
        XCTAssertNil(pendingProposal)
    }

    // MARK: - send()

    func testSendIgnoresBlankInput() async {
        StubURLProtocol.requestHandler = { _ in
            XCTFail("must not make a network call for blank input")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [])
        }
        let controller = await makeController()
        await MainActor.run { controller.draftInputText = "   " }
        await controller.send()
        let messages = await controller.messages
        XCTAssertEqual(messages.count, 1, "no user message should have been added")
    }

    func testSendWithoutAnActiveProviderSetsAnErrorMessage() async {
        let controller = await makeController(withProvider: false)
        await MainActor.run { controller.draftInputText = "Хочу персонажа" }
        await controller.send()
        let errorMessage = await controller.errorMessage
        XCTAssertEqual(errorMessage, "Нет активного провайдера. Настрой API в настройках.")
    }

    // MARK: - Proposal flow

    func testProposalIsParsedAndExplanationShown() async {
        StubURLProtocol.requestHandler = { _ in
            Self.stubReply(#"{"action":"propose","field":"name","value":"Рэйк","explanation":"Звучит по-пиратски"}"#)
        }
        let controller = await makeController()

        await MainActor.run { controller.draftInputText = "Пират" }
        await controller.send()

        let proposal = await controller.pendingProposal
        XCTAssertEqual(proposal?.field, .name)
        XCTAssertEqual(proposal?.value, "Рэйк")
        let messages = await controller.messages
        XCTAssertTrue(messages.contains { $0.text.contains("Звучит по-пиратски") })
    }

    func testAcceptAppliesTheFieldAndClearsTheProposal() async {
        StubURLProtocol.requestHandler = { _ in
            Self.stubReply(#"{"action":"propose","field":"description","value":"Пиратский капитан","explanation":""}"#)
        }
        let box = AppliedBox()
        let controller = await makeController { field, value in box.items.append((field, value)) }

        await MainActor.run { controller.draftInputText = "Пират" }
        await controller.send()
        let proposalBeforeAccept = await controller.pendingProposal
        XCTAssertNotNil(proposalBeforeAccept)

        StubURLProtocol.requestHandler = { _ in Self.stubReply(#"{"action":"done","message":"Готово!"}"#) }
        await controller.accept()

        XCTAssertEqual(box.items.count, 1)
        XCTAssertEqual(box.items.first?.0, .description)
        XCTAssertEqual(box.items.first?.1, "Пиратский капитан")
        let proposalAfterAccept = await controller.pendingProposal
        XCTAssertNil(proposalAfterAccept)
        let isDone = await controller.isDone
        XCTAssertTrue(isDone)
    }

    func testRejectDoesNotApplyTheField() async {
        StubURLProtocol.requestHandler = { _ in
            Self.stubReply(#"{"action":"propose","field":"name","value":"Рэйк","explanation":""}"#)
        }
        let box = AppliedBox()
        let controller = await makeController { field, value in box.items.append((field, value)) }

        await MainActor.run { controller.draftInputText = "Пират" }
        await controller.send()

        StubURLProtocol.requestHandler = { _ in Self.stubReply("Хорошо, предложу другое имя.") }
        await controller.reject()

        XCTAssertTrue(box.items.isEmpty, "rejecting a proposal must never call onApply")
        let proposal = await controller.pendingProposal
        XCTAssertNil(proposal)
    }

    func testEditingAProposalThenSendingAppliesTheHandTypedValue() async {
        StubURLProtocol.requestHandler = { _ in
            Self.stubReply(#"{"action":"propose","field":"name","value":"Рэйк","explanation":""}"#)
        }
        let box = AppliedBox()
        let controller = await makeController { field, value in box.items.append((field, value)) }

        await MainActor.run { controller.draftInputText = "Пират" }
        await controller.send()

        await MainActor.run { controller.beginEditingProposal() }
        let draftAfterEditStart = await controller.draftInputText
        XCTAssertEqual(draftAfterEditStart, "Рэйк")
        await MainActor.run { controller.draftInputText = "Капитан Морган" }

        StubURLProtocol.requestHandler = { _ in Self.stubReply(#"{"action":"done","message":"Готово!"}"#) }
        await controller.send()

        XCTAssertEqual(box.items.count, 1)
        XCTAssertEqual(box.items.first?.0, .name)
        XCTAssertEqual(box.items.first?.1, "Капитан Морган")
    }

    // MARK: - Plain chat / malformed responses

    func testPlainTextReplyIsShownAsIsWithoutAProposal() async {
        StubURLProtocol.requestHandler = { _ in Self.stubReply("Какой персонаж тебе нужен?") }
        let controller = await makeController()

        await MainActor.run { controller.draftInputText = "Привет" }
        await controller.send()

        let proposal = await controller.pendingProposal
        XCTAssertNil(proposal)
        let messages = await controller.messages
        XCTAssertTrue(messages.contains { $0.text == "Какой персонаж тебе нужен?" })
    }

    func testMalformedJSONWithoutAnActionKeyFallsBackToPlainText() async {
        StubURLProtocol.requestHandler = { _ in Self.stubReply(#"Вот пример: {"foo":"bar"}"#) }
        let controller = await makeController()

        await MainActor.run { controller.draftInputText = "Привет" }
        await controller.send()

        let proposal = await controller.pendingProposal
        XCTAssertNil(proposal)
        let messages = await controller.messages
        XCTAssertTrue(messages.contains { $0.text.contains("Вот пример") })
    }
}
