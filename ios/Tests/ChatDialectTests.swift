import XCTest
@testable import wesaid

/// Request building and SSE-line parsing, tested directly against each
/// dialect with no networking involved — `buildRequest` returns a plain
/// `URLRequest` we can inspect straight away, which sidesteps the well-known
/// pitfall of `URLProtocol` sometimes losing `httpBody` to an internal stream
/// once a real `URLSession` task is involved.
final class ChatDialectTests: XCTestCase {

    private func jsonBody(_ request: URLRequest) -> [String: Any] {
        guard let data = request.httpBody,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            XCTFail("request has no decodable JSON body")
            return [:]
        }
        return obj
    }

    // MARK: - OpenAI-compatible

    func testOpenAIRequestURLTrimsTrailingSlashes() throws {
        let dialect = OpenAICompatibleDialect()
        let req = try dialect.buildRequest(baseURL: "https://api.openai.com/v1/", apiKey: "sk-x",
                                            request: ChatCompletionRequest(messages: []), streaming: true)
        XCTAssertEqual(req.url?.absoluteString, "https://api.openai.com/v1/chat/completions")
    }

    func testOpenAIRequestUsesBearerAuth() throws {
        let dialect = OpenAICompatibleDialect()
        let req = try dialect.buildRequest(baseURL: "https://api.openai.com/v1", apiKey: "sk-secret",
                                            request: ChatCompletionRequest(messages: []), streaming: true)
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer sk-secret")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
    }

    func testOpenAILocalProviderOmitsAuthHeaderWhenKeyEmpty() throws {
        let dialect = OpenAICompatibleDialect()
        let req = try dialect.buildRequest(baseURL: "http://localhost:11434/v1", apiKey: "",
                                            request: ChatCompletionRequest(messages: []), streaming: true)
        XCTAssertNil(req.value(forHTTPHeaderField: "Authorization"))
    }

    func testOpenAIPrependsSystemMessageWhenPresent() throws {
        let dialect = OpenAICompatibleDialect()
        let request = ChatCompletionRequest(
            messages: [UpstreamMessage(role: .user, content: "hi")],
            systemPrompt: "Be nice"
        )
        let req = try dialect.buildRequest(baseURL: "https://api.openai.com/v1", apiKey: "k", request: request, streaming: true)
        let messages = jsonBody(req)["messages"] as? [[String: Any]]
        XCTAssertEqual(messages?.count, 2)
        XCTAssertEqual(messages?.first?["role"] as? String, "system")
        XCTAssertEqual(messages?.first?["content"] as? String, "Be nice")
        XCTAssertEqual(messages?.last?["role"] as? String, "user")
    }

    func testOpenAIOmitsSystemMessageWhenAbsent() throws {
        let dialect = OpenAICompatibleDialect()
        let request = ChatCompletionRequest(messages: [UpstreamMessage(role: .user, content: "hi")])
        let req = try dialect.buildRequest(baseURL: "https://api.openai.com/v1", apiKey: "k", request: request, streaming: true)
        let messages = jsonBody(req)["messages"] as? [[String: Any]]
        XCTAssertEqual(messages?.count, 1)
    }

    func testOpenAIDefaultsModelWhenNilOrEmpty() throws {
        let dialect = OpenAICompatibleDialect()
        for model in [nil, ""] {
            let request = ChatCompletionRequest(messages: [], model: model)
            let req = try dialect.buildRequest(baseURL: "https://api.openai.com/v1", apiKey: "k", request: request, streaming: true)
            XCTAssertEqual(jsonBody(req)["model"] as? String, "gpt-4o-mini")
        }
    }

    func testOpenAIMaxTokensDefaultsAndCaps() throws {
        let dialect = OpenAICompatibleDialect()
        let noTokens = ChatCompletionRequest(messages: [])
        let reqDefault = try dialect.buildRequest(baseURL: "https://api.openai.com/v1", apiKey: "k", request: noTokens, streaming: true)
        XCTAssertEqual(jsonBody(reqDefault)["max_tokens"] as? Int, 2048)

        let huge = ChatCompletionRequest(messages: [], maxTokens: 999_999)
        let reqCapped = try dialect.buildRequest(baseURL: "https://api.openai.com/v1", apiKey: "k", request: huge, streaming: true)
        XCTAssertEqual(jsonBody(reqCapped)["max_tokens"] as? Int, 16384)
    }

    func testOpenAIStreamFlagMatchesParameter() throws {
        let dialect = OpenAICompatibleDialect()
        let request = ChatCompletionRequest(messages: [])
        let streaming = try dialect.buildRequest(baseURL: "https://api.openai.com/v1", apiKey: "k", request: request, streaming: true)
        let notStreaming = try dialect.buildRequest(baseURL: "https://api.openai.com/v1", apiKey: "k", request: request, streaming: false)
        XCTAssertEqual(jsonBody(streaming)["stream"] as? Bool, true)
        XCTAssertEqual(jsonBody(notStreaming)["stream"] as? Bool, false)
    }

    func testOpenAIParsesDeltaContent() {
        let dialect = OpenAICompatibleDialect()
        let line = #"data: {"choices":[{"delta":{"content":"Hi"}}]}"#
        XCTAssertEqual(dialect.parseSSELine(line), [.delta("Hi")])
    }

    func testOpenAIIgnoresDoneMarker() {
        let dialect = OpenAICompatibleDialect()
        XCTAssertEqual(dialect.parseSSELine("data: [DONE]"), [])
    }

    func testOpenAIIgnoresNonDataAndEmptyDeltaLines() {
        let dialect = OpenAICompatibleDialect()
        XCTAssertEqual(dialect.parseSSELine(""), [])
        XCTAssertEqual(dialect.parseSSELine("event: ping"), [])
        XCTAssertEqual(dialect.parseSSELine(#"data: {"choices":[{"delta":{}}]}"#), [])
    }

    // MARK: - Anthropic

    func testAnthropicRequestURLAndHeaders() throws {
        let dialect = AnthropicDialect()
        let req = try dialect.buildRequest(baseURL: "https://api.anthropic.com/v1", apiKey: "sk-ant",
                                            request: ChatCompletionRequest(messages: []), streaming: true)
        XCTAssertEqual(req.url?.absoluteString, "https://api.anthropic.com/v1/messages")
        XCTAssertEqual(req.value(forHTTPHeaderField: "x-api-key"), "sk-ant")
        XCTAssertEqual(req.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
        XCTAssertNil(req.value(forHTTPHeaderField: "Authorization"), "Anthropic must not get a Bearer header")
    }

    func testAnthropicMovesSystemPromptOutOfMessages() throws {
        let dialect = AnthropicDialect()
        let request = ChatCompletionRequest(
            messages: [UpstreamMessage(role: .system, content: "leftover"), UpstreamMessage(role: .user, content: "hi")],
            systemPrompt: "Be nice"
        )
        let req = try dialect.buildRequest(baseURL: "https://api.anthropic.com/v1", apiKey: "k", request: request, streaming: true)
        let body = jsonBody(req)
        XCTAssertEqual(body["system"] as? String, "Be nice")
        let messages = body["messages"] as? [[String: Any]]
        XCTAssertEqual(messages?.count, 1, "a system-role message must never reach the messages array")
        XCTAssertEqual(messages?.first?["role"] as? String, "user")
    }

    func testAnthropicAlwaysSetsMaxTokens() throws {
        let dialect = AnthropicDialect()
        let req = try dialect.buildRequest(baseURL: "https://api.anthropic.com/v1", apiKey: "k",
                                            request: ChatCompletionRequest(messages: []), streaming: true)
        XCTAssertEqual(jsonBody(req)["max_tokens"] as? Int, 2048, "Anthropic requires max_tokens even with no explicit value")
    }

    func testAnthropicCapsTemperatureAtOne() throws {
        let dialect = AnthropicDialect()
        let request = ChatCompletionRequest(messages: [], temperature: 1.7)
        let req = try dialect.buildRequest(baseURL: "https://api.anthropic.com/v1", apiKey: "k", request: request, streaming: true)
        XCTAssertEqual(jsonBody(req)["temperature"] as? Double, 1)
    }

    func testAnthropicDefaultsModel() throws {
        let dialect = AnthropicDialect()
        let req = try dialect.buildRequest(baseURL: "https://api.anthropic.com/v1", apiKey: "k",
                                            request: ChatCompletionRequest(messages: []), streaming: true)
        XCTAssertEqual(jsonBody(req)["model"] as? String, "claude-sonnet-5")
    }

    func testAnthropicParsesContentBlockDelta() {
        let dialect = AnthropicDialect()
        let line = #"data: {"type":"content_block_delta","delta":{"text":"Hi"}}"#
        XCTAssertEqual(dialect.parseSSELine(line), [.delta("Hi")])
    }

    func testAnthropicMessageStopMeansDone() {
        let dialect = AnthropicDialect()
        XCTAssertEqual(dialect.parseSSELine(#"data: {"type":"message_stop"}"#), [.done])
    }

    func testAnthropicErrorEventCarriesMessage() {
        let dialect = AnthropicDialect()
        let line = #"data: {"type":"error","error":{"message":"overloaded"}}"#
        XCTAssertEqual(dialect.parseSSELine(line), [.error("overloaded")])
    }

    func testAnthropicErrorEventFallsBackToDefaultMessage() {
        let dialect = AnthropicDialect()
        let line = #"data: {"type":"error"}"#
        XCTAssertEqual(dialect.parseSSELine(line), [.error("Ошибка Anthropic")])
    }

    func testAnthropicIgnoresUnknownEventTypes() {
        let dialect = AnthropicDialect()
        XCTAssertEqual(dialect.parseSSELine(#"data: {"type":"message_start"}"#), [])
        XCTAssertEqual(dialect.parseSSELine(#"data: {"type":"ping"}"#), [])
    }

    // MARK: - Host classification (used to pick a dialect)

    func testAnthropicHostClassification() {
        XCTAssertTrue(ChatCompletionService.isAnthropicHost("api.anthropic.com"))
        XCTAssertTrue(ChatCompletionService.isAnthropicHost("Anthropic.com"))
        XCTAssertFalse(ChatCompletionService.isAnthropicHost("notanthropic.com"))
        XCTAssertFalse(ChatCompletionService.isAnthropicHost("anthropic.com.evil.example"))
    }

    func testLocalHostClassification() {
        for host in ["localhost", "127.0.0.1", "127.5.5.5", "0.0.0.0", "::1", "[::1]"] {
            XCTAssertTrue(ChatCompletionService.isLocalHost(host), host)
        }
        for host in ["api.openai.com", "192.168.1.5", "example.com"] {
            XCTAssertFalse(ChatCompletionService.isLocalHost(host), host)
        }
    }

    // MARK: - Completion text extraction

    func testExtractsOpenAIShapedCompletion() {
        let json = #"{"choices":[{"message":{"content":"answer"}}]}"#
        XCTAssertEqual(ChatCompletionService.extractCompletionText(from: Data(json.utf8)), "answer")
    }

    func testExtractsAnthropicShapedCompletion() {
        let json = #"{"content":[{"type":"text","text":"foo"},{"type":"text","text":"bar"}]}"#
        XCTAssertEqual(ChatCompletionService.extractCompletionText(from: Data(json.utf8)), "foobar")
    }

    func testExtractionFallsBackToEmptyStringForUnknownShape() {
        XCTAssertEqual(ChatCompletionService.extractCompletionText(from: Data(#"{"weird":true}"#.utf8)), "")
        XCTAssertEqual(ChatCompletionService.extractCompletionText(from: Data("not json".utf8)), "")
    }

    // MARK: - Validation

    func testValidateRejectsEmptyOrNonHTTPBaseURL() {
        let service = ChatCompletionService()
        XCTAssertThrowsError(try service.validate(baseURL: "", apiKey: "k")) {
            XCTAssertEqual($0 as? ChatServiceError, .badURL)
        }
        XCTAssertThrowsError(try service.validate(baseURL: "ftp://example.com", apiKey: "k")) {
            XCTAssertEqual($0 as? ChatServiceError, .badURL)
        }
    }

    func testValidateRequiresKeyForRemoteHost() {
        let service = ChatCompletionService()
        XCTAssertThrowsError(try service.validate(baseURL: "https://api.openai.com/v1", apiKey: "")) {
            XCTAssertEqual($0 as? ChatServiceError, .noKey)
        }
    }

    func testValidateAllowsEmptyKeyForLocalHost() throws {
        let service = ChatCompletionService()
        XCTAssertNoThrow(try service.validate(baseURL: "http://localhost:11434/v1", apiKey: ""))
        XCTAssertNoThrow(try service.validate(baseURL: "http://127.0.0.1:1234/v1", apiKey: ""))
    }
}
