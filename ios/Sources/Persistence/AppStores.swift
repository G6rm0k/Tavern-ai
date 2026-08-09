import Foundation

/// Everything persistent, wired together in one place so the app can hand the
/// stores down through the environment and flush them all when it goes to the
/// background — the point after which the next thing that happens may be
/// termination, with any coalesced write still unwritten.
///
/// `ObservableObject` conformance here is only so SwiftUI's `@StateObject` can
/// hold one stable instance for the app's lifetime — none of `AppStores`'
/// own properties are `@Published`; each store publishes its own changes,
/// and views observe those directly via `.environmentObject`.
final class AppStores: ObservableObject {

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
