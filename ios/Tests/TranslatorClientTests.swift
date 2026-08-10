import XCTest
@testable import wesaid

final class TranslatorClientTests: XCTestCase {

    override func tearDown() {
        StubURLProtocol.requestHandler = nil
        super.tearDown()
    }

    private func makeClient() -> TranslatorClient {
        TranslatorClient(session: StubURLProtocol.session())
    }

    // MARK: - detectLanguage (pure)

    func testDetectsCyrillicText() {
        XCTAssertEqual(TranslatorClient.detectLanguage("Привет, как дела?"), "ru")
    }

    func testDetectsLatinText() {
        XCTAssertEqual(TranslatorClient.detectLanguage("Hello, how are you?"), "en")
    }

    func testEmptyTextDefaultsToEnglish() {
        XCTAssertEqual(TranslatorClient.detectLanguage(""), "en")
    }

    func testMixedTextWithMostlyCyrillicIsDetectedAsRussian() {
        XCTAssertEqual(TranslatorClient.detectLanguage("Привет OK мир"), "ru")
    }

    // MARK: - translate

    func testSameSourceAndTargetSkipsTheNetworkEntirely() async {
        StubURLProtocol.requestHandler = { _ in
            XCTFail("must not make a network call when from == to")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [])
        }
        let result = await makeClient().translate("Привет", from: "ru", to: "ru")
        XCTAssertEqual(result, "Привет")
    }

    func testBlankTextSkipsTheNetworkEntirely() async {
        StubURLProtocol.requestHandler = { _ in
            XCTFail("must not make a network call for blank text")
            return StubURLProtocol.Stub(statusCode: 200, chunks: [])
        }
        let result = await makeClient().translate("   ", from: "en", to: "ru")
        XCTAssertEqual(result, "   ")
    }

    func testSuccessfulTranslationReturnsTranslatedText() async {
        StubURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.host, "api.mymemory.translated.net")
            let decodedQuery = request.url?.query(percentEncoded: false) ?? ""
            XCTAssertTrue(decodedQuery.contains("langpair=en|ru"), decodedQuery)
            return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"""
            {"responseData":{"translatedText":"Привет"},"responseStatus":200}
            """#.utf8)])
        }
        let result = await makeClient().translate("Hello", from: "en", to: "ru")
        XCTAssertEqual(result, "Привет")
    }

    func testNonNumericButNumericStringResponseStatusIsAcceptedLeniently() async {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"""
            {"responseData":{"translatedText":"Привет"},"responseStatus":"200"}
            """#.utf8)])
        }
        let result = await makeClient().translate("Hello", from: "en", to: "ru")
        XCTAssertEqual(result, "Привет")
    }

    func testMyMemoryErrorStatusFallsBackToOriginalText() async {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"""
            {"responseData":{"translatedText":""},"responseStatus":403}
            """#.utf8)])
        }
        let result = await makeClient().translate("Hello", from: "en", to: "ru")
        XCTAssertEqual(result, "Hello", "an API-level error must not lose the original text")
    }

    func testHTTPErrorFallsBackToOriginalText() async {
        StubURLProtocol.requestHandler = { _ in
            StubURLProtocol.Stub(statusCode: 500, chunks: [])
        }
        let result = await makeClient().translate("Hello", from: "en", to: "ru")
        XCTAssertEqual(result, "Hello")
    }

    func testLongTextIsSplitIntoChunksOfAtMost490Characters() async {
        let longText = String(repeating: "a", count: 1000)
        var requestCount = 0
        StubURLProtocol.requestHandler = { request in
            requestCount += 1
            // Each request's `q` param must never exceed the 490-char chunk limit.
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let qValue = components?.queryItems?.first { $0.name == "q" }?.value ?? ""
            XCTAssertLessThanOrEqual(qValue.count, 490)
            return StubURLProtocol.Stub(statusCode: 200, chunks: [Data(#"""
            {"responseData":{"translatedText":"x"},"responseStatus":200}
            """#.utf8)])
        }
        _ = await makeClient().translate(longText, from: "en", to: "ru")
        XCTAssertEqual(requestCount, 3, "1000 chars at 490/chunk must be 3 requests")
    }
}
