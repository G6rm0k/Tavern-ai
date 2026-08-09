import Foundation

/// Once a chat outgrows the context window, the model simply never sees the
/// start of the conversation again. This compresses what fell off into a
/// short recap kept in the system prompt (`[Что было раньше в этом
/// разговоре]`) instead. The pure pieces live here; the actual network call
/// and persistence happen in `ChatController`, wrapped in a silent
/// `try?` — memory is a bonus, and must never break the chat.
enum MemorySummarizer {

    /// Fixed, in Russian, matching the web version exactly — this is data
    /// sent to the model, not interface text to localize.
    static let systemPrompt = "Ты сжимаешь переписку в краткое содержание. Пиши только факты, договорённости, важные события и изменения в отношениях — сухим списком, без вступлений. Не более 200 слов."

    static let maxTokens = 400
    static let temperature = 0.3

    /// Compressing kicks in once a chat holds roughly 2x the context window,
    /// and only for the stretch not already folded into `summary`.
    static func shouldSummarise(messageCount: Int, keep: Int, alreadySummarisedUpTo: Int) -> Bool {
        guard messageCount >= keep * 2 else { return false }
        return cutCount(messageCount: messageCount, keep: keep) > alreadySummarisedUpTo
    }

    /// How many of the oldest messages fall outside the window being kept.
    static func cutCount(messageCount: Int, keep: Int) -> Int {
        max(0, messageCount - keep)
    }

    /// `"Speaker: text"` per line, one line per message being folded away.
    static func transcript(cutMessages: [ChatMessage], userName: String, characterName: String) -> String {
        cutMessages.map { message in
            let speaker = message.role == .user ? userName : characterName
            return "\(speaker): \(message.content)"
        }.joined(separator: "\n")
    }

    /// The single user-role message sent to the summariser. Folding in what
    /// is already known means each pass only has to account for the new
    /// stretch of conversation, not re-derive the whole history.
    static func userContent(existingSummary: String, transcript: String) -> String {
        guard !existingSummary.isEmpty else { return transcript }
        return "Уже известно:\n" + existingSummary + "\n\nНовая часть переписки:\n" + transcript
    }
}
