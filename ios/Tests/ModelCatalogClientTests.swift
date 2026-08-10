import XCTest
@testable import wesaid

final class ModelCatalogClientTests: XCTestCase {

    override func tearDown() {
        StubURLProtocol.requestHandler = nil
        super.tearDown()
    }

    private func makeClient() -> ModelCatalogClient {
        ModelCatalogClient(session: StubURLProtocol.session())
    }

    // MARK: - Response shapes

    func testDecodesABareArrayOfStrings() async throws {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"["gpt-4o","gpt-4o-mini"]"#.utf8)])
        }
        let models = try await makeClient().fetchModels(baseURL: "https://api.openai.com/v1", apiKey: "k")
        XCTAssertEqual(models, ["gpt-4o", "gpt-4o-mini"])
    }

    func testDecodesADataWrapperOfObjectsWithId() async throws {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}"#.utf8)])
        }
        let models = try await makeClient().fetchModels(baseURL: "https://api.openai.com/v1", apiKey: "k")
        XCTAssertEqual(models, ["gpt-4o", "gpt-4o-mini"])
    }

    func testDecodesAModelsWrapperFallingBackToName() async throws {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"models":[{"name":"llama3.2"}]}"#.utf8)])
        }
        let models = try await makeClient().fetchModels(baseURL: "http://localhost:11434/v1", apiKey: "")
        XCTAssertEqual(models, ["llama3.2"])
    }

    func testUnrecognisedShapeYieldsAnEmptyListRatherThanThrowing() async throws {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"unexpected":true}"#.utf8)])
        }
        let models = try await makeClient().fetchModels(baseURL: "https://api.openai.com/v1", apiKey: "k")
        XCTAssertEqual(models, [])
    }

    // MARK: - Headers

    func testAnthropicHostGetsXApiKeyNotBearer() async throws {
        StubURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), "secret")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"{"data":[{"id":"claude-3-5-sonnet-20241022"}]}"#.utf8)])
        }
        _ = try await makeClient().fetchModels(baseURL: "https://api.anthropic.com/v1", apiKey: "secret")
    }

    func testOpenAICompatibleHostGetsBearerToken() async throws {
        StubURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"["gpt-4o"]"#.utf8)])
        }
        _ = try await makeClient().fetchModels(baseURL: "https://api.openai.com/v1", apiKey: "secret")
    }

    func testRequestURLAppendsModelsToTheBaseTrimmingTrailingSlash() async throws {
        StubURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.openai.com/v1/models")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [Data("[]".utf8)])
        }
        _ = try await makeClient().fetchModels(baseURL: "https://api.openai.com/v1/", apiKey: "k")
    }

    // MARK: - Errors

    func testInvalidBaseURLThrowsBadURL() async {
        do {
            _ = try await makeClient().fetchModels(baseURL: "not a url", apiKey: "k")
            XCTFail("expected an error")
        } catch let ModelCatalogClient.CatalogError.badURL {
            // expected
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }

    func testHTTPErrorStatusThrows() async {
        StubURLProtocol.requestHandler = { _ in StubURLProtocol.Stub(statusCode: 401, chunks: [Data()]) }
        do {
            _ = try await makeClient().fetchModels(baseURL: "https://api.openai.com/v1", apiKey: "bad-key")
            XCTFail("expected an error")
        } catch let ModelCatalogClient.CatalogError.httpError(status) {
            XCTAssertEqual(status, 401)
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }
}
