import Foundation

/// One lorebook fact: it gets injected into the system prompt when any of its
/// keys shows up in the recent conversation. Shape matches the web version
/// (`public/js/characters.js` `_loreItem`) — `keys` + `content`, nothing else.
/// `id` is ours: SwiftUI's `ForEach` needs stable identity, and the web format
/// has none, so a missing one is generated at decode time.
struct LorebookEntry: Codable, Identifiable, Hashable {
    var id: String
    var keys: [String]
    var content: String

    init(id: String = UUID().uuidString, keys: [String] = [], content: String = "") {
        self.id = id
        self.keys = keys
        self.content = content
    }

    enum CodingKeys: String, CodingKey {
        case id, keys, content
    }

    // Every persisted type decodes field-by-field with a fallback instead of
    // relying on synthesised decoding. Adding a property in a later phase then
    // cannot make previously saved files undecodable — which, for a store whose
    // recovery path is "quarantine the file and start empty", would mean
    // silently losing the user's characters on an app update.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id      = (try? c.decode(String.self,   forKey: .id))      ?? UUID().uuidString
        keys    = (try? c.decode([String].self, forKey: .keys))    ?? []
        content = (try? c.decode(String.self,   forKey: .content)) ?? ""
    }
}

struct CharacterCard: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String
    var systemPrompt: String
    /// Possible opening messages; one is picked at random when a chat starts.
    var firstMessages: [String]
    /// File name inside `Avatars/`, never an absolute path: iOS is free to move
    /// the app container between launches, so a stored absolute path would
    /// resolve to nothing after an update.
    var avatar: String?
    var avatarEmoji: String
    var tags: [String]
    var lorebook: [LorebookEntry]
    var createdAt: Double

    init(id: String = UUID().uuidString,
         name: String = "",
         description: String = "",
         systemPrompt: String = "",
         firstMessages: [String] = [],
         avatar: String? = nil,
         avatarEmoji: String = "✦",
         tags: [String] = [],
         lorebook: [LorebookEntry] = [],
         createdAt: Double = Date.nowMilliseconds) {
        self.id = id
        self.name = name
        self.description = description
        self.systemPrompt = systemPrompt
        self.firstMessages = firstMessages
        self.avatar = avatar
        self.avatarEmoji = avatarEmoji
        self.tags = tags
        self.lorebook = lorebook
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id, name, description, systemPrompt, firstMessages, avatar, tags, lorebook, createdAt
        // Snake case on purpose: this is the key the web version writes, and
        // keeping it lets a desktop backup import without a translation layer.
        case avatarEmoji = "avatar_emoji"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id            = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        name          = (try? c.decode(String.self, forKey: .name)) ?? ""
        description   = (try? c.decode(String.self, forKey: .description)) ?? ""
        systemPrompt  = (try? c.decode(String.self, forKey: .systemPrompt)) ?? ""
        firstMessages = (try? c.decode([String].self, forKey: .firstMessages)) ?? []
        avatar        = try? c.decode(String.self, forKey: .avatar)
        avatarEmoji   = (try? c.decode(String.self, forKey: .avatarEmoji)) ?? "✦"
        tags          = (try? c.decode([String].self, forKey: .tags)) ?? []
        lorebook      = (try? c.decode([LorebookEntry].self, forKey: .lorebook)) ?? []
        createdAt     = (try? c.decode(Double.self, forKey: .createdAt)) ?? Date.nowMilliseconds
    }
}
