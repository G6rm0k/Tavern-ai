import Foundation
import Combine

/// All conversations, newest activity first. Use from the main thread.
final class ChatStore: ObservableObject {

    @Published private(set) var chats: [ChatSession] = []

    private let store: JSONStore<[ChatSession]>

    init(paths: AppPaths = .documents) {
        store = LossyArrayStore.make(at: paths.chatsFile, of: ChatSession.self)
        chats = ChatStore.sorted(store.load())
    }

    private static func sorted(_ list: [ChatSession]) -> [ChatSession] {
        list.sorted { $0.updatedAt > $1.updatedAt }
    }

    func chat(id: String) -> ChatSession? {
        chats.first { $0.id == id }
    }

    func chats(forCharacter characterId: String) -> [ChatSession] {
        chats.filter { $0.characterId == characterId }
    }

    /// Starts a conversation with `character`, opening on one of its greetings
    /// picked at random. A second conversation with the same character gets a
    /// numbered title so the two are told apart in a list.
    @discardableResult
    func create(with character: CharacterCard, greeting: String? = nil) -> ChatSession {
        var messages: [ChatMessage] = []
        let opener = greeting ?? character.firstMessages.randomElement()
        if let opener, !opener.isEmpty {
            messages.append(ChatMessage(role: .assistant, content: opener, variants: [opener]))
        }

        let existing = chats(forCharacter: character.id).count
        let session = ChatSession(
            characterId: character.id,
            characterName: character.name,
            characterAvatar: character.avatar,
            characterAvatarEmoji: character.avatarEmoji,
            title: existing > 0 ? "\(character.name) #\(existing + 1)" : "",
            messages: messages
        )
        chats.insert(session, at: 0)
        store.saveSoon(chats)
        return session
    }

    /// Writes a modified conversation back. `touch: false` is for edits that
    /// are not activity — renaming, or storing a summary — so a housekeeping
    /// change cannot jump an old chat to the top of the list.
    func update(_ chat: ChatSession, touch: Bool = true) {
        guard let index = chats.firstIndex(where: { $0.id == chat.id }) else { return }
        var updated = chat
        if touch { updated.updatedAt = Date.nowMilliseconds }
        chats[index] = updated
        if touch { chats = ChatStore.sorted(chats) }
        store.saveSoon(chats)
    }

    func delete(id: String) {
        guard let index = chats.firstIndex(where: { $0.id == id }) else { return }
        chats.remove(at: index)
        store.saveSoon(chats)
    }

    /// Adds a chat from a backup file only if nothing with the same id is
    /// already here, mirroring `CharacterStore.restore(_:)`.
    @discardableResult
    func restore(_ session: ChatSession) -> Bool {
        guard !chats.contains(where: { $0.id == session.id }) else { return false }
        chats.append(session)
        chats = ChatStore.sorted(chats)
        store.saveSoon(chats)
        return true
    }

    func deleteAll() {
        chats = []
        store.saveSoon(chats)
    }

    func flush() {
        store.flush()
    }
}
