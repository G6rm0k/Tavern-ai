import Foundation

/// The tail of a conversation actually sent upstream.
enum ContextWindow {

    /// Reduces the last `limit` messages to `{role, content}`, the only
    /// shape a provider needs. `excludingMessageID`, when the id of an
    /// existing message, cuts the window off right before that message
    /// instead of after the end of the conversation — swiping regenerates
    /// message X using only what came before X, not a stale copy of X itself.
    static func messages(from all: [ChatMessage], excluding excludedID: String?, limit: Int) -> [UpstreamMessage] {
        let source: [ChatMessage]
        if let excludedID, let index = all.firstIndex(where: { $0.id == excludedID }) {
            source = Array(all[..<index])
        } else {
            source = all
        }
        return source.suffix(limit).map { UpstreamMessage(role: $0.role, content: $0.content) }
    }
}
