import Foundation
import Combine

/// The character library. Use from the main thread.
final class CharacterStore: ObservableObject {

    @Published private(set) var characters: [CharacterCard] = []

    let avatars: AvatarStore

    private let store: JSONStore<[CharacterCard]>

    init(paths: AppPaths = .documents, seedOnFirstLaunch: Bool = true) {
        store = LossyArrayStore.make(at: paths.charactersFile, of: CharacterCard.self)
        avatars = AvatarStore(directory: paths.avatarsDirectory)
        characters = store.load()

        // Only on a genuinely first launch. After a corrupt file we quarantine
        // and start empty on purpose — re-seeding there would look like the
        // user's own characters had been replaced by strangers.
        if seedOnFirstLaunch, store.lastLoadIssue == .missing {
            characters = StarterCharacters.all
            store.saveSoon(characters)
        }
    }

    func character(id: String) -> CharacterCard? {
        characters.first { $0.id == id }
    }

    /// Adds a new character, or replaces the existing one with the same id.
    func upsert(_ character: CharacterCard) {
        if let index = characters.firstIndex(where: { $0.id == character.id }) {
            characters[index] = character
        } else {
            characters.insert(character, at: 0)
        }
        store.saveSoon(characters)
    }

    func delete(id: String) {
        guard let index = characters.firstIndex(where: { $0.id == id }) else { return }
        let removed = characters.remove(at: index)
        avatars.delete(removed.avatar)   // don't leave orphan image files behind
        store.saveSoon(characters)
    }

    /// Adds a character from a backup file only if nothing with the same id
    /// is already here — a restore must never silently replace what the user
    /// already has on this device. Returns whether it was actually added.
    @discardableResult
    func restore(_ character: CharacterCard) -> Bool {
        guard !characters.contains(where: { $0.id == character.id }) else { return false }
        characters.insert(character, at: 0)
        store.saveSoon(characters)
        return true
    }

    /// Replaces the character's picture, cleaning up the file it replaced.
    /// Returns `false` when the image could not be written, leaving the old one
    /// in place rather than blanking the avatar.
    @discardableResult
    func setAvatar(_ data: Data, for id: String, fileExtension: String = "png") -> Bool {
        guard let index = characters.firstIndex(where: { $0.id == id }),
              let name = avatars.save(data, fileExtension: fileExtension) else { return false }
        let previous = characters[index].avatar
        characters[index].avatar = name
        if previous != name { avatars.delete(previous) }
        store.saveSoon(characters)
        return true
    }

    func flush() {
        store.flush()
    }
}
