import Foundation

/// Avatar images as files, never base64 inside the JSON.
///
/// Two reasons, both learned on the web version: a 200 KB picture inlined into
/// `characters.json` gets re-encoded on every single save, and the whole
/// library has to be parsed before the first row can be drawn.
///
/// Only the *file name* is stored on a character — iOS may relocate the app
/// container between launches, so a saved absolute path can stop resolving
/// after an update.
final class AvatarStore {

    private let directory: URL

    init(directory: URL) {
        self.directory = directory
    }

    /// Writes image data and returns the file name to put on the character.
    /// `nil` means the write failed and the caller should keep whatever avatar
    /// the character already had.
    func save(_ data: Data, fileExtension: String = "png") -> String? {
        guard !data.isEmpty else { return nil }
        let name = UUID().uuidString + "." + fileExtension
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: directory.appendingPathComponent(name),
                           options: [.atomic, .completeFileProtectionUnlessOpen])
            return name
        } catch {
            return nil
        }
    }

    func url(for fileName: String?) -> URL? {
        guard let fileName, !fileName.isEmpty else { return nil }
        // A stored value is a bare file name by construction; anything with a
        // path separator in it came from somewhere else (a hand-edited file, an
        // imported backup) and must not be able to reach outside this folder.
        guard !fileName.contains("/"), fileName != ".", fileName != ".." else { return nil }
        let url = directory.appendingPathComponent(fileName)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func data(for fileName: String?) -> Data? {
        guard let url = url(for: fileName) else { return nil }
        return try? Data(contentsOf: url)
    }

    func delete(_ fileName: String?) {
        guard let url = url(for: fileName) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
