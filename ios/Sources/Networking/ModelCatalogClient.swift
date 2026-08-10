import Foundation

/// Scans a provider's `/models` endpoint directly — no proxy needed on a
/// native client, unlike the web version's `ModelLoader.fetchModels()`,
/// which has to go through `/api/models` (`server/index.js:1292-1326`)
/// purely because a browser can't attach a third party's API key itself.
/// Same auth-header rule as `ChatCompletionService`: the Anthropic host
/// wants `x-api-key`, everything else gets a Bearer token.
final class ModelCatalogClient {

    enum CatalogError: Error, Equatable {
        case badURL
        case httpError(Int)
    }

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func fetchModels(baseURL: String, apiKey: String) async throws -> [String] {
        guard let components = URLComponents(string: baseURL),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty else {
            throw CatalogError.badURL
        }
        guard let url = URL(string: Self.trimmedBase(baseURL) + "/models") else {
            throw CatalogError.badURL
        }

        var request = URLRequest(url: url)
        if ChatCompletionService.isAnthropicHost(host) {
            request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        } else if !apiKey.isEmpty {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw CatalogError.httpError((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return Self.extractModelIDs(from: data)
    }

    private static func trimmedBase(_ baseURL: String) -> String {
        var trimmed = baseURL
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        return trimmed
    }

    /// A provider's `/models` shape varies (a bare array, `{data:[...]}`,
    /// `{models:[...]}`), and each entry is either a bare string or an
    /// object with an `id`/`name` — same tolerance the server's
    /// `/api/models` already has.
    static func extractModelIDs(from data: Data) -> [String] {
        guard let obj = try? JSONSerialization.jsonObject(with: data) else { return [] }
        let rawList: [Any]
        if let array = obj as? [Any] {
            rawList = array
        } else if let dict = obj as? [String: Any] {
            rawList = (dict["data"] as? [Any]) ?? (dict["models"] as? [Any]) ?? []
        } else {
            rawList = []
        }
        return rawList.compactMap { entry -> String? in
            if let s = entry as? String { return s.isEmpty ? nil : s }
            if let d = entry as? [String: Any] {
                if let id = d["id"] as? String, !id.isEmpty { return id }
                if let name = d["name"] as? String, !name.isEmpty { return name }
            }
            return nil
        }
    }
}
