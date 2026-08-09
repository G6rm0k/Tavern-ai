import Foundation

/// Auto-translates newly imported Chub.ai character text via MyMemory's free
/// API, called directly — no proxy needed on a native client. Mirrors
/// `/api/translate` (`server/index.js:1791-1821`) and `Translator` in
/// `public/js/translator.js`, extended (on both sides, not iOS-only) to also
/// translate `description` — the original only ever touched `firstMessages`.
final class TranslatorClient {

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Same crude Cyrillic-vs-Latin heuristic as the web version's
    /// `Translator.detect` — good enough to answer "does this already look
    /// like the target language," not a real language detector.
    static func detectLanguage(_ text: String) -> String {
        guard !text.isEmpty else { return "en" }
        var cyrillic = 0
        var latin = 0
        for scalar in text.prefix(200).unicodeScalars {
            let value = scalar.value
            if value >= 0x0400 && value <= 0x04FF { cyrillic += 1 }
            else if (value >= 0x41 && value <= 0x5A) || (value >= 0x61 && value <= 0x7A) { latin += 1 }
        }
        return Double(cyrillic) > Double(latin) * 0.3 ? "ru" : "en"
    }

    /// Splits into ≤490-character chunks for MyMemory's free tier, same as
    /// the server does, and translates each in order. A chunk that fails
    /// falls back to itself untranslated rather than dropping text.
    func translate(_ text: String, from: String, to: String) async -> String {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, from != to else { return text }

        var remaining = Substring(text)
        var chunks: [String] = []
        while !remaining.isEmpty {
            let chunk = remaining.prefix(490)
            chunks.append(String(chunk))
            remaining = remaining.dropFirst(chunk.count)
        }

        var result = ""
        for chunk in chunks {
            result += await translateChunk(chunk, from: from, to: to) ?? chunk
        }
        return result
    }

    private func translateChunk(_ text: String, from: String, to: String) async -> String? {
        var components = URLComponents(string: "https://api.mymemory.translated.net/get")!
        components.queryItems = [
            URLQueryItem(name: "q", value: text),
            URLQueryItem(name: "langpair", value: "\(from)|\(to)"),
        ]
        guard let url = components.url else { return nil }
        do {
            let (data, response) = try await session.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            let decoded = try JSONDecoder().decode(MyMemoryResponse.self, from: data)
            guard decoded.responseStatus == 200, let translated = decoded.translatedText else { return nil }
            return translated
        } catch {
            return nil
        }
    }

    /// MyMemory's `responseStatus` has been observed as either a number or a
    /// numeric string depending on endpoint mood — decoded leniently rather
    /// than trusting a fixed type from a third-party API not under this
    /// project's control.
    private struct MyMemoryResponse: Decodable {
        let responseStatus: Int
        let translatedText: String?

        private enum CodingKeys: String, CodingKey {
            case responseStatus, responseData
        }
        private enum DataKeys: String, CodingKey {
            case translatedText
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if let intStatus = try? c.decode(Int.self, forKey: .responseStatus) {
                responseStatus = intStatus
            } else if let stringStatus = try? c.decode(String.self, forKey: .responseStatus), let intStatus = Int(stringStatus) {
                responseStatus = intStatus
            } else {
                responseStatus = 0
            }
            let dataContainer = try? c.nestedContainer(keyedBy: DataKeys.self, forKey: .responseData)
            translatedText = try? dataContainer?.decode(String.self, forKey: .translatedText)
        }
    }
}
