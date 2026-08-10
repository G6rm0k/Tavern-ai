import Foundation

/// Drives one open conversation: sending, streaming a reply, stopping,
/// swiping between variants, and regenerating. Mirrors `Chat.send` /
/// `Chat._generate` / `Chat.swipe` / `Chat.regen` from the web version.
///
/// A reply is not applied to `chat.messages` (or shown) token by token —
/// `onDelta` runs off the main actor (it is called from inside
/// `ChatCompletionService`, which is not actor-isolated), so pushing each
/// delta straight into a `@Published` property from there would be an
/// unsynchronized cross-actor mutation. The web version has the same shape
/// underneath (the growing reply lives in a local `full` variable and only
/// reaches `this.current.messages` once the stream finishes); the only
/// difference here is the UI shows a typing indicator for the duration
/// instead of a live-growing bubble, which would need a safe way to hop
/// back to the main actor per token — worth doing, just not in this phase.
@MainActor
final class ChatController: ObservableObject {

    @Published private(set) var chat: ChatSession
    @Published private(set) var isStreaming = false
    @Published var draftInputText = ""
    @Published var lastError: Error?
    /// Per-chat override of the global default, toggled from the brain icon
    /// next to the input bar. Transient (not persisted to `ChatSession`) —
    /// reopening a chat picks the current global default back up.
    @Published var forceThinking: Bool
    /// Per-chat model override, picked from any provider's starred models
    /// next to the input bar — `nil` means "use the active provider's own
    /// default model." Transient for the same reason `forceThinking` is: this
    /// is a this-conversation choice, not a change to any provider's settings.
    /// Carries its own `providerID` because a favorite can belong to a
    /// *different* provider than the currently active one — picking it
    /// switches which provider's key/address `generate()` uses too, not just
    /// the model string (see `effectiveProvider`).
    @Published var modelOverride: ModelChoice?
    /// Set when regenerating a reply that has messages after it — confirming
    /// abandons that branch of the conversation. `nil` once resolved either way.
    @Published var pendingRegenerateTruncation: String?

    private let chatStore: ChatStore
    private let characterStore: CharacterStore
    private let settingsStore: SettingsStore
    private let completionService: ChatCompletionService
    private var streamTask: Task<Void, Never>?

    init(chat: ChatSession,
         chatStore: ChatStore,
         characterStore: CharacterStore,
         settingsStore: SettingsStore,
         completionService: ChatCompletionService = ChatCompletionService()) {
        self.chat = chat
        self.chatStore = chatStore
        self.characterStore = characterStore
        self.settingsStore = settingsStore
        self.completionService = completionService
        self.forceThinking = settingsStore.settings.preferences.forceThinkingByDefault
    }

    /// The live character, looked up fresh every access — not the chat's own
    /// name/avatar snapshot. `nil` once the character has been deleted, which
    /// the chat itself survives (see `characterName`/`characterAvatar` on
    /// `ChatSession`). Exposed (not `private`) so the chat screen's profile
    /// sheet can open the same character for full editing.
    var character: CharacterCard? {
        characterStore.character(id: chat.characterId)
    }

    /// Who `{{user}}` refers to, for anything the View layer needs to fill
    /// outside of a request going upstream (e.g. a character's static
    /// greeting text, which is written with the same placeholders as its
    /// system prompt but isn't part of `generate()`'s own fill step).
    var displayUserName: String {
        PromptAssembler.userName(persona: settingsStore.settings.persona)
    }

    /// The provider the next message actually goes to: the override's own
    /// provider if it still exists, otherwise the active provider. A
    /// favorite's provider can vanish (deleted from Settings after being
    /// starred) — falling back rather than sending to a dead id.
    var effectiveProvider: Provider? {
        if let modelOverride, let provider = settingsStore.settings.providers.first(where: { $0.id == modelOverride.providerID }) {
            return provider
        }
        return settingsStore.activeProvider
    }

    /// The model this chat will actually use on the next message: the
    /// per-chat override if one is set *and its provider still exists*,
    /// otherwise the active provider's own default. Gated on the same
    /// existence check as `effectiveProvider` on purpose — an override whose
    /// provider was deleted must fall back on both fronts together, or the
    /// two could disagree (provider A's key paired with a model name that
    /// was only ever valid for since-deleted provider B).
    var effectiveModel: String {
        if let modelOverride, settingsStore.settings.providers.contains(where: { $0.id == modelOverride.providerID }) {
            return modelOverride.model
        }
        return settingsStore.activeProvider?.model ?? ""
    }

    /// Every provider's starred models, plus the *active* provider's own
    /// default (so switching away and back is always possible even if that
    /// model was never itself starred) — one flat list spanning providers,
    /// not scoped to whichever is active right now.
    var modelChoices: [ModelChoice] {
        var choices: [ModelChoice] = []
        if let active = settingsStore.activeProvider, !active.model.isEmpty {
            choices.append(ModelChoice(providerID: active.id, model: active.model))
        }
        for favorite in settingsStore.settings.favoriteModels {
            let choice = ModelChoice(providerID: favorite.providerID, model: favorite.model)
            guard !choices.contains(choice) else { continue }
            choices.append(choice)
        }
        return choices
    }

    // MARK: - Send

    func send(_ rawText: String) {
        guard !isStreaming else { return }
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, effectiveProvider != nil else { return }

        draftInputText = ""
        let userMessage = ChatMessage(role: .user, content: text)
        chat.messages.append(userMessage)
        persist(touch: true)

        streamTask = Task {
            await self.generate(variantOf: nil, restoreOnFail: text)
            await self.maybeSummarise()
        }
    }

    // MARK: - Swipe

    /// `direction` is `+1`/`-1`. Swiping past the newest variant asks for a
    /// fresh one instead of doing nothing.
    func swipe(messageID: String, direction: Int) {
        guard !isStreaming, let index = chat.messages.firstIndex(where: { $0.id == messageID }) else { return }
        let message = chat.messages[index]
        guard !message.variants.isEmpty else { return }
        let next = message.variantIndex + direction

        if next >= message.variants.count {
            regenerate(messageID: messageID)
            return
        }
        guard next >= 0 else { return }

        chat.messages[index].variantIndex = next
        chat.messages[index].content = message.variants[next]
        persist(touch: false)
    }

    // MARK: - Regenerate

    /// Only the assistant's most recent reply carries a lorebook/context
    /// window consistent with "leave everything else as is" — regenerating
    /// an earlier one abandons every message after it.
    func regenerate(messageID: String) {
        guard !isStreaming,
              let index = chat.messages.firstIndex(where: { $0.id == messageID }),
              chat.messages[index].role == .assistant else { return }

        guard index < chat.messages.count - 1 else {
            streamTask = Task { await self.generate(variantOf: messageID, restoreOnFail: nil) }
            return
        }
        pendingRegenerateTruncation = messageID
    }

    func confirmRegenerateTruncation() {
        guard let messageID = pendingRegenerateTruncation,
              let index = chat.messages.firstIndex(where: { $0.id == messageID }) else {
            pendingRegenerateTruncation = nil
            return
        }
        pendingRegenerateTruncation = nil
        chat.messages = Array(chat.messages[...index])
        persist(touch: false)
        streamTask = Task { await self.generate(variantOf: messageID, restoreOnFail: nil) }
    }

    func cancelRegenerateTruncation() {
        pendingRegenerateTruncation = nil
    }

    // MARK: - Stop

    /// Cancels the in-flight request. Structured concurrency does the rest —
    /// `streamDeltas` throws `URLError(.cancelled)`, which `generate` treats
    /// as "keep whatever streamed in so far," not a failure.
    func stop() {
        streamTask?.cancel()
    }

    // MARK: - Generation

    private func generate(variantOf: String?, restoreOnFail: String?) async {
        guard let provider = effectiveProvider else { return }

        isStreaming = true
        defer { isStreaming = false }

        let mp = settingsStore.settings.modelParams
        let context = ContextWindow.messages(from: chat.messages, excluding: variantOf, limit: mp.contextMessages)
        let systemPrompt = PromptAssembler.buildSystemPrompt(
            character: character,
            characterName: chat.characterName,
            globalSystem: mp.globalSystem,
            persona: settingsStore.settings.persona,
            memorySummary: chat.summary,
            recentContext: context,
            forceThinking: forceThinking
        )
        let request = ChatCompletionRequest(
            messages: context, model: effectiveModel, systemPrompt: systemPrompt,
            temperature: mp.temperature, maxTokens: mp.maxTokens, topP: mp.topP
        )
        let apiKey = settingsStore.apiKey(for: provider.id)

        var accumulated = ""
        do {
            try await completionService.streamDeltas(request: request, baseURL: provider.baseUrl, apiKey: apiKey) { delta in
                accumulated += delta
            }
            applyResult(text: accumulated, target: variantOf, restoreOnFail: restoreOnFail)
        } catch {
            if isCancellation(error) {
                applyResult(text: accumulated, target: variantOf, restoreOnFail: restoreOnFail)
            } else {
                lastError = error
                undoOptimisticSend(restoreOnFail: restoreOnFail)
            }
        }
    }

    private func isCancellation(_ error: Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    /// Same rule as the web version: an empty result from a Stop press undoes
    /// the send outright (nothing worth keeping); any non-empty result — even
    /// a stopped, partial one — becomes a real message.
    private func applyResult(text: String, target: String?, restoreOnFail: String?) {
        guard !text.isEmpty else {
            if restoreOnFail != nil { undoOptimisticSend(restoreOnFail: restoreOnFail) }
            return
        }

        if let target, let index = chat.messages.firstIndex(where: { $0.id == target }) {
            chat.messages[index].variants.append(text)
            chat.messages[index].variantIndex = chat.messages[index].variants.count - 1
            chat.messages[index].content = text
        } else {
            chat.messages.append(ChatMessage(role: .assistant, content: text, variants: [text]))
        }
        persist(touch: true)
    }

    /// Only ever called for a fresh `send()` (`restoreOnFail` is nil for
    /// regenerate/swipe, which have no optimistic message to unwind) — removes
    /// the user message that was added before the request went out and gives
    /// the typed text back so it is not lost.
    private func undoOptimisticSend(restoreOnFail: String?) {
        guard let restoreOnFail else { return }
        if !chat.messages.isEmpty { chat.messages.removeLast() }
        draftInputText = restoreOnFail
        persist(touch: false)
    }

    // MARK: - Memory

    private func maybeSummarise() async {
        guard settingsStore.settings.preferences.memoryEnabled else { return }
        let keep = settingsStore.settings.modelParams.contextMessages
        guard MemorySummarizer.shouldSummarise(
            messageCount: chat.messages.count, keep: keep, alreadySummarisedUpTo: chat.summarisedUpTo
        ) else { return }
        guard let provider = settingsStore.activeProvider else { return }

        let cutCount = MemorySummarizer.cutCount(messageCount: chat.messages.count, keep: keep)
        let cutMessages = Array(chat.messages.prefix(cutCount))
        let userName = PromptAssembler.userName(persona: settingsStore.settings.persona)
        let transcript = MemorySummarizer.transcript(cutMessages: cutMessages, userName: userName, characterName: chat.characterName)
        let content = MemorySummarizer.userContent(existingSummary: chat.summary, transcript: transcript)

        let request = ChatCompletionRequest(
            messages: [UpstreamMessage(role: .user, content: content)],
            model: provider.model,
            systemPrompt: MemorySummarizer.systemPrompt,
            temperature: MemorySummarizer.temperature,
            maxTokens: MemorySummarizer.maxTokens
        )
        let apiKey = settingsStore.apiKey(for: provider.id)

        // Memory is a bonus feature — a failure here must never surface as a
        // chat error, matching the web version's bare `catch {}`.
        guard let text = try? await completionService.complete(request: request, baseURL: provider.baseUrl, apiKey: apiKey),
              !text.isEmpty else { return }

        chat.summary = text.trimmingCharacters(in: .whitespacesAndNewlines)
        chat.summarisedUpTo = cutCount
        persist(touch: false)
    }

    // MARK: - Persistence

    private func persist(touch: Bool) {
        chatStore.update(chat, touch: touch)
    }
}
