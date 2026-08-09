import XCTest
@testable import wesaid

/// The four pure pieces of chat business logic: lorebook matching (including
/// the Russian-stemming case that motivated it), prompt assembly, the
/// context window, and memory summarisation's gating/formatting. None of
/// these touch the network or disk, so they run the same way here as in the
/// real app — no stubbing needed.
final class ChatLogicTests: XCTestCase {

    // MARK: - LorebookMatcher

    func testMatchesExactSubstring() {
        XCTAssertTrue(LorebookMatcher.matches(key: "маяк", haystack: "у берега стоит старый маяк"))
        XCTAssertFalse(LorebookMatcher.matches(key: "маяк", haystack: "здесь ничего нет"))
    }

    /// The motivating case: "башня" (nominative) as a key must still fire on
    /// "башню" (accusative) in the message — plain substring matching would
    /// miss ordinary Russian declension entirely.
    func testMatchesRussianStemForKeysOfFiveOrMoreCharacters() {
        XCTAssertTrue(LorebookMatcher.matches(key: "башня", haystack: "ты видишь высокую башню вдалеке"))
        XCTAssertTrue(LorebookMatcher.matches(key: "БАШНЯ", haystack: "высокую башню"), "matching must be case-insensitive")
    }

    func testStemFallbackDoesNotApplyBelowFiveCharacters() {
        // "порт" (4 chars) must not fall back to its stem "пор" and match
        // unrelated words that merely start with those three letters.
        XCTAssertFalse(LorebookMatcher.matches(key: "порт", haystack: "поросёнок гулял по полю"))
        XCTAssertTrue(LorebookMatcher.matches(key: "порт", haystack: "мы прибыли в порт"), "an exact match must still work below the threshold")
    }

    func testMatchesRejectsEmptyOrBlankKey() {
        XCTAssertFalse(LorebookMatcher.matches(key: "", haystack: "что угодно"))
        XCTAssertFalse(LorebookMatcher.matches(key: "   ", haystack: "что угодно"))
    }

    func testMatchedEntriesSkipsEntriesWithEmptyContent() {
        let book = [LorebookEntry(keys: ["маяк"], content: "")]
        let recent = [UpstreamMessage(role: .user, content: "виден маяк")]
        XCTAssertEqual(LorebookMatcher.matchedEntries(book: book, recentContext: recent), [])
    }

    func testMatchedEntriesOnlyReturnsHits() {
        let hit = LorebookEntry(id: "hit", keys: ["маяк"], content: "Маяк не работает с прошлой зимы.")
        let miss = LorebookEntry(id: "miss", keys: ["дракон"], content: "Драконов тут не водится.")
        let recent = [UpstreamMessage(role: .user, content: "Что видно у маяка?")]
        XCTAssertEqual(LorebookMatcher.matchedEntries(book: [hit, miss], recentContext: recent), [hit])
    }

    func testLoreBlockIsNilWithoutHits() {
        XCTAssertNil(LorebookMatcher.loreBlock(book: [], recentContext: [], fill: { $0 }))
    }

    func testLoreBlockJoinsFilledHitsUnderHeader() {
        let book = [LorebookEntry(keys: ["маяк"], content: "Про {{char}}: маяк погас.")]
        let recent = [UpstreamMessage(role: .user, content: "маяк виден?")]
        let block = LorebookMatcher.loreBlock(book: book, recentContext: recent) { text in
            text.replacingOccurrences(of: "{{char}}", with: "Рэйк")
        }
        XCTAssertEqual(block, "[Важные сведения]\nПро Рэйк: маяк погас.")
    }

    // MARK: - PromptAssembler.fill / userName

    func testFillReplacesAllOccurrences() {
        let result = PromptAssembler.fill("{{char}} говорит с {{user}}, а {{user}} слушает {{char}}.",
                                           characterName: "Рэйк", userName: "Гера")
        XCTAssertEqual(result, "Рэйк говорит с Гера, а Гера слушает Рэйк.")
    }

    func testUserNameUsesTrimmedPersonaName() {
        XCTAssertEqual(PromptAssembler.userName(persona: Persona(name: "  Гера  ")), "Гера")
    }

    func testUserNameFallsBackWhenPersonaNameIsBlank() {
        XCTAssertEqual(PromptAssembler.userName(persona: Persona(name: "")), "User")
        XCTAssertEqual(PromptAssembler.userName(persona: Persona(name: "   ")), "User")
    }

    // MARK: - PromptAssembler.buildSystemPrompt

    func testBuildSystemPromptIsEmptyWithNothingConfigured() {
        let result = PromptAssembler.buildSystemPrompt(
            character: nil, characterName: "Рэйк", globalSystem: "", persona: Persona(),
            memorySummary: "", recentContext: []
        )
        XCTAssertEqual(result, "")
    }

    /// `{{char}}` must resolve to the chat's own snapshot of the character's
    /// name, not the live character object's name — a chat keeps referring
    /// to whoever it was started with even after a rename.
    func testCharacterPlaceholderUsesChatSnapshotNameNotLiveCharacterName() {
        let character = CharacterCard(name: "Капитан Рэйк (переименован)", systemPrompt: "Ты — {{char}}.")
        let result = PromptAssembler.buildSystemPrompt(
            character: character, characterName: "Капитан Рэйк", globalSystem: "", persona: Persona(),
            memorySummary: "", recentContext: []
        )
        XCTAssertEqual(result, "Ты — Капитан Рэйк.")
    }

    func testBuildSystemPromptOrdersAndJoinsSections() {
        let character = CharacterCard(name: "Рэйк", systemPrompt: "Ты {{char}}, а {{user}} — гость.",
                                       lorebook: [LorebookEntry(keys: ["маяк"], content: "Маяк погас.")])
        let persona = Persona(name: "Гера", description: "  Любит море  ")
        let result = PromptAssembler.buildSystemPrompt(
            character: character, characterName: "Рэйк", globalSystem: "Будь краток.", persona: persona,
            memorySummary: "Уже познакомились.",
            recentContext: [UpstreamMessage(role: .user, content: "виден маяк?")]
        )
        XCTAssertEqual(result, [
            "Будь краток.",
            "Ты Рэйк, а Гера — гость.",
            "[О собеседнике по имени Гера]\nЛюбит море",
            "[Что было раньше в этом разговоре]\nУже познакомились.",
            "[Важные сведения]\nМаяк погас."
        ].joined(separator: "\n\n"))
    }

    func testBuildSystemPromptOmitsBlankPersonaDescription() {
        let result = PromptAssembler.buildSystemPrompt(
            character: nil, characterName: "Рэйк", globalSystem: "", persona: Persona(name: "Гера", description: "   "),
            memorySummary: "", recentContext: []
        )
        XCTAssertEqual(result, "")
    }

    func testForceThinkingIsOffByDefault() {
        let result = PromptAssembler.buildSystemPrompt(
            character: nil, characterName: "Рэйк", globalSystem: "Будь краток.", persona: Persona(),
            memorySummary: "", recentContext: []
        )
        XCTAssertEqual(result, "Будь краток.")
    }

    func testForceThinkingPrependsInstructionBeforeEverythingElse() {
        let result = PromptAssembler.buildSystemPrompt(
            character: nil, characterName: "Рэйк", globalSystem: "Будь краток.", persona: Persona(),
            memorySummary: "", recentContext: [], forceThinking: true
        )
        XCTAssertEqual(result, [PromptAssembler.thinkingInstruction, "Будь краток."].joined(separator: "\n\n"))
    }

    // MARK: - ContextWindow

    func testContextWindowKeepsOnlyLastLimitMessages() {
        let messages = (1...5).map { ChatMessage(id: "\($0)", role: .user, content: "msg\($0)") }
        let result = ContextWindow.messages(from: messages, excluding: nil, limit: 2)
        XCTAssertEqual(result.map(\.content), ["msg4", "msg5"])
    }

    func testContextWindowStopsBeforeExcludedMessage() {
        let messages = [
            ChatMessage(id: "1", role: .user, content: "a"),
            ChatMessage(id: "2", role: .assistant, content: "b"),
            ChatMessage(id: "3", role: .user, content: "c")
        ]
        let result = ContextWindow.messages(from: messages, excluding: "3", limit: 20)
        XCTAssertEqual(result.map(\.content), ["a", "b"], "regenerating message 3 must not see message 3 itself")
    }

    func testContextWindowReducesToRoleAndContentOnly() {
        let message = ChatMessage(id: "1", role: .assistant, content: "hi", variants: ["hi", "hello"], variantIndex: 1)
        let result = ContextWindow.messages(from: [message], excluding: nil, limit: 10)
        XCTAssertEqual(result, [UpstreamMessage(role: .assistant, content: "hi")])
    }

    // MARK: - MemorySummarizer

    func testShouldSummariseRequiresAtLeastTwiceTheWindow() {
        XCTAssertFalse(MemorySummarizer.shouldSummarise(messageCount: 39, keep: 20, alreadySummarisedUpTo: 0))
        XCTAssertTrue(MemorySummarizer.shouldSummarise(messageCount: 40, keep: 20, alreadySummarisedUpTo: 0))
    }

    func testShouldSummariseSkipsWhenAlreadyCoveredUpToTheCut() {
        // 40 messages, keep 20 -> cut is the first 20; already summarised
        // through all 20 means there is nothing new to compress.
        XCTAssertFalse(MemorySummarizer.shouldSummarise(messageCount: 40, keep: 20, alreadySummarisedUpTo: 20))
        XCTAssertTrue(MemorySummarizer.shouldSummarise(messageCount: 41, keep: 20, alreadySummarisedUpTo: 20))
    }

    func testCutCountNeverGoesNegative() {
        XCTAssertEqual(MemorySummarizer.cutCount(messageCount: 5, keep: 20), 0)
        XCTAssertEqual(MemorySummarizer.cutCount(messageCount: 40, keep: 20), 20)
    }

    func testTranscriptLabelsSpeakerByRole() {
        let messages = [
            ChatMessage(id: "1", role: .user, content: "Привет"),
            ChatMessage(id: "2", role: .assistant, content: "И тебе привет")
        ]
        let result = MemorySummarizer.transcript(cutMessages: messages, userName: "Гера", characterName: "Рэйк")
        XCTAssertEqual(result, "Гера: Привет\nРэйк: И тебе привет")
    }

    func testUserContentPassesTranscriptThroughWithoutExistingSummary() {
        XCTAssertEqual(MemorySummarizer.userContent(existingSummary: "", transcript: "Гера: привет"), "Гера: привет")
    }

    func testUserContentPrependsExistingSummary() {
        let result = MemorySummarizer.userContent(existingSummary: "Уже встречались.", transcript: "Гера: привет")
        XCTAssertEqual(result, "Уже известно:\nУже встречались.\n\nНовая часть переписки:\nГера: привет")
    }
}
