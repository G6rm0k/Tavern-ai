import Foundation

/// Talks to Chub.ai directly. A native client has no CORS restriction, so
/// unlike the web version's `/api/chub/*` proxy (`server/index.js:1329-1460`,
/// there only because a browser can't hit another origin) this goes straight
/// to `api.chub.ai` / `avatars.charhub.io` — no relay in between.
final class ChubAPIClient {

    struct Character: Identifiable, Decodable, Hashable {
        var id: String { fullPath }
        let fullPath: String
        let name: String
        let description: String
        let avatarURL: String?
        let tags: [String]
        let tokenCount: Int?
        let messageCount: Int?

        // Chub's own site tolerates both spellings depending on endpoint —
        // matches the `n.fullPath || n.full_path` etc. fallbacks in
        // `public/js/discover.js`'s `_card`/`_hcard`.
        private enum CodingKeys: String, CodingKey {
            case fullPath
            case fullPathSnake = "full_path"
            case name, title
            case tagline, description
            case avatarURL = "avatar_url"
            case mainImageURL = "main_image_url"
            case topics, tags
            case tokenCount = "n_tokens"
            case messageCount = "num_messages"
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            fullPath = (try? c.decode(String.self, forKey: .fullPath))
                ?? (try? c.decode(String.self, forKey: .fullPathSnake)) ?? ""
            name = (try? c.decode(String.self, forKey: .name))
                ?? (try? c.decode(String.self, forKey: .title)) ?? "?"
            description = (try? c.decode(String.self, forKey: .tagline))
                ?? (try? c.decode(String.self, forKey: .description)) ?? ""
            avatarURL = (try? c.decode(String.self, forKey: .avatarURL))
                ?? (try? c.decode(String.self, forKey: .mainImageURL))
            tags = (try? c.decode([String].self, forKey: .topics))
                ?? (try? c.decode([String].self, forKey: .tags)) ?? []
            tokenCount = try? c.decode(Int.self, forKey: .tokenCount)
            messageCount = try? c.decode(Int.self, forKey: .messageCount)
        }
    }

    enum ChubError: Error, Equatable {
        case httpError(Int)
        case emptyDownload
    }

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Same query shape as `/api/chub/search` (`server/index.js:1387-1405`),
    /// `min_tokens: 50` included to filter out empty test cards just like there.
    func search(query: String, tags: String?, page: Int, sort: String = "download_count",
                pageSize: Int = 24, nsfw: Bool = false) async throws -> [Character] {
        var components = URLComponents(string: "https://api.chub.ai/search")!
        var items = [
            URLQueryItem(name: "search", value: query),
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "page_size", value: String(pageSize)),
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "min_tokens", value: "50"),
            URLQueryItem(name: "nsfw", value: nsfw ? "true" : "false"),
            URLQueryItem(name: "nsfw_only", value: nsfw ? "true" : "false"),
        ]
        // Only added when a category is active, exactly like `discover.js`'s
        // `if (tags) p.set('tags', tags)` — an empty `tags` param on Chub's
        // API is not the same as omitting it.
        if let tags, !tags.isEmpty { items.append(URLQueryItem(name: "tags", value: tags)) }
        components.queryItems = items

        let (data, response) = try await session.data(from: components.url!)
        try Self.checkStatus(response)
        return try Self.decodeNodes(data)
    }

    /// Character PNG bytes: tries the direct avatar CDN URL first (fast, one
    /// request), falling back to Chub's own download endpoint exactly as the
    /// server does (`server/index.js:1408-1436`).
    func downloadCard(fullPath: String) async throws -> Data {
        if let cdnURL = URL(string: "https://avatars.charhub.io/avatars/\(fullPath)/chara_card_v2.png"),
           let (data, response) = try? await session.data(from: cdnURL),
           (response as? HTTPURLResponse)?.statusCode == 200, data.count > 100 {
            return data
        }

        var request = URLRequest(url: URL(string: "https://api.chub.ai/api/characters/download")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "fullPath": fullPath, "format": "tavern", "version": "main",
        ])
        let (data, response) = try await session.data(for: request)
        try Self.checkStatus(response)
        guard !data.isEmpty else { throw ChubError.emptyDownload }
        return data
    }

    private static func checkStatus(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) else { return }
        throw ChubError.httpError(http.statusCode)
    }

    /// Chub answers `/search` as `{data:{nodes:[...]}}` in some responses and
    /// as a flat `{nodes:[...]}` in others — the same tolerance the web
    /// version has (`data.data?.nodes || data.nodes || []`).
    private static func decodeNodes(_ data: Data) throws -> [Character] {
        struct Wrapper: Decodable {
            let nodes: [Character]
            private enum RootKeys: String, CodingKey { case data, nodes }
            private enum DataKeys: String, CodingKey { case nodes }
            init(from decoder: Decoder) throws {
                let root = try decoder.container(keyedBy: RootKeys.self)
                if let nested = try? root.nestedContainer(keyedBy: DataKeys.self, forKey: .data),
                   let n = try? nested.decode([Character].self, forKey: .nodes) {
                    nodes = n
                } else {
                    nodes = (try? root.decode([Character].self, forKey: .nodes)) ?? []
                }
            }
        }
        return try JSONDecoder().decode(Wrapper.self, from: data).nodes
    }
}
