import Foundation

/// A configured LLM endpoint.
///
/// Note what is *not* here: `apiKey`. Keys live in the Keychain
/// (`KeychainService`), keyed by this `id`, and never touch `settings.json`.
/// That is deliberate — the JSON file is what a backup export copies and what a
/// file-sharing tool can read, and neither should ever carry a secret.
struct Provider: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var baseUrl: String
    var model: String
    /// Models picked out of a `/models` scan for quick switching from the
    /// chat screen itself, without a trip to Settings — not in the web
    /// version, which only ever lets you type one model per provider.
    var favoriteModels: [String]

    init(id: String = UUID().uuidString,
         name: String = "",
         baseUrl: String = "",
         model: String = "",
         favoriteModels: [String] = []) {
        self.id = id
        self.name = name
        self.baseUrl = baseUrl
        self.model = model
        self.favoriteModels = favoriteModels
    }

    enum CodingKeys: String, CodingKey {
        case id, name, baseUrl, model, favoriteModels
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id             = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        name           = (try? c.decode(String.self, forKey: .name)) ?? ""
        baseUrl        = (try? c.decode(String.self, forKey: .baseUrl)) ?? ""
        model          = (try? c.decode(String.self, forKey: .model)) ?? ""
        favoriteModels = (try? c.decode([String].self, forKey: .favoriteModels)) ?? []
    }
}

struct ModelParams: Codable, Hashable {
    var temperature: Double
    var maxTokens: Int
    var topP: Double
    var topK: Int
    /// How many trailing messages go upstream. Also the window the lorebook
    /// scans for its keys.
    var contextMessages: Int
    /// Instructions prepended to every character's system prompt.
    var globalSystem: String

    init(temperature: Double = 0.8,
         maxTokens: Int = 1024,
         topP: Double = 0.9,
         topK: Int = 40,
         contextMessages: Int = 20,
         globalSystem: String = "") {
        self.temperature = temperature
        self.maxTokens = maxTokens
        self.topP = topP
        self.topK = topK
        self.contextMessages = contextMessages
        self.globalSystem = globalSystem
    }

    enum CodingKeys: String, CodingKey {
        case temperature, maxTokens, topP, topK, contextMessages, globalSystem
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = ModelParams()
        temperature     = (try? c.decode(Double.self, forKey: .temperature)) ?? d.temperature
        maxTokens       = (try? c.decode(Int.self, forKey: .maxTokens)) ?? d.maxTokens
        topP            = (try? c.decode(Double.self, forKey: .topP)) ?? d.topP
        topK            = (try? c.decode(Int.self, forKey: .topK)) ?? d.topK
        contextMessages = (try? c.decode(Int.self, forKey: .contextMessages)) ?? d.contextMessages
        globalSystem    = (try? c.decode(String.self, forKey: .globalSystem)) ?? d.globalSystem
    }

    // The three plain-language presets the settings screen offers up front, so
    // nobody has to know what top-p is to get a sensible result. Values match
    // `MP_PRESETS` in public/js/settings.js.
    static let creative = ModelParams(temperature: 1.2, maxTokens: 2048, topP: 0.95, topK: 60, contextMessages: 30)
    static let balanced = ModelParams(temperature: 0.8, maxTokens: 1024, topP: 0.90, topK: 40, contextMessages: 20)
    static let precise  = ModelParams(temperature: 0.3, maxTokens: 512,  topP: 0.70, topK: 20, contextMessages: 15)

    /// Applying a preset must not silently wipe the instructions the user typed.
    func applying(preset: ModelParams) -> ModelParams {
        var next = preset
        next.globalSystem = globalSystem
        return next
    }
}

/// Who the user is, from the character's point of view.
struct Persona: Codable, Hashable {
    var name: String
    var description: String

    init(name: String = "", description: String = "") {
        self.name = name
        self.description = description
    }

    enum CodingKeys: String, CodingKey {
        case name, description
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name        = (try? c.decode(String.self, forKey: .name)) ?? ""
        description = (try? c.decode(String.self, forKey: .description)) ?? ""
    }
}

/// Small on/off switches that live under `"app"` on disk in the web version
/// (`settings.data.app`). Only `memory` is needed so far — the rest of that
/// bag (theme, sound, animations…) belongs to the appearance screen in a
/// later phase, and gets added to this same struct then rather than a new
/// top-level key, since that's the shape the file already has on disk.
struct AppPreferences: Codable, Hashable {
    /// Whether the chat compresses conversation overflow into a running
    /// summary. Off by default, same as the web version — nothing in
    /// `STARTER_CHARACTERS`-style defaults ever turns this on for the user.
    var memoryEnabled: Bool

    /// iOS-only, not in the web version: asks the model to reason through a
    /// problem step by step before its final answer, via a system-prompt
    /// instruction rather than any provider-specific "reasoning" API — so it
    /// has the same effect regardless of which provider or model is active.
    /// This is the default for new chats; each chat can still override it.
    var forceThinkingByDefault: Bool

    /// Target language ("ru"/"en") for auto-translating a Chub.ai import's
    /// first messages and description — independent of anything else, since
    /// this app has no UI localization layer of its own to tie it to.
    var translateLanguage: String

    init(memoryEnabled: Bool = false, forceThinkingByDefault: Bool = false, translateLanguage: String = "ru") {
        self.memoryEnabled = memoryEnabled
        self.forceThinkingByDefault = forceThinkingByDefault
        self.translateLanguage = translateLanguage
    }

    enum CodingKeys: String, CodingKey {
        case memoryEnabled = "memory"
        case forceThinkingByDefault = "forceThinking"
        // Matches the key the web version writes under `settings.app` on disk.
        case translateLanguage = "translateLang"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        memoryEnabled = (try? c.decode(Bool.self, forKey: .memoryEnabled)) ?? false
        forceThinkingByDefault = (try? c.decode(Bool.self, forKey: .forceThinkingByDefault)) ?? false
        translateLanguage = (try? c.decode(String.self, forKey: .translateLanguage)) ?? "ru"
    }
}

struct AppSettings: Codable, Hashable {
    var providers: [Provider]
    var activeProviderId: String?
    var modelParams: ModelParams
    var persona: Persona
    /// Off by default: a lock the user never asked for, on an app they just
    /// installed, reads as a malfunction rather than a feature.
    var requireBiometrics: Bool
    var preferences: AppPreferences

    init(providers: [Provider] = [],
         activeProviderId: String? = nil,
         modelParams: ModelParams = ModelParams(),
         persona: Persona = Persona(),
         requireBiometrics: Bool = false,
         preferences: AppPreferences = AppPreferences()) {
        self.providers = providers
        self.activeProviderId = activeProviderId
        self.modelParams = modelParams
        self.persona = persona
        self.requireBiometrics = requireBiometrics
        self.preferences = preferences
    }

    enum CodingKeys: String, CodingKey {
        case providers, activeProviderId, persona, requireBiometrics
        // "mp" is what the web version calls this object on disk.
        case modelParams = "mp"
        case preferences = "app"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        providers         = (try? c.decode([Provider].self, forKey: .providers)) ?? []
        activeProviderId  = try? c.decode(String.self, forKey: .activeProviderId)
        modelParams       = (try? c.decode(ModelParams.self, forKey: .modelParams)) ?? ModelParams()
        persona           = (try? c.decode(Persona.self, forKey: .persona)) ?? Persona()
        requireBiometrics = (try? c.decode(Bool.self, forKey: .requireBiometrics)) ?? false
        preferences       = (try? c.decode(AppPreferences.self, forKey: .preferences)) ?? AppPreferences()
    }

    var activeProvider: Provider? {
        guard let activeProviderId else { return providers.first }
        return providers.first { $0.id == activeProviderId } ?? providers.first
    }
}
