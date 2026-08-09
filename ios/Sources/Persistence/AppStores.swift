import Foundation

/// Everything persistent, wired together in one place so the app can hand the
/// stores down through the environment and flush them all when it goes to the
/// background — the point after which the next thing that happens may be
/// termination, with any coalesced write still unwritten.
final class AppStores {

    let characters: CharacterStore
    let chats: ChatStore
    let settings: SettingsStore

    init(paths: AppPaths = .documents) {
        characters = CharacterStore(paths: paths)
        chats = ChatStore(paths: paths)
        settings = SettingsStore(paths: paths)
    }

    func flushAll() {
        characters.flush()
        chats.flush()
        settings.flush()
    }
}
