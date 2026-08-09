import SwiftUI

/// A minimal starting point for what becomes the full character list in a
/// later phase (create/edit/delete, PNG import, Discover). For now it exists
/// so Chat — this phase's actual deliverable — has somewhere to be reached
/// from on a sideloaded build: tap a starter character, land in a chat.
struct HomeView: View {
    @EnvironmentObject private var characters: CharacterStore
    @EnvironmentObject private var chats: ChatStore
    @EnvironmentObject private var settings: SettingsStore

    var body: some View {
        List(characters.characters) { character in
            NavigationLink(value: character) {
                HStack(spacing: 12) {
                    Text(character.avatarEmoji).font(.system(size: 28))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(character.name).font(.headline)
                        if !character.description.isEmpty {
                            Text(character.description)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle("wesaid")
        // `.navigationDestination(for:)` builds its view only when a value is
        // actually pushed onto the path — unlike `NavigationLink(destination:
        // closure)`, whose closure SwiftUI can evaluate more eagerly than "the
        // user tapped this row." That distinction matters here specifically
        // because `makeController` has a side effect (it may create a new
        // chat session); the eager form risked spawning duplicate chats.
        .navigationDestination(for: CharacterCard.self) { character in
            ChatView(controller: makeController(for: character))
        }
    }

    /// One conversation per character for now — reopens the most recent one
    /// if it exists, starts a fresh one otherwise. Picking between several
    /// existing chats with the same character belongs to the fuller Home
    /// screen, not this placeholder.
    private func makeController(for character: CharacterCard) -> ChatController {
        let existing = chats.chats(forCharacter: character.id).first
        let session = existing ?? chats.create(with: character)
        return ChatController(chat: session, chatStore: chats, characterStore: characters, settingsStore: settings)
    }
}
