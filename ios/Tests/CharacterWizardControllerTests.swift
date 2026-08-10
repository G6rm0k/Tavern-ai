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
/// Every read of `controller`'s `@MainActor` state goes through `read { }`
/// (an explicit `MainActor.run`), not a bare `await controller.property`.
/// The two look equivalent, but on this toolchain they were not: with a bare
/// read, this whole suite failed the same handful of assertions on every run
/// — including under `-retry-tests-on-failure -test-iterations 3`, which
/// reran each failure 3 times from a completely fresh controller/session and
/// still failed every time — always a value that read as nil (or empty)
/// immediately after the call that was supposed to set it, while a *second*
/// read moments later (inside `accept()`'s own guard, on the actor itself)
/// saw the correct value. That an all-retries-fail pattern with fresh state
/// each time survived was the tell that this was never simulator/CI
/// flakiness (already ruled out separately) — it was specifically the
/// implicit hop-and-read from a nonisolated `async` context racing the
/// write. Routing every read through the same explicit-hop shape already
/// proven reliable for writes (`await MainActor.run { controller.x = ... }`,
/// used below and in `AppLockControllerTests`) removes that race instead of
/// working around it.
final class CharacterWizardControllerTests: XCTestCase {

    override func tearDown() async throws {
        StubURLProtocol.requestHandler = nil
        try await super.tearDown()
    }

    @discardableResult
    private func read<T>(_ body: @escaping @MainActor () -> T) async -> T {
        await MainActor.run(body)
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
        let messages = await read { controller.messages }
        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].sender, .bot)
        let isDone = await read { controller.isDone }
        XCTAssertFalse(isDone)
        let pendingProposal = await read { controller.pendingProposal }
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
        XCTAssertEqual(proposal?.field, .name)
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
        XCTAssertNotNil(proposalBeforeAccept)

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
        XCTAssertTrue(messages.contains { $0.text == "Какой персонаж тебе нужен?" })
    }

    func testMalformedJSONWithoutAnActionKeyFallsBackToPlainText() async {
        StubURLProtocol.requestHandler = { _ in Self.stubReply(#"Вот пример: {"foo":"bar"}"#) }
        let controller = await makeController()

        await MainActor.run { controller.draftInputText = "Привет" }
        await controller.send()

        let proposal = await read { controller.pendingProposal }
        XCTAssertNil(proposal)
        let messages = await read { controller.messages }
        XCTAssertTrue(messages.contains { $0.text.contains("Вот пример") })
    }
}
