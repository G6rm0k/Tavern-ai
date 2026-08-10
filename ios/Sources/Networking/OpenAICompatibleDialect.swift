import Foundation

/// Every preset except Anthropic: OpenAI, OpenRouter, VseGPT, Ollama,
/// LM Studio, Groq, Together AI, Mistral, DeepSeek, Cohere, xAI, Custom.
/// All of them accept the same `/chat/completions` shape with a Bearer token.
struct OpenAICompatibleDialect: ChatDialect {

    func buildRequest(baseURL: String, apiKey: String, request: ChatCompletionRequest, streaming: Bool) throws -> URLRequest {
        var messages = request.messages
        if let system = request.systemPrompt, !system.isEmpty {
            messages.insert(UpstreamMessage(role: .system, content: system), at: 0)
        }

        var body: [String: Any] = [
            "model": resolvedModel(request.model, default: "gpt-4o-mini"),
            "messages": messages.map { ["role": $0.role.rawValue, "content": $0.content] },
            "stream": streaming,
            "max_tokens": cappedMaxTokens(request.maxTokens)
        ]
        if let temperature = request.temperature { body["temperature"] = temperature }
        if let topP = request.topP { body["top_p"] = topP }

        var headers = ["Content-Type": "application/json"]
        if !apiKey.isEmpty { headers["Authorization"] = "Bearer \(apiKey)" }

        return try makeRequest(url: trimmedBase(baseURL) + "/chat/completions", headers: headers, body: body)
    }

    /// Real OpenAI-compatible SSE carries no in-band error event — failures
    /// arrive as a non-2xx HTTP status before streaming ever starts, which
    /// `ChatCompletionService` checks separately. This only ever reads
    /// `choices[0].delta.content`.
    func parseSSELine(_ line: String) -> [ChatStreamEvent] {
        guard let raw = dataPayload(of: line), let obj = jsonObject(from: raw) else { return [] }
        guard let choices = obj["choices"] as? [[String: Any]],
              let delta = choices.first?["delta"] as? [String: Any],
              let content = delta["content"] as? String,
              !content.isEmpty else { return [] }
        return [.delta(content)]
    }
}
