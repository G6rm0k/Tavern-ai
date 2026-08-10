import Foundation

/// One entry in a chat's (or the wizard's) quick model-switcher: a specific
/// model on a specific provider. Distinct from `FavoriteModel` — that's the
/// stored preference, this is what a controller resolves it to at runtime,
/// paired with the provider that actually owns the request when this choice
/// is active (see `ChatController.effectiveProvider`).
struct ModelChoice: Identifiable, Equatable, Hashable {
    let providerID: String
    let model: String
    var id: String { "\(providerID)|\(model)" }
}
