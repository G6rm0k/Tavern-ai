import Foundation

/// Where the app's files live. Injectable so tests run against a temp
/// directory instead of the real Documents folder.
struct AppPaths {
    let root: URL

    init(root: URL) {
        self.root = root
    }

    static let documents = AppPaths(
        root: FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    )

    var charactersFile: URL { root.appendingPathComponent("characters.json") }
    var chatsFile: URL      { root.appendingPathComponent("chats.json") }
    var settingsFile: URL   { root.appendingPathComponent("settings.json") }
    var avatarsDirectory: URL { root.appendingPathComponent("Avatars", isDirectory: true) }
}
