import Foundation

/// Which lorebook entries fire for a stretch of conversation, so a character
/// can "know" about places, people, and events without paying for all of it
/// in every single request.
enum LorebookMatcher {

    /// "башня" in an entry must match "башню" in the message — plain substring
    /// matching almost never fires for an inflected language like Russian.
    /// A key of at least 5 characters also matches on its stem (itself minus
    /// the last character), covering ordinary declension without needing
    /// every form spelled out.
    static func matches(key: String, haystack: String) -> Bool {
        let k = key.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !k.isEmpty else { return false }
        if haystack.contains(k) { return true }
        guard k.count >= 5 else { return false }
        return haystack.contains(String(k.dropLast()))
    }

    /// Entries whose keys show up anywhere in the recent context window.
    static func matchedEntries(book: [LorebookEntry], recentContext: [UpstreamMessage]) -> [LorebookEntry] {
        guard !book.isEmpty else { return [] }
        let haystack = recentContext.map(\.content).joined(separator: "\n").lowercased()
        return book.filter { entry in
            !entry.content.isEmpty && entry.keys.contains { matches(key: $0, haystack: haystack) }
        }
    }

    /// The block to fold into the system prompt, or `nil` when nothing hit.
    /// `fill` applies `{{char}}`/`{{user}}` substitution to each entry's text.
    static func loreBlock(book: [LorebookEntry], recentContext: [UpstreamMessage], fill: (String) -> String) -> String? {
        let hits = matchedEntries(book: book, recentContext: recentContext)
        guard !hits.isEmpty else { return nil }
        return "[Важные сведения]\n" + hits.map { fill($0.content) }.joined(separator: "\n")
    }
}
