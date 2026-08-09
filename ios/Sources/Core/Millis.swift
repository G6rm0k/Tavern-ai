import Foundation

// Timestamps are stored as milliseconds since the epoch — a plain `Double`,
// not a `Date`. That is exactly what the web version writes (`Date.now()`), so
// a backup exported there decodes here without a custom date strategy, and a
// future change to `JSONEncoder.dateEncodingStrategy` can never silently
// reinterpret files already on disk.
extension Date {
    static var nowMilliseconds: Double {
        Date().timeIntervalSince1970 * 1000
    }

    init(milliseconds: Double) {
        self.init(timeIntervalSince1970: milliseconds / 1000)
    }
}
