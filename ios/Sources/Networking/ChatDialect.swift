import Foundation

/// One event out of a streaming response, dialect-agnostic.
enum ChatStreamEvent: Equatable {
    case delta(String)
    case done
    case error(String)
}

/// A message as it goes over the wire: role + content only. Distinct from
/// `ChatMessage` on purpose — the wire format has no id, timestamp, or swipe
/// variants, and collapsing those away is exactly what `Chat._context()` does
/// on the web side before a request goes out.
struct UpstreamMessage: Codable, Hashable {
    var role: ChatRole
    var content: String
}

struct ChatCompletionRequest {
    var messages: [UpstreamMessage]
    // `= nil` here is load-bearing: without it, Swift's synthesized memberwise
    // initializer makes every one of these a required parameter instead of an
    // optional one, and every call site in this file that omits them stops
    // compiling.
    var model: String? = nil
    var systemPrompt: String? = nil
    var temperature: Double? = nil
    var maxTokens: Int? = nil
    var topP: Double? = nil
}

/// One provider protocol: how to build the request and how to read the
/// response. `OpenAICompatibleDialect` covers every preset except Anthropic,
/// which speaks its own shape (`/v1/messages`, `x-api-key`, a top-level
/// `system` field, and its own SSE event names).
protocol ChatDialect {
    func buildRequest(baseURL: String, apiKey: String, request: ChatCompletionRequest, streaming: Bool) throws -> URLRequest

    /// Interprets one raw SSE line (as delivered by `URLSession.bytes(for:).lines`,
    /// so already newline-delimited — no buffering to get wrong here). Lines
    /// that are not a `data:` line, or a `data:` line this dialect has nothing
    /// to say about, yield no events.
    func parseSSELine(_ line: String) -> [ChatStreamEvent]
}

extension ChatDialect {
    /// Same cap both dialects apply: `min(maxTokens ?? 2048, 16384)`.
    func cappedMaxTokens(_ maxTokens: Int?) -> Int {
        min(maxTokens ?? 2048, 16384)
    }

    /// `provider.baseUrl` with trailing slashes stripped, so `.../v1/` and
    /// `.../v1` both produce `.../v1/chat/completions` rather than a doubled
    /// slash.
    func trimmedBase(_ baseURL: String) -> String {
        var s = baseURL
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }

    /// `request.model`, treating an empty string the same as absent, falling
    /// back to `defaultModel` — matches the server's `model || 'fallback'`
    /// (JS treats `""` as falsy too).
    func resolvedModel(_ model: String?, default defaultModel: String) -> String {
        model.flatMap { $0.isEmpty ? nil : $0 } ?? defaultModel
    }

    func makeRequest(url endpoint: String, headers: [String: String], body: [String: Any]) throws -> URLRequest {
        guard let url = URL(string: endpoint) else { throw ChatServiceError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        for (key, value) in headers { req.setValue(value, forHTTPHeaderField: key) }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return req
    }

    /// `data:` lines only — every other SSE line (blank separators, `event:`,
    /// `id:`) is deliberately ignored, matching the server's own filter.
    func dataPayload(of line: String) -> String? {
        guard line.hasPrefix("data:") else { return nil }
        let raw = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        // `[DONE]` is not treated as the end of the stream — the real end is
        // the connection closing. Some providers send it, some don't.
        guard !raw.isEmpty, raw != "[DONE]" else { return nil }
        return raw
    }

    func jsonObject(from raw: String) -> [String: Any]? {
        guard let data = raw.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
