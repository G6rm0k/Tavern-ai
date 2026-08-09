import XCTest
@testable import wesaid

/// End-to-end tests through a real `URLSession` backed by `StubURLProtocol` —
/// these exercise dialect selection, SSE consumption via
/// `URLSession.bytes(for:).lines`, and status-code handling together, the
/// way a real streamed reply actually flows.
final class ChatCompletionServiceTests: XCTestCase {

    override func tearDown() {
        StubURLProtocol.requestHandler = nil
        super.tearDown()
    }

    private func service() -> ChatCompletionService {
        ChatCompletionService(session: StubURLProtocol.session())
    }

    // MARK: - Streaming

    func testStreamDeltasConcatenatesOpenAIChunksWithoutExplicitDone() async throws {
        StubURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.openai.com/v1/chat/completions")
            return StubURLProtocol.Stub(statusCode: 200, chunks: sseChunks([
                #"{"choices":[{"delta":{"content":"Hel"}}]}"#,
                #"{"choices":[{"delta":{"content":"lo"}}]}"#
            ]))
            // Deliberately no [DONE] and no didFailWithError — the connection
            // just ends, which must be treated as a normal, successful finish.
        }

        var received = ""
        try await service().streamDeltas(
            request: ChatCompletionRequest(messages: [UpstreamMessage(role: .user, content: "hi")]),
            baseURL: "https://api.openai.com/v1",
            apiKey: "sk-x",
            onDelta: { received += $0 }
        )
        XCTAssertEqual(received, "Hello")
    }

    func testStreamDeltasStopsAtAnthropicMessageStop() async throws {
        StubURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.anthropic.com/v1/messages")
            return StubURLProtocol.Stub(statusCode: 200, chunks: sseChunks([
                #"{"type":"content_block_delta","delta":{"text":"Hi"}}"#,
                #"{"type":"message_stop"}"#,
                #"{"type":"content_block_delta","delta":{"text":"SHOULD NOT APPEAR"}}"#
            ]))
        }

        var received = ""
        try await service().streamDeltas(
            request: ChatCompletionRequest(messages: [UpstreamMessage(role: .user, content: "hi")]),
            baseURL: "https://api.anthropic.com/v1",
            apiKey: "sk-ant",
            onDelta: { received += $0 }
        )
        XCTAssertEqual(received, "Hi")
    }

    func testStreamDeltasThrowsOnAnthropicErrorEventButKeepsPartialText() async {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: sseChunks([
                #"{"type":"content_block_delta","delta":{"text":"partial"}}"#,
                #"{"type":"error","error":{"message":"overloaded"}}"#
            ]))
        }

        var received = ""
        do {
            try await service().streamDeltas(
                request: ChatCompletionRequest(messages: []),
                baseURL: "https://api.anthropic.com/v1",
                apiKey: "sk-ant",
                onDelta: { received += $0 }
            )
            XCTFail("expected an error to be thrown")
        } catch let error as ChatServiceError {
            guard case .httpError(_, let body) = error else {
                return XCTFail("expected .httpError, got \(error)")
            }
            XCTAssertEqual(body, "overloaded")
        } catch {
            XCTFail("wrong error type: \(error)")
        }
        XCTAssertEqual(received, "partial", "text streamed before the error must not be discarded")
    }

    func testStreamDeltasThrowsHTTPErrorWithBodyOnNon2xxStatus() async {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 401, chunks: [Data(#"{"error":"invalid api key"}"#.utf8)])
        }

        do {
            try await service().streamDeltas(
                request: ChatCompletionRequest(messages: []),
                baseURL: "https://api.openai.com/v1",
                apiKey: "sk-bad",
                onDelta: { _ in XCTFail("must not deliver deltas from an error response") }
            )
            XCTFail("expected an error to be thrown")
        } catch let error as ChatServiceError {
            guard case .httpError(let status, let body) = error else {
                return XCTFail("expected .httpError, got \(error)")
            }
            XCTAssertEqual(status, 401)
            XCTAssertTrue(body.contains("invalid api key"), body)
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }

    func testStreamDeltasFailsValidationBeforeTouchingTheNetwork() async {
        StubURLProtocol.requestHandler = { _ in
            XCTFail("must not reach the network when validation fails")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [])
        }
        do {
            try await service().streamDeltas(
                request: ChatCompletionRequest(messages: []),
                baseURL: "https://api.openai.com/v1",
                apiKey: "",
                onDelta: { _ in }
            )
            XCTFail("expected .noKey")
        } catch {
            XCTAssertEqual(error as? ChatServiceError, .noKey)
        }
    }

    // MARK: - One-shot completion (memory summarisation)

    func testCompleteReturnsExtractedText() async throws {
        StubURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.openai.com/v1/chat/completions")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"choices":[{"message":{"content":"summary"}}]}"#.utf8)])
        }
        let text = try await service().complete(
            request: ChatCompletionRequest(messages: [UpstreamMessage(role: .user, content: "summarise")]),
            baseURL: "https://api.openai.com/v1",
            apiKey: "sk-x"
        )
        XCTAssertEqual(text, "summary")
    }

    func testCompleteThrowsHTTPErrorTruncatedTo400Chars() async {
        let longBody = String(repeating: "x", count: 1000)
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 500, chunks: [Data(longBody.utf8)])
        }
        do {
            _ = try await service().complete(
                request: ChatCompletionRequest(messages: []),
                baseURL: "https://api.openai.com/v1",
                apiKey: "sk-x"
            )
            XCTFail("expected an error")
        } catch let error as ChatServiceError {
            guard case .httpError(let status, let body) = error else {
                return XCTFail("expected .httpError, got \(error)")
            }
            XCTAssertEqual(status, 500)
            XCTAssertEqual(body.count, 400, "server truncates the error body to 400 chars; the client mirrors that")
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }
}
