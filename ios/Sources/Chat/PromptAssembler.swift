import Foundation

/// Builds the system prompt sent upstream, in the same order the web version
/// uses: global instructions → character system prompt → persona → memory
/// summary → lorebook. Empty parts are dropped; the rest are joined with a
/// blank line between them.
enum PromptAssembler {

    /// `{{char}}` / `{{user}}` substitution.
    static func fill(_ text: String, characterName: String, userName: String) -> String {
        text.replacingOccurrences(of: "{{char}}", with: characterName)
            .replacingOccurrences(of: "{{user}}", with: userName)
    }

    /// Who `{{user}}` refers to: the persona's name, or a fixed fallback —
    /// there is no account system on-device to fall back to a display name.
    static func userName(persona: Persona) -> String {
        let trimmed = persona.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "User" : trimmed
    }

    /// iOS-only addition, not in the web version: asks the model to reason
    /// through the problem before its final answer via a plain prompt
    /// instruction rather than any provider-specific "reasoning" API (like
    /// Anthropic's `thinking` parameter or a dedicated model such as
    /// DeepSeek R1) — so it has the same effect regardless of which
    /// provider or model is active, at the cost of being a request rather
    /// than a guarantee: the model can still ignore it.
    static let thinkingInstruction = "Прежде чем ответить, подробно и по шагам обдумай задачу в отдельном блоке рассуждения, а затем дай финальный ответ."

    /// - Parameters:
    ///   - character: the live character (system prompt, lorebook). `nil` if
    ///     it was since deleted — the chat still has a system prompt to build,
    ///     just without a character-specific part.
    ///   - characterName: the chat's own snapshot of the name it was started
    ///     with (`ChatSession.characterName`), used for `{{char}}`. Not the
    ///     live character's name — a chat keeps referring to whoever it was
    ///     started with even if that character is later renamed or deleted.
    ///   - forceThinking: prepends `thinkingInstruction` ahead of everything
    ///     else, framing how the model should approach the rest of the prompt.
    static func buildSystemPrompt(character: CharacterCard?,
                                   characterName: String,
                                   globalSystem: String,
                                   persona: Persona,
                                   memorySummary: String,
                                   recentContext: [UpstreamMessage],
                                   forceThinking: Bool = false) -> String {
        var parts: [String] = []
        let name = userName(persona: persona)
        let fillText: (String) -> String = { fill($0, characterName: characterName, userName: name) }

        if forceThinking {
            parts.append(thinkingInstruction)
        }
        if !globalSystem.isEmpty {
            parts.append(globalSystem)
        }
        if let systemPrompt = character?.systemPrompt, !systemPrompt.isEmpty {
            parts.append(fillText(systemPrompt))
        }

        let personaDescription = persona.description.trimmingCharacters(in: .whitespacesAndNewlines)
        if !personaDescription.isEmpty {
            parts.append("[О собеседнике по имени \(name)]\n" + personaDescription)
        }

        if !memorySummary.isEmpty {
            parts.append("[Что было раньше в этом разговоре]\n" + memorySummary)
        }

        if let lore = LorebookMatcher.loreBlock(book: character?.lorebook ?? [], recentContext: recentContext, fill: fillText) {
            parts.append(lore)
        }

        return parts.filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
}
