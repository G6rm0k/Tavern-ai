import Foundation

/// The one-tap starting points for adding a provider — same list and order
/// as `API_PRESETS` in `public/js/settings.js`, so switching between the
/// desktop and phone app feels like the same product.
struct ProviderPreset: Identifiable, Hashable {
    let id: String
    let name: String
    let baseUrl: String
    let icon: String
    let models: [String]

    static let all: [ProviderPreset] = [
        ProviderPreset(id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", icon: "🟢",
                        models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"]),
        ProviderPreset(id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", icon: "🔵",
                        models: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "meta-llama/llama-3.1-70b-instruct", "google/gemini-pro-1.5"]),
        ProviderPreset(id: "vsegpt", name: "VseGPT", baseUrl: "https://api.vsegpt.ru/v1", icon: "🇷🇺",
                        models: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "google/gemini-pro"]),
        ProviderPreset(id: "ollama", name: "Ollama (Local)", baseUrl: "http://localhost:11434/v1", icon: "🦙",
                        models: ["llama3.2", "mistral", "phi3", "gemma2", "qwen2.5"]),
        ProviderPreset(id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1", icon: "🎨",
                        models: ["local-model"]),
        ProviderPreset(id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", icon: "⚡",
                        models: ["llama-3.1-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"]),
        ProviderPreset(id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", icon: "🤝",
                        models: ["meta-llama/Llama-3-70b-chat-hf", "mistralai/Mixtral-8x7B-Instruct-v0.1"]),
        ProviderPreset(id: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", icon: "🌬️",
                        models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"]),
        ProviderPreset(id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", icon: "🟠",
                        models: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"]),
        ProviderPreset(id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", icon: "🔮",
                        models: ["deepseek-chat", "deepseek-reasoner"]),
        ProviderPreset(id: "cohere", name: "Cohere", baseUrl: "https://api.cohere.ai/compatibility/v1", icon: "🌊",
                        models: ["command-r-plus", "command-r"]),
        ProviderPreset(id: "xai", name: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", icon: "𝕏",
                        models: ["grok-beta"]),
        ProviderPreset(id: "custom", name: "Custom", baseUrl: "", icon: "⚙️", models: [])
    ]
}
