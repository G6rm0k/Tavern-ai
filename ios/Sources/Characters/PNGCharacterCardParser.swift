import Foundation

/// Reads the character embedded in a Tavern/Chub/CAI-style PNG card —
/// direct port of the chunk walk and field normalization in
/// `server/index.js:828-926`. A card image is a normal PNG with an extra
/// `tEXt` chunk (keyword `"chara"`) whose text is base64-encoded JSON.
enum PNGCharacterCardParser {

    struct ParsedCharacter: Equatable {
        var name: String
        var description: String
        var systemPrompt: String
        var firstMessages: [String]
        var tags: [String]
    }

    enum ParseError: Error, Equatable {
        case noCharacterData
        case invalidBase64
        case invalidJSON
    }

    static func parse(pngData: Data) throws -> ParsedCharacter {
        guard let payload = extractCharaPayload(from: pngData) else {
            throw ParseError.noCharacterData
        }
        guard let jsonData = Data(base64Encoded: payload) else {
            throw ParseError.invalidBase64
        }
        guard let topLevel = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            throw ParseError.invalidJSON
        }
        // v2 cards (and some Chub exports) wrap the actual fields in `.data`;
        // v1/CAI cards have them at the top level.
        let d = (topLevel["data"] as? [String: Any]) ?? topLevel
        return normalize(d: d, topLevel: topLevel)
    }

    // MARK: - Locating the payload

    /// The base64 text of the `chara` `tEXt` chunk, found either by walking
    /// PNG chunks properly or, failing that, by scanning the raw bytes for
    /// the `"chara\0"` marker — the same two-tier lookup the server does,
    /// which recovers cards whose chunk structure got mangled by some other
    /// tool but still have the marker bytes intact somewhere in the file.
    private static func extractCharaPayload(from data: Data) -> String? {
        extractFromChunks(data) ?? extractFromRawScan(data)
    }

    private static func extractFromChunks(_ data: Data) -> String? {
        let bytes = [UInt8](data)
        var pos = 8 // past the 8-byte PNG signature
        while pos < bytes.count - 12 {
            guard pos + 8 <= bytes.count else { break }
            let length = readUInt32BE(bytes, at: pos)
            let dataStart = pos + 8
            let dataEnd = dataStart + Int(length)
            guard dataEnd <= bytes.count else { break }

            let type = String(decoding: bytes[(pos + 4)..<(pos + 8)], as: UTF8.self)
            let chunkData = bytes[dataStart..<dataEnd]
            pos = dataEnd + 4 // skip the trailing 4-byte CRC

            if type == "tEXt", let nullIndex = chunkData.firstIndex(of: 0) {
                let keyword = String(decoding: chunkData[chunkData.startIndex..<nullIndex], as: UTF8.self)
                if keyword == "chara" {
                    return String(decoding: chunkData[(nullIndex + 1)...], as: UTF8.self)
                }
            }
            if type == "IEND" { break }
        }
        return nil
    }

    private static func extractFromRawScan(_ data: Data) -> String? {
        let bytes = [UInt8](data)
        let marker = Array("chara".utf8) + [0]
        guard let markerStart = firstRange(of: marker, in: bytes)?.upperBound else { return nil }
        var end = markerStart
        while end < bytes.count, bytes[end] != 0 { end += 1 }
        guard end > markerStart else { return nil }
        return String(decoding: bytes[markerStart..<end], as: UTF8.self)
    }

    private static func readUInt32BE(_ bytes: [UInt8], at offset: Int) -> UInt32 {
        UInt32(bytes[offset]) << 24 | UInt32(bytes[offset + 1]) << 16
            | UInt32(bytes[offset + 2]) << 8 | UInt32(bytes[offset + 3])
    }

    private static func firstRange(of needle: [UInt8], in haystack: [UInt8]) -> Range<Int>? {
        guard !needle.isEmpty, haystack.count >= needle.count else { return nil }
        for start in 0...(haystack.count - needle.count) where Array(haystack[start..<(start + needle.count)]) == needle {
            return start..<(start + needle.count)
        }
        return nil
    }

    // MARK: - Normalization

    private static func normalize(d: [String: Any], topLevel: [String: Any]) -> ParsedCharacter {
        let name = nonEmptyString(d["name"]) ?? "Imported Character"
        let rawDescription = d["description"] as? String
        let description = rawDescription.map { String($0.prefix(200)) } ?? ""

        var systemPrompt = ""
        if let personality = nonEmptyString(d["personality"]) {
            systemPrompt += personality + "\n\n"
        }
        // Deliberately the *untruncated* description, and only when longer
        // than the 200-char preview kept in `description` above.
        if let rawDescription, rawDescription.count > 200 {
            systemPrompt += rawDescription + "\n\n"
        }
        if let scenario = nonEmptyString(d["scenario"]) {
            systemPrompt += "Scenario: " + scenario + "\n\n"
        }
        if let mesExample = nonEmptyString(d["mes_example"]) {
            systemPrompt += "Example dialogue:\n" + mesExample
        }
        if systemPrompt.isEmpty, let systemPromptField = nonEmptyString(d["system_prompt"]) {
            systemPrompt = systemPromptField
        }
        if systemPrompt.isEmpty, let charPersona = nonEmptyString(d["char_persona"]) {
            systemPrompt = charPersona
        }

        var firstMessages: [String] = []
        if let firstMes = nonEmptyString(d["first_mes"]) {
            firstMessages.append(firstMes)
        }
        if let alternates = d["alternate_greetings"] as? [String] {
            firstMessages.append(contentsOf: alternates)
        }
        if firstMessages.isEmpty {
            firstMessages.append("Привет! Рад тебя видеть.")
        }

        // `tags` reads from the *normalized* object, but its fallback reads
        // `topics` from the *raw, unwrapped* top-level JSON — this asymmetry
        // is intentional in the original and preserved here, not "fixed."
        let tags = (d["tags"] as? [String]) ?? (topLevel["topics"] as? [String]) ?? []

        return ParsedCharacter(
            name: name,
            description: description,
            systemPrompt: systemPrompt.trimmingCharacters(in: .whitespacesAndNewlines),
            firstMessages: firstMessages,
            tags: tags
        )
    }

    private static func nonEmptyString(_ value: Any?) -> String? {
        guard let string = value as? String, !string.isEmpty else { return nil }
        return string
    }
}
