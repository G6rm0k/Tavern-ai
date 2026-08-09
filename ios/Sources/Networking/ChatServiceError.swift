import Foundation

/// Mirrors the error codes the server used to hand the browser
/// (`BAD_URL`, `NO_KEY`, `CONN_REFUSED`, `NO_NETWORK`) so the same situations
/// stay distinguishable now that the app talks to providers directly instead
/// of through a relay.
enum ChatServiceError: Error, Equatable {
    case badURL
    case noKey
    case httpError(status: Int, body: String)
    case connectionRefused
    case noNetwork
    case network(String)
}
