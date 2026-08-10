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
/// of problem.
///
/// This suite went through two other wrong diagnoses before the real one.
/// It reliably failed a handful of assertions — `pendingProposal` reading
/// nil right where a test expected the proposal `ask()` had just parsed —
/// even under `-retry-tests-on-failure -test-iterations 3`, which reruns a
/// failure from a completely fresh controller/session and still failed
/// every time (ruling out simulator/CI restart flakiness) and *also*
/// survived routing every read through an explicit `MainActor.run` instead
/// of a bare `await controller.property` (ruling out an actor-hop race).
/// Diagnostics on the failing assertions (`controller.errorMessage`) showed
/// the real cause: `ask()` was genuinely failing `validate(baseURL:apiKey:)`
/// with "no API key", because the real Keychain — `KeychainService`,
/// `Security.framework` underneath — was intermittently returning nothing
/// for a key `addProvider` had just written moments earlier in the same
/// test. That is a property of running an *unsigned* test host against the
/// real Keychain on this CI runner, nothing to do with this controller or
/// with how the test reads its state. `makeSettingsStore` now wires up
/// `InMemoryKeychain` instead (see `KeychainServicing`), which sidesteps
/// `Security.framework` entirely.
///
/// `read { }` (an explicit `MainActor.run`, kept from the actor-hop
/// hypothesis) is harmless and still used below for every property read —
/// no reason to revert it now that the real cause is fixed.
final class CharacterWizardControllerTests: XCTestCase {

    override func tearDown() async throws {
        StubURLProtocol.requestHandler = nil
        try await super.tearDown()
    }

    @discardableResult
    private func read<T>(_ body: @escaping @MainActor () -> T) async -> T {
        await MainActor.run(body: body)
    }

    private final class AppliedBox {
        var items: [(CharacterWizardController.Field, String)] = []
    }

    private func makeSettingsStore(withProvider: Bool) -> SettingsStore {
        let paths = AppPaths(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let keychain = InMemoryKeychain()
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
        let messages = await read { controller.messages }
        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].sender, .bot)
        let isDone = await read { controller.isDone }
        XCTAssertFalse(isDone)
        let pendingProposal = await read { controller.pendingProposal }
        XCTAssertNil(pendingProposal)
    }

    // MARK: - Model choices (no network — same "pure computed property" shape
    // as ChatControllerModelSwitchingTests)

    func testEffectiveModelFallsBackToActiveProviderModel() async {
        let controller = await makeController()
        let effective = await read { controller.effectiveModel }
        XCTAssertEqual(effective, "gpt-4o")
    }

    func testModelOverrideSwitchesToTheOverridesOwnProvider() async {
        let store = makeSettingsStore(withProvider: true)
        store.addProvider(Provider(id: "p2", name: "Other", baseUrl: "https://api.anthropic.com/v1", model: "claude-opus-4"), apiKey: "k2")
        let controller = await CharacterWizardController(settingsStore: store, onApply: { _, _ in })
        await MainActor.run { controller.modelOverride = ModelChoice(providerID: "p2", model: "claude-opus-4") }
        let provider = await read { controller.effectiveProvider }
        XCTAssertEqual(provider?.id, "p2")
        let effective = await read { controller.effectiveModel }
        XCTAssertEqual(effective, "claude-opus-4")
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
        let messages = await read { controller.messages }
        XCTAssertEqual(messages.count, 1, "no user message should have been added")
    }

    func testSendWithoutAnActiveProviderSetsAnErrorMessage() async {
        let controller = await makeController(withProvider: false)
        await MainActor.run { controller.draftInputText = "Хочу персонажа" }
        await controller.send()
        let errorMessage = await read { controller.errorMessage }
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

        let proposal = await read { controller.pendingProposal }
        let diagError = await read { controller.errorMessage }
        let diagMessages = await read { controller.messages.map(\.text) }
        XCTAssertEqual(proposal?.field, .name, "error=\(diagError ?? "nil") messages=\(diagMessages)")
        XCTAssertEqual(proposal?.value, "Рэйк")
        let messages = await read { controller.messages }
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
        let proposalBeforeAccept = await read { controller.pendingProposal }
        let diag1Error = await read { controller.errorMessage }
        let diag1Messages = await read { controller.messages.map(\.text) }
        let diag1IsThinking = await read { controller.isThinking }
        XCTAssertNotNil(proposalBeforeAccept, "error=\(diag1Error ?? "nil") isThinking=\(diag1IsThinking) messages=\(diag1Messages)")

        StubURLProtocol.requestHandler = { _ in Self.stubReply(#"{"action":"done","message":"Готово!"}"#) }
        await controller.accept()

        XCTAssertEqual(box.items.count, 1)
        XCTAssertEqual(box.items.first?.0, .description)
        XCTAssertEqual(box.items.first?.1, "Пиратский капитан")
        let proposalAfterAccept = await read { controller.pendingProposal }
        XCTAssertNil(proposalAfterAccept)
        let isDone = await read { controller.isDone }
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
        let proposal = await read { controller.pendingProposal }
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
        let draftAfterEditStart = await read { controller.draftInputText }
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

        let proposal = await read { controller.pendingProposal }
        XCTAssertNil(proposal)
        let messages = await read { controller.messages }
        let diagError = await read { controller.errorMessage }
        XCTAssertTrue(messages.contains { $0.text == "Какой персонаж тебе нужен?" },
                       "error=\(diagError ?? "nil") messages=\(messages.map(\.text))")
    }

    func testMalformedJSONWithoutAnActionKeyFallsBackToPlainText() async {
        StubURLProtocol.requestHandler = { _ in Self.stubReply(#"Вот пример: {"foo":"bar"}"#) }
        let controller = await makeController()

        await MainActor.run { controller.draftInputText = "Привет" }
        await controller.send()

        let proposal = await read { controller.pendingProposal }
        XCTAssertNil(proposal)
        let messages = await read { controller.messages }
        let diagError = await read { controller.errorMessage }
        XCTAssertTrue(messages.contains { $0.text.contains("Вот пример") },
                       "error=\(diagError ?? "nil") messages=\(messages.map(\.text))")
    }
}
