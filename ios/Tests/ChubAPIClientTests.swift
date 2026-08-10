import XCTest
@testable import wesaid

/// Same `StubURLProtocol` used for the provider-facing dialects, here
/// standing in for `api.chub.ai` / `avatars.charhub.io` — no real network,
/// but a real `URLSession` and real JSON decoding.
final class ChubAPIClientTests: XCTestCase {

    override func tearDown() {
        StubURLProtocol.requestHandler = nil
        super.tearDown()
    }

    private func makeClient() -> ChubAPIClient {
        ChubAPIClient(session: StubURLProtocol.session())
    }

    // MARK: - Search response shapes

    func testDecodesNestedDataNodesShape() async throws {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"""
            {"data":{"nodes":[{"fullPath":"a/b","name":"Рэйк","avatar_url":"https://x/a.png","topics":["pirate"]}]}}
            """#.utf8)])
        }
        let results = try await makeClient().search(query: "рэйк", tags: nil, page: 1)
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].fullPath, "a/b")
        XCTAssertEqual(results[0].name, "Рэйк")
        XCTAssertEqual(results[0].avatarURL, "https://x/a.png")
        XCTAssertEqual(results[0].tags, ["pirate"])
    }

    func testDecodesFlatNodesShape() async throws {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"""
            {"nodes":[{"full_path":"c/d","title":"Мия","main_image_url":"https://x/b.png","tags":["anime"]}]}
            """#.utf8)])
        }
        let results = try await makeClient().search(query: "", tags: nil, page: 1)
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].fullPath, "c/d")
        XCTAssertEqual(results[0].name, "Мия")
        XCTAssertEqual(results[0].avatarURL, "https://x/b.png")
        XCTAssertEqual(results[0].tags, ["anime"])
    }

    func testMissingFieldsFallBackRatherThanThrow() async throws {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"nodes":[{}]}"#.utf8)])
        }
        let results = try await makeClient().search(query: "", tags: nil, page: 1)
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].fullPath, "")
        XCTAssertEqual(results[0].name, "?")
        XCTAssertNil(results[0].avatarURL)
        XCTAssertEqual(results[0].tags, [])
    }

    func testEmptyOrUnrecognisedBodyYieldsNoResultsRatherThanThrowing() async throws {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"unexpected":true}"#.utf8)])
        }
        let results = try await makeClient().search(query: "", tags: nil, page: 1)
        XCTAssertEqual(results, [])
    }

    // MARK: - Request shape

    func testTagsAreOmittedWhenNoCategoryIsActive() async throws {
        var capturedURL: URL?
        StubURLProtocol.requestHandler = { request in
            capturedURL = request.url
            return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"nodes":[]}"#.utf8)])
        }
        _ = try await makeClient().search(query: "мия", tags: nil, page: 1)
        let query = capturedURL?.query ?? ""
        XCTAssertFalse(query.contains("tags="), "no category selected must mean no tags param at all: \(query)")
        XCTAssertTrue(query.contains("min_tokens=50"), query)
    }

    func testTagsAreIncludedWhenACategoryIsActive() async throws {
        var capturedURL: URL?
        StubURLProtocol.requestHandler = { request in
            capturedURL = request.url
            return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"nodes":[]}"#.utf8)])
        }
        _ = try await makeClient().search(query: "", tags: "russian", page: 1, nsfw: false)
        let query = capturedURL?.query ?? ""
        XCTAssertTrue(query.contains("tags=russian"), query)
    }

    func testHTTPErrorStatusThrows() async {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 503, chunks: [Data()])
        }
        do {
            _ = try await makeClient().search(query: "", tags: nil, page: 1)
            XCTFail("expected an error")
        } catch let ChubAPIClient.ChubError.httpError(status) {
            XCTAssertEqual(status, 503)
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }

    // MARK: - Download

    func testDownloadPrefersTheDirectAvatarCDNWhenItSucceeds() async throws {
        let bytes = Data(repeating: 7, count: 200)
        StubURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.host, "avatars.charhub.io")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [bytes])
        }
        let data = try await makeClient().downloadCard(fullPath: "a/b")
        XCTAssertEqual(data, bytes)
    }

    func testDownloadFallsBackToTheAPIWhenTheCDNMisses() async throws {
        let bytes = Data(repeating: 9, count: 300)
        StubURLProtocol.requestHandler = { request in
            if request.url?.host == "avatars.charhub.io" {
                return StubURLProtocol.Stub(statusCode: 404, chunks: [])
            }
            XCTAssertEqual(request.httpMethod, "POST")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [bytes])
        }
        let data = try await makeClient().downloadCard(fullPath: "a/b")
        XCTAssertEqual(data, bytes)
    }

    func testDownloadFallsBackWhenTheCDNBodyIsSuspiciouslySmall() async throws {
        let bytes = Data(repeating: 3, count: 50)
        StubURLProtocol.requestHandler = { request in
            if request.url?.host == "avatars.charhub.io" {
                // A too-small "success" is treated as a miss, same threshold
                // as the server's `alt.buffer.length > 100` check.
                return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(repeating: 1, count: 10)])
            }
            return StubURLProtocol.Stub(statusCode: 200, chunks: [bytes])
        }
        let data = try await makeClient().downloadCard(fullPath: "a/b")
        XCTAssertEqual(data, bytes)
    }

    func testDownloadThrowsWhenBothSourcesFail() async {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 500, chunks: [])
        }
        do {
            _ = try await makeClient().downloadCard(fullPath: "a/b")
            XCTFail("expected an error")
        } catch let ChubAPIClient.ChubError.httpError(status) {
            XCTAssertEqual(status, 500)
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }
}
