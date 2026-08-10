import XCTest
@testable import wesaid

/// Builds minimal-but-valid PNG byte streams so these tests exercise the
/// real chunk walk rather than a fixture file — no binary asset needed in
/// the Xcode project, and the malformed-input cases are trivial to construct.
private enum TestPNG {
    static let signature: [UInt8] = [137, 80, 78, 71, 13, 10, 26, 10]

    static func chunk(type: String, data: [UInt8]) -> [UInt8] {
        let length = UInt32(data.count)
        var bytes: [UInt8] = [
            UInt8((length >> 24) & 0xFF), UInt8((length >> 16) & 0xFF),
            UInt8((length >> 8) & 0xFF), UInt8(length & 0xFF)
        ]
        bytes += Array(type.utf8)
        bytes += data
        bytes += [0, 0, 0, 0] // CRC — never read by the parser
        return bytes
    }

    /// A normal, well-formed card: signature, one `tEXt` chunk carrying
    /// `chara`, IEND.
    static func withCharaChunk(base64Payload: String, keyword: String = "chara") -> Data {
        var bytes = signature
        let textData = Array(keyword.utf8) + [0] + Array(base64Payload.utf8)
        bytes += chunk(type: "tEXt", data: textData)
        bytes += chunk(type: "IEND", data: [])
        return Data(bytes)
    }

    /// No chunk structure at all — just the marker bytes sitting somewhere
    /// in the file, simulating a card whose chunk boundaries got mangled by
    /// some other tool but whose raw bytes still carry the payload.
    static func rawMarkerOnly(base64Payload: String) -> Data {
        var bytes = signature
        bytes += Array("garbage before ".utf8)
        bytes += Array("chara".utf8) + [0]
        bytes += Array(base64Payload.utf8)
        bytes += [0]
        bytes += Array(" trailing garbage".utf8)
        return Data(bytes)
    }

    static func base64(forJSONObject object: [String: Any]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: object)
        return data.base64EncodedString()
    }
}

final class PNGCharacterCardParserTests: XCTestCase {

    // MARK: - Locating the payload

    func testParsesCharaFromWellFormedTEXtChunk() throws {
        let png = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: ["name": "Рэйк"]))
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.name, "Рэйк")
    }

    func testIgnoresTEXtChunksWithADifferentKeyword() throws {
        let png = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: ["name": "Рэйк"]), keyword: "software")
        XCTAssertThrowsError(try PNGCharacterCardParser.parse(pngData: png)) {
            XCTAssertEqual($0 as? PNGCharacterCardParser.ParseError, .noCharacterData)
        }
    }

    func testFallsBackToRawByteScanWhenChunkStructureIsBroken() throws {
        let png = TestPNG.rawMarkerOnly(base64Payload: TestPNG.base64(forJSONObject: ["name": "Мия"]))
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.name, "Мия")
    }

    func testThrowsWhenNoCharaMarkerExistsAnywhere() {
        let png = Data(TestPNG.signature + TestPNG.chunk(type: "IEND", data: []))
        XCTAssertThrowsError(try PNGCharacterCardParser.parse(pngData: png)) {
            XCTAssertEqual($0 as? PNGCharacterCardParser.ParseError, .noCharacterData)
        }
    }

    func testThrowsOnInvalidBase64Payload() {
        let png = TestPNG.withCharaChunk(base64Payload: "not valid base64!!!")
        XCTAssertThrowsError(try PNGCharacterCardParser.parse(pngData: png)) {
            XCTAssertEqual($0 as? PNGCharacterCardParser.ParseError, .invalidBase64)
        }
    }

    func testThrowsOnBase64ThatIsNotJSON() {
        let payload = Data("not json at all".utf8).base64EncodedString()
        let png = TestPNG.withCharaChunk(base64Payload: payload)
        XCTAssertThrowsError(try PNGCharacterCardParser.parse(pngData: png)) {
            XCTAssertEqual($0 as? PNGCharacterCardParser.ParseError, .invalidJSON)
        }
    }

    // MARK: - `.data` wrapper (v2 cards)

    func testUnwrapsV2DataField() throws {
        let payload = TestPNG.base64(forJSONObject: ["data": ["name": "Капитан"], "topics": ["pirate"]])
        let png = TestPNG.withCharaChunk(base64Payload: payload)
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.name, "Капитан")
        XCTAssertEqual(parsed.tags, ["pirate"], "topics on the raw top level must still be reachable through the wrapper")
    }

    // MARK: - Field defaults

    func testNameFallsBackWhenMissingOrEmpty() throws {
        for object: [String: Any] in [[:], ["name": ""]] {
            let png = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: object))
            let parsed = try PNGCharacterCardParser.parse(pngData: png)
            XCTAssertEqual(parsed.name, "Imported Character")
        }
    }

    func testDescriptionIsKeptEvenWhenEmptyStringButNilWhenAbsent() throws {
        let withEmpty = try PNGCharacterCardParser.parse(pngData: TestPNG.withCharaChunk(
            base64Payload: TestPNG.base64(forJSONObject: ["description": ""])))
        XCTAssertEqual(withEmpty.description, "")

        let withMissing = try PNGCharacterCardParser.parse(pngData: TestPNG.withCharaChunk(
            base64Payload: TestPNG.base64(forJSONObject: [:])))
        XCTAssertEqual(withMissing.description, "")
    }

    func testDescriptionIsTruncatedToTwoHundredCharacters() throws {
        let long = String(repeating: "a", count: 250)
        let png = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: ["description": long]))
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.description.count, 200)
    }

    func testFirstMessagesFallBackToAGreetingWhenNoneProvided() throws {
        let png = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: [:]))
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.firstMessages, ["Привет! Рад тебя видеть."])
    }

    func testFirstMessagesCombinesFirstMesAndAlternates() throws {
        let object: [String: Any] = ["first_mes": "Привет.", "alternate_greetings": ["Здорово.", "Йо."]]
        let png = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: object))
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.firstMessages, ["Привет.", "Здорово.", "Йо."])
    }

    // MARK: - tags asymmetry (intentional, not a bug to "fix")

    func testTagsPrefersNormalizedDataTagsOverTopLevelTopics() throws {
        let payload = TestPNG.base64(forJSONObject: ["data": ["tags": ["rp"]], "topics": ["should-be-ignored"]])
        let png = TestPNG.withCharaChunk(base64Payload: payload)
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.tags, ["rp"])
    }

    func testTagsFallsBackToRawTopLevelTopicsWhenDataHasNoTags() throws {
        let payload = TestPNG.base64(forJSONObject: ["data": ["name": "X"], "topics": ["fantasy"]])
        let png = TestPNG.withCharaChunk(base64Payload: payload)
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.tags, ["fantasy"])
    }

    func testTagsAreEmptyWhenNeitherIsPresent() throws {
        let png = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: [:]))
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.tags, [])
    }

    // MARK: - systemPrompt construction order

    func testSystemPromptCombinesPersonalityScenarioAndExample() throws {
        let object: [String: Any] = [
            "personality": "Дружелюбный.",
            "scenario": "На корабле.",
            "mes_example": "Пример реплики."
        ]
        let png = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: object))
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.systemPrompt, "Дружелюбный.\n\nScenario: На корабле.\n\nExample dialogue:\nПример реплики.")
    }

    /// The *untruncated* description is folded into the system prompt, and
    /// only when it is longer than the 200-char preview — a short
    /// description must not appear twice.
    func testLongDescriptionIsAppendedUntruncatedButShortIsNot() throws {
        let long = String(repeating: "б", count: 210)
        let longPng = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: ["description": long]))
        let longParsed = try PNGCharacterCardParser.parse(pngData: longPng)
        XCTAssertTrue(longParsed.systemPrompt.hasPrefix(long), "must use the full untruncated description")
        XCTAssertEqual(longParsed.systemPrompt.count, long.count)

        let short = "Коротко."
        let shortPng = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: ["description": short]))
        let shortParsed = try PNGCharacterCardParser.parse(pngData: shortPng)
        XCTAssertEqual(shortParsed.systemPrompt, "", "a short description must not be duplicated into the system prompt")
    }

    func testSystemPromptFallsBackToSystemPromptFieldThenCharPersona() throws {
        let viaSystemPrompt = try PNGCharacterCardParser.parse(pngData: TestPNG.withCharaChunk(
            base64Payload: TestPNG.base64(forJSONObject: ["system_prompt": "Инструкция.", "char_persona": "Игнорируется."])))
        XCTAssertEqual(viaSystemPrompt.systemPrompt, "Инструкция.")

        let viaCharPersona = try PNGCharacterCardParser.parse(pngData: TestPNG.withCharaChunk(
            base64Payload: TestPNG.base64(forJSONObject: ["char_persona": "Личность."])))
        XCTAssertEqual(viaCharPersona.systemPrompt, "Личность.")
    }

    func testSystemPromptIsEmptyWhenNothingIsProvided() throws {
        let png = TestPNG.withCharaChunk(base64Payload: TestPNG.base64(forJSONObject: [:]))
        let parsed = try PNGCharacterCardParser.parse(pngData: png)
        XCTAssertEqual(parsed.systemPrompt, "")
    }
}
