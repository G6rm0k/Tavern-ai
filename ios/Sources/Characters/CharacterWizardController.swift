import Foundation

/// AI-assisted character creation — a direct port of `CharWizard` in
/// `public/js/charwizard.js`: the model is driven through a fixed system
/// prompt to propose one field at a time as strict JSON
/// (`{"action":"propose","field":...,"value":...,"explanation":...}` or
/// `{"action":"done","message":...}`), and the user accepts, edits, or
/// rejects each proposal before the wizard moves to the next field.
///
/// Non-streaming (`ChatCompletionService.complete`, not `streamDeltas`) on
/// purpose: the proposal is only ever parsed from the *complete* response
/// anyway, so a token-by-token animation would be cosmetic only — the same
/// simplification `ChatController` already makes for the main chat screen
/// ("shows a typing indicator for the duration instead of a live-growing
/// bubble"), and it avoids that type's documented reason for not mutating
/// `@Published` state from inside a streaming callback.
@MainActor
final class CharacterWizardController: ObservableObject {

    enum Field: String {
        case name, description, systemPrompt, firstMessage
    }

    enum Sender: Equatable {
        case user, bot
    }

    struct Message: Identifiable {
        let id = UUID().uuidString
        let sender: Sender
        var text: String
    }

    struct Proposal {
        let field: Field
        let value: String
        let explanation: String?
    }

    @Published private(set) var messages: [Message] = []
    @Published private(set) var pendingProposal: Proposal?
    @Published private(set) var isThinking = false
    @Published private(set) var isDone = false
    @Published var draftInputText = ""
    @Published private(set) var editingField: Field?
    @Published var errorMessage: String?

    /// Called every time a proposal is accepted or a manually-edited value is
    /// submitted — the character form updates live, field by field, exactly
    /// like `_applyField` in the web version, rather than waiting for the
    /// whole wizard to finish.
    private let onApply: (Field, String) -> Void

    private var history: [UpstreamMessage] = []
    private let completionService: ChatCompletionService
    private let settingsStore: SettingsStore

    static let systemPrompt = """
    Ты — эксперт по созданию персонажей для roleplay-приложения.
    Твоя задача — помочь пользователю создать детального, живого персонажа через диалог.

    Ты работаешь поэтапно:
    1. Сначала спроси: какой тип персонажа хочет пользователь (аниме, реалистичный, фэнтези, sci-fi, ассистент и т.д.)
    2. Спроси имя и краткую идею
    3. Уточни тон: серьёзный / игривый / романтичный / с пошлинками / строгий / etc
    4. Спроси про 18+ контент — да/нет/иногда
    5. Затем ГЕНЕРИРУЙ поля одно за другим, каждый раз предлагая пользователю принять/отредактировать

    Когда предлагаешь поле — ВСЕГДА отвечай СТРОГО в формате JSON:
    {"action":"propose","field":"fieldName","value":"...значение...","explanation":"...почему так..."}

    Поля которые ты заполняешь:
    - name: имя персонажа
    - description: краткое описание (1-2 предложения, показывается на карточке)
    - systemPrompt: подробный системный промпт (характер, манера речи, background, отношение к пользователю, особенности. Используй {{char}} и {{user}})
    - firstMessage: первое сообщение персонажа (живое, в характере, 2-4 предложения)

    После того как все поля приняты — скажи {"action":"done","message":"Персонаж готов! 🎉"}

    Если пользователь просто болтает (не в формате ответа на поле) — отвечай обычным текстом без JSON.
    Пиши на том же языке что и пользователь.
    Будь живым, немного игривым, помогай раскрыть персонажа полностью.
    """

    static let greeting = "Привет! Я помогу тебе создать крутого персонажа для чата.\n\nРасскажи мне — какой персонаж тебе нужен? Это может быть:\n✦ Аниме-герой или героиня\n◆ Фэнтезийный персонаж\n◈ Ассистент с характером\n▸ Романтический компаньон\n▹ Sci-Fi персонаж\n\nИли просто опиши идею своими словами!"

    init(settingsStore: SettingsStore,
         completionService: ChatCompletionService = ChatCompletionService(),
         onApply: @escaping (Field, String) -> Void) {
        self.settingsStore = settingsStore
        self.completionService = completionService
        self.onApply = onApply
        messages.append(Message(sender: .bot, text: Self.greeting))
    }

    // MARK: - User input

    /// `async` rather than firing its own internal `Task` — lets a caller
    /// (a test, or the view's own button action via `Task { await ... }`,
    /// same as `AddProviderView`'s `testConnection()`) await the full round
    /// trip deterministically instead of guessing at a delay.
    func send() async {
        let text = draftInputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isThinking else { return }
        draftInputText = ""

        if let field = editingField {
            editingField = nil
            messages.append(Message(sender: .user, text: text))
            onApply(field, text)
            history.append(UpstreamMessage(role: .user, content: "Принято моё значение для поля: \"\(text)\". Переходи к следующему полю."))
        } else {
            messages.append(Message(sender: .user, text: text))
            history.append(UpstreamMessage(role: .user, content: text))
            pendingProposal = nil
        }
        await ask()
    }

    func accept() async {
        guard let proposal = pendingProposal else { return }
        onApply(proposal.field, proposal.value)
        messages.append(Message(sender: .user, text: "✓ Принято"))
        history.append(UpstreamMessage(role: .user, content: "Принято, переходи к следующему полю."))
        pendingProposal = nil
        await ask()
    }

    func reject() async {
        guard pendingProposal != nil else { return }
        messages.append(Message(sender: .user, text: "✕ Предложи другой вариант"))
        history.append(UpstreamMessage(role: .user, content: "Не подходит, предложи другой вариант для того же поля."))
        pendingProposal = nil
        await ask()
    }

    /// Loads the pending proposal's text into the input field for hand
    /// editing instead of accepting it as-is — the next `send()` applies it
    /// as that field's value, same as accepting would.
    func beginEditingProposal() {
        guard let proposal = pendingProposal else { return }
        draftInputText = proposal.value
        editingField = proposal.field
        pendingProposal = nil
        messages.append(Message(sender: .bot, text: "✏️ Отредактируй и отправь свой вариант:"))
    }

    // MARK: - Model round trip

    private func ask() async {
        guard let provider = settingsStore.activeProvider else {
            errorMessage = "Нет активного провайдера. Настрой API в настройках."
            return
        }
        isThinking = true
        defer { isThinking = false }

        let request = ChatCompletionRequest(messages: history, model: provider.model, systemPrompt: Self.systemPrompt)
        let apiKey = settingsStore.apiKey(for: provider.id)

        do {
            let reply = try await completionService.complete(request: request, baseURL: provider.baseUrl, apiKey: apiKey)
            guard !reply.isEmpty else { return }
            history.append(UpstreamMessage(role: .assistant, content: reply))
            apply(reply)
        } catch {
            errorMessage = Self.describe(error)
        }
    }

    /// Parses `{"action":"propose",...}` / `{"action":"done",...}` out of the
    /// reply and shows whatever isn't JSON as an ordinary chat bubble — same
    /// dual behaviour as `_parseResponse` in the web version, which lets the
    /// model chat normally between proposals.
    private func apply(_ reply: String) {
        guard let json = Self.extractAction(from: reply),
              let action = try? JSONDecoder().decode(WizardAction.self, from: json) else {
            messages.append(Message(sender: .bot, text: reply))
            return
        }

        switch action.action {
        case "propose":
            guard let fieldRaw = action.field, let field = Field(rawValue: fieldRaw), let value = action.value else { return }
            pendingProposal = Proposal(field: field, value: value, explanation: action.explanation)
            if let explanation = action.explanation, !explanation.isEmpty {
                messages.append(Message(sender: .bot, text: "💡 " + explanation))
            }
        case "done":
            isDone = true
            messages.append(Message(sender: .bot, text: action.message ?? "Персонаж готов! 🎉"))
        default:
            break
        }
    }

    private struct WizardAction: Decodable {
        let action: String
        let field: String?
        let value: String?
        let explanation: String?
        let message: String?
    }

    /// Same idea as the web version's `/\{[\s\S]*"action"[\s\S]*\}/`: take
    /// everything from the first `{` to the last `}`, provided "action"
    /// shows up somewhere in between. The model's replies are short enough
    /// in practice that this — not a real JSON-aware scan — is what the
    /// original relies on too.
    private static func extractAction(from text: String) -> Data? {
        guard let open = text.firstIndex(of: "{"), let close = text.lastIndex(of: "}"), open < close else { return nil }
        let candidate = text[open...close]
        guard candidate.contains("\"action\"") else { return nil }
        return Data(candidate.utf8)
    }

    private static func describe(_ error: Error) -> String {
        switch error {
        case ChatServiceError.noKey:
            return "Не указан API-ключ для активного провайдера."
        case ChatServiceError.badURL:
            return "Некорректный адрес провайдера."
        case ChatServiceError.connectionRefused:
            return "Не получилось подключиться к провайдеру."
        case ChatServiceError.noNetwork:
            return "Нет подключения к интернету."
        case ChatServiceError.httpError(let status, _):
            return "Провайдер ответил ошибкой \(status)."
        case ChatServiceError.network(let message):
            return message
        default:
            return error.localizedDescription
        }
    }
}
