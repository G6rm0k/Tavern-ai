import Foundation

/// Talks to whichever provider the user configured — directly: there is no
/// server in this app to relay through, so what used to be
/// `server/index.js`'s `/api/chat/stream` and `/api/chat/complete` now runs
/// here, on-device.
final class ChatCompletionService {

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    // MARK: - Host classification

    /// `/(^|\.)anthropic\.com$/i` from the server, expressed without regex.
    static func isAnthropicHost(_ host: String) -> Bool {
        let h = host.lowercased()
        return h == "anthropic.com" || h.hasSuffix(".anthropic.com")
    }

    /// Local model servers (Ollama, LM Studio) legitimately have no API key.
    static func isLocalHost(_ host: String) -> Bool {
        let h = host.lowercased()
        return h == "localhost" || h.hasPrefix("127.") || h == "::1" || h == "[::1]" || h == "0.0.0.0"
    }

    // Named distinctly from the `dialect` locals at each call site: `let
    // dialect = dialect(forHost:)` is a classic Swift trap — the new local's
    // name is already in scope for its own initializer, so the call would
    // resolve to itself instead of this method and fail to compile.
    private func makeDialect(forHost host: String) -> ChatDialect {
        Self.isAnthropicHost(host) ? AnthropicDialect() : OpenAICompatibleDialect()
    }

    /// Same checks the server ran before it would use a provider at all: a
    /// well-formed http(s) URL, and a key unless the host is local.
    @discardableResult
    func validate(baseURL: String, apiKey: String) throws -> String {
        guard !baseURL.isEmpty,
              let components = URLComponents(string: baseURL),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty else {
            throw ChatServiceError.badURL
        }
        if apiKey.isEmpty && !Self.isLocalHost(host) {
            throw ChatServiceError.noKey
        }
        return host
    }

    // MARK: - Streaming

    /// Streams reply text as it arrives. Runs entirely inside the caller's
    /// `Task` — cancelling that task (the chat screen's Stop button) makes
    /// the underlying `URLSession.bytes(for:)` iteration throw a
    /// `URLError(.cancelled)`, with no `AbortController` of our own needed.
    func streamDeltas(request: ChatCompletionRequest,
                       baseURL: String,
                       apiKey: String,
                       onDelta: (String) -> Void) async throws {
        let host = try validate(baseURL: baseURL, apiKey: apiKey)
        let dialect = makeDialect(forHost: host)
        let urlRequest = try dialect.buildRequest(baseURL: baseURL, apiKey: apiKey, request: request, streaming: true)

        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: urlRequest)
        } catch {
            throw Self.mapTransportError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw ChatServiceError.network("Некорректный ответ сервера")
        }

        guard (200...299).contains(http.statusCode) else {
            // Same as the server: read the body so the caller can show why it
            // failed ("wrong key", "out of credit") instead of a bare status code.
            var body = ""
            for try await line in bytes.lines { body += line }
            throw ChatServiceError.httpError(status: http.statusCode, body: body)
        }

        do {
            for try await line in bytes.lines {
                for event in dialect.parseSSELine(line) {
                    switch event {
                    case .delta(let text):
                        onDelta(text)
                    case .done:
                        return
                    case .error(let message):
                        throw ChatServiceError.httpError(status: http.statusCode, body: message)
                    }
                }
            }
        } catch let error as ChatServiceError {
            throw error
        } catch {
            throw Self.mapTransportError(error)
        }
    }

    // MARK: - One-shot completion (used for memory summarisation)

    func complete(request: ChatCompletionRequest, baseURL: String, apiKey: String) async throws -> String {
        let host = try validate(baseURL: baseURL, apiKey: apiKey)
        let dialect = makeDialect(forHost: host)
        let urlRequest = try dialect.buildRequest(baseURL: baseURL, apiKey: apiKey, request: request, streaming: false)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch {
            throw Self.mapTransportError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw ChatServiceError.network("Некорректный ответ сервера")
        }
        guard (200...299).contains(http.statusCode) else {
            throw ChatServiceError.httpError(status: http.statusCode, body: String(decoding: data.prefix(400), as: UTF8.self))
        }
        return Self.extractCompletionText(from: data)
    }

    /// OpenAI shape first, then Anthropic's — same probe order as the server,
    /// since this reads the *response* body, whose shape depends on which
    /// provider answered, not which dialect built the request.
    static func extractCompletionText(from data: Data) -> String {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        if let choices = obj["choices"] as? [[String: Any]],
           let message = choices.first?["message"] as? [String: Any],
           let content = message["content"] as? String {
            return content
        }
        if let contentBlocks = obj["content"] as? [[String: Any]] {
            return contentBlocks.compactMap { $0["text"] as? String }.joined()
        }
        return ""
    }

    // MARK: - Transport error mapping

    private static func mapTransportError(_ error: Error) -> Error {
        // Cancellation (Stop) must reach the caller unchanged — it is not a
        // failure, it is "keep what streamed in so far." Apple's URLSession
        // async APIs typically surface it as URLError(.cancelled) rather than
        // Swift's own CancellationError, but both are handled the same way.
        if error is CancellationError { return error }
        guard let urlError = error as? URLError else { return ChatServiceError.network(error.localizedDescription) }
        if urlError.code == .cancelled { return urlError }
        switch urlError.code {
        case .cannotConnectToHost:
            return ChatServiceError.connectionRefused
        case .cannotFindHost, .dnsLookupFailed, .notConnectedToInternet, .networkConnectionLost, .timedOut:
            return ChatServiceError.noNetwork
        default:
            return ChatServiceError.network(urlError.localizedDescription)
        }
    }
}
