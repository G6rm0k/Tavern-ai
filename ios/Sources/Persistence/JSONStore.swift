import Foundation

/// Why a load did not return stored data. Exposed mainly so callers can tell
/// "first launch" (`.missing`) apart from "the file was there but unreadable"
/// (`.corrupt`) — seeding starter content is right for one and wrong for the
/// other.
enum StoreLoadIssue: Equatable {
    case missing
    case corrupt(quarantinedAs: String)
}

/// Shared coders. They live outside `JSONStore` because Swift does not allow
/// static stored properties on a generic type.
enum StoreCoding {
    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        // Deterministic output: a save that changes nothing produces a
        // byte-identical file, which makes diffing a backup actually useful.
        e.outputFormatting = [.sortedKeys]
        return e
    }()

    static let decoder = JSONDecoder()
}

/// A JSON file on disk holding one `Codable` value.
///
/// Deliberately plain `Codable` + `FileManager` rather than SwiftData: this app
/// is developed without a simulator, so a schema mistake has to fail in CI at
/// compile or unit-test time, not as a runtime `fatalError` on the user's phone
/// days later.
///
/// Not thread-safe for `flush()` from inside its own queue — call `save`,
/// `saveSoon` and `flush` from the main thread.
final class JSONStore<Value: Codable> {

    typealias DecodeFunc = (Data, JSONDecoder) throws -> Value

    let fileURL: URL

    private let defaultValue: Value
    private let decodeValue: DecodeFunc
    private let debounce: TimeInterval
    private let queue: DispatchQueue

    private var pending: Value?
    private var pendingWork: DispatchWorkItem?

    private(set) var lastLoadIssue: StoreLoadIssue?

    init(fileURL: URL,
         defaultValue: Value,
         debounce: TimeInterval = 0.3,
         decode: @escaping DecodeFunc = { data, decoder in try decoder.decode(Value.self, from: data) }) {
        self.fileURL = fileURL
        self.defaultValue = defaultValue
        self.debounce = debounce
        self.decodeValue = decode
        self.queue = DispatchQueue(label: "app.wesaid.store." + fileURL.lastPathComponent)
    }

    deinit {
        flush()
    }

    // MARK: - Reading

    func load() -> Value {
        lastLoadIssue = nil
        guard let data = try? Data(contentsOf: fileURL), !data.isEmpty else {
            lastLoadIssue = .missing
            return defaultValue
        }
        do {
            return try decodeValue(data, StoreCoding.decoder)
        } catch {
            // Never overwrite what we failed to understand: move it aside so a
            // damaged file can still be recovered by hand, and carry on with a
            // working app rather than crashing on launch.
            let name = quarantine()
            lastLoadIssue = .corrupt(quarantinedAs: name)
            return defaultValue
        }
    }

    // MARK: - Writing

    /// Write immediately, surfacing any failure. Cancels a pending debounced
    /// write so the older value cannot land on top afterwards.
    func save(_ value: Value) throws {
        try queue.sync {
            pendingWork?.cancel()
            pendingWork = nil
            pending = nil
            try writeNow(value)
        }
    }

    /// Coalesce rapid updates into one write. Typing a message or streaming a
    /// reply mutates the model far faster than a file should be rewritten.
    func saveSoon(_ value: Value) {
        queue.async {
            self.pending = value
            self.pendingWork?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.writePending() }
            self.pendingWork = work
            self.queue.asyncAfter(deadline: .now() + self.debounce, execute: work)
        }
    }

    /// Force any coalesced write out now — call before the app leaves the
    /// foreground, where the next thing that happens may be termination.
    func flush() {
        queue.sync {
            pendingWork?.cancel()
            pendingWork = nil
            writePending()
        }
    }

    // MARK: - Internals (all on `queue`)

    private func writePending() {
        guard let value = pending else { return }
        pending = nil
        try? writeNow(value)
    }

    private func writeNow(_ value: Value) throws {
        let dir = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let data = try StoreCoding.encoder.encode(value)
        // `.atomic` writes a temp file and renames, so a crash mid-write leaves
        // the previous file intact instead of a truncated one. File protection
        // means chats and prompts are encrypted at rest by iOS whenever the
        // device is locked.
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    private func quarantine() -> String {
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let name = fileURL.lastPathComponent + ".corrupt-\(stamp)"
        let dest = fileURL.deletingLastPathComponent().appendingPathComponent(name)
        try? FileManager.default.removeItem(at: dest)
        try? FileManager.default.moveItem(at: fileURL, to: dest)
        return name
    }
}

/// Wraps an element so one unreadable record cannot fail the whole array.
private struct FailableElement<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        value = try? container.decode(T.self)
    }
}

/// Builds a store for a collection where a single broken record is dropped
/// rather than taken as proof that the whole file is corrupt — the same
/// tolerance the server applies when it prunes bad character entries on
/// startup. Losing one imported card beats losing the entire library.
enum LossyArrayStore {
    static func make<Element: Codable>(at url: URL,
                                       of _: Element.Type,
                                       debounce: TimeInterval = 0.3) -> JSONStore<[Element]> {
        JSONStore<[Element]>(fileURL: url, defaultValue: [], debounce: debounce) { data, decoder in
            try decoder.decode([FailableElement<Element>].self, from: data).compactMap { $0.value }
        }
    }
}
