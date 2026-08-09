import Foundation

enum ChatRole: String, Codable, Hashable {
    case user
    case assistant
    case system
}

struct ChatMessage: Codable, Identifiable, Hashable {
    var id: String
    var role: ChatRole
    var content: String
    var ts: Double
    /// Every regeneration appends a variant instead of replacing the text, so
    /// swiping back and forth never destroys an answer the user liked.
    /// `content` always mirrors `variants[variantIndex]`.
    var variants: [String]
    var variantIndex: Int

    init(id: String = UUID().uuidString,
         role: ChatRole = .assistant,
         content: String = "",
         ts: Double = Date.nowMilliseconds,
         variants: [String]? = nil,
         variantIndex: Int = 0) {
        self.id = id
        self.role = role
        self.content = content
        self.ts = ts
        self.variants = variants ?? (role == .assistant ? [content] : [])
        self.variantIndex = variantIndex
    }

    enum CodingKeys: String, CodingKey {
        case id, role, content, ts, variants
        case variantIndex = "vi"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id      = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        ts      = (try? c.decode(Double.self, forKey: .ts)) ?? Date.nowMilliseconds
        // An unknown role must not cost the user the message — a card exported
        // by some other client could carry anything here.
        let raw = (try? c.decode(String.self, forKey: .role)) ?? ChatRole.assistant.rawValue
        role    = ChatRole(rawValue: raw) ?? .assistant
        variants     = (try? c.decode([String].self, forKey: .variants)) ?? []
        variantIndex = (try? c.decode(Int.self, forKey: .variantIndex)) ?? 0
    }

    /// The variant currently on screen, tolerating an index that no longer
    /// points anywhere (hand-edited file, interrupted write).
    var displayedContent: String {
        guard variants.indices.contains(variantIndex) else { return content }
        return variants[variantIndex]
    }
}

struct ChatSession: Codable, Identifiable, Hashable {
    var id: String
    var characterId: String
    /// The character's name and avatar are copied in, not looked up: deleting a
    /// character must not turn its old conversations into blank rows.
    var characterName: String
    var characterAvatar: String?
    var characterAvatarEmoji: String
    /// Empty means "show the character's name" — the web version's convention
    /// for the first, unnamed conversation with someone.
    var title: String
    var messages: [ChatMessage]
    /// Everything that scrolled out of the context window, compressed.
    var summary: String
    /// How many messages the summary already covers, so the same stretch of
    /// conversation is never sent for summarising twice.
    var summarisedUpTo: Int
    var createdAt: Double
    var updatedAt: Double

    init(id: String = UUID().uuidString,
         characterId: String = "",
         characterName: String = "",
         characterAvatar: String? = nil,
         characterAvatarEmoji: String = "✦",
         title: String = "",
         messages: [ChatMessage] = [],
         summary: String = "",
         summarisedUpTo: Int = 0,
         createdAt: Double = Date.nowMilliseconds,
         updatedAt: Double = Date.nowMilliseconds) {
        self.id = id
        self.characterId = characterId
        self.characterName = characterName
        self.characterAvatar = characterAvatar
        self.characterAvatarEmoji = characterAvatarEmoji
        self.title = title
        self.messages = messages
        self.summary = summary
        self.summarisedUpTo = summarisedUpTo
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, characterId, characterName, characterAvatar, characterAvatarEmoji
        case title, messages, summary, summarisedUpTo, createdAt, updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id                   = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        characterId          = (try? c.decode(String.self, forKey: .characterId)) ?? ""
        characterName        = (try? c.decode(String.self, forKey: .characterName)) ?? ""
        characterAvatar      = try? c.decode(String.self, forKey: .characterAvatar)
        characterAvatarEmoji = (try? c.decode(String.self, forKey: .characterAvatarEmoji)) ?? "✦"
        title                = (try? c.decode(String.self, forKey: .title)) ?? ""
        messages             = (try? c.decode([ChatMessage].self, forKey: .messages)) ?? []
        summary              = (try? c.decode(String.self, forKey: .summary)) ?? ""
        summarisedUpTo       = (try? c.decode(Int.self, forKey: .summarisedUpTo)) ?? 0
        createdAt            = (try? c.decode(Double.self, forKey: .createdAt)) ?? Date.nowMilliseconds
        updatedAt            = (try? c.decode(Double.self, forKey: .updatedAt)) ?? createdAt
    }

    var displayTitle: String {
        title.isEmpty ? characterName : title
    }
}
