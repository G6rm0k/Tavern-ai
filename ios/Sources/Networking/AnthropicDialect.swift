import Foundation

/// Anthropic's own shape: `/v1/messages`, `x-api-key` instead of a Bearer
/// token, a top-level `system` field instead of a system-role message, and
/// its own SSE event names (`content_block_delta`, `message_stop`, `error`)
/// instead of `choices[].delta`.
struct AnthropicDialect: ChatDialect {

    func buildRequest(baseURL: String, apiKey: String, request: ChatCompletionRequest, streaming: Bool) throws -> URLRequest {
        // Anthropic wants system-role messages nowhere in the array — they go
        // in the separate `system` field instead.
        let messages = request.messages.filter { $0.role != .system }

        var body: [String: Any] = [
            "model": resolvedModel(request.model, default: "claude-sonnet-5"),
            "max_tokens": cappedMaxTokens(request.maxTokens), // required by Anthropic, unlike OpenAI
            "messages": messages.map { ["role": $0.role.rawValue, "content": $0.content] },
            "stream": streaming
        ]
        if let system = request.systemPrompt, !system.isEmpty { body["system"] = system }
        // Anthropic rejects temperature above 1; the web version silently caps
        // it there rather than surfacing a provider error over one slider value.
        if let temperature = request.temperature { body["temperature"] = min(temperature, 1) }
        if let topP = request.topP { body["top_p"] = topP }

        let headers = [
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01"
        ]

        return try makeRequest(url: trimmedBase(baseURL) + "/messages", headers: headers, body: body)
    }

    func parseSSELine(_ line: String) -> [ChatStreamEvent] {
        guard let raw = dataPayload(of: line),
              let obj = jsonObject(from: raw),
              let type = obj["type"] as? String else { return [] }

        switch type {
        case "content_block_delta":
            guard let delta = obj["delta"] as? [String: Any],
                  let text = delta["text"] as? String,
                  !text.isEmpty else { return [] }
            return [.delta(text)]
        case "message_stop":
            return [.done]
        case "error":
            let message = (obj["error"] as? [String: Any])?["message"] as? String ?? "Ошибка Anthropic"
            return [.error(message)]
        default:
            return []
        }
    }
}
