import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var characters: CharacterStore
    @EnvironmentObject private var chats: ChatStore
    @EnvironmentObject private var settings: SettingsStore

    @State private var showingNewCharacter = false
    @State private var editingCharacter: CharacterCard?

    var body: some View {
        List(characters.characters) { character in
            NavigationLink(value: character) {
                row(for: character)
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            .swipeActions {
                Button("Удалить", role: .destructive) {
                    characters.delete(id: character.id)
                }
                Button("Изменить") {
                    editingCharacter = character
                }
                .tint(WesaidTheme.accent)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(WesaidTheme.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("wesaid")
                    .font(.wesaidRounded(20))
                    .foregroundStyle(WesaidTheme.text1)
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingNewCharacter = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        // `.navigationDestination(for:)` builds its view only when a value is
        // actually pushed onto the path — unlike `NavigationLink(destination:
        // closure)`, whose closure SwiftUI can evaluate more eagerly than "the
        // user tapped this row." That distinction matters here specifically
        // because `makeController` has a side effect (it may create a new
        // chat session); the eager form risked spawning duplicate chats.
        .navigationDestination(for: CharacterCard.self) { character in
            ChatView(controller: makeController(for: character))
        }
        .sheet(isPresented: $showingNewCharacter) {
            CharacterEditorView()
        }
        .sheet(item: $editingCharacter) { character in
            CharacterEditorView(editing: character)
        }
    }

    private func row(for character: CharacterCard) -> some View {
        HStack(spacing: 12) {
            Text(character.avatarEmoji)
                .font(.system(size: 22))
                .frame(width: 44, height: 44)
                .background(WesaidTheme.surface2, in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(character.name)
                    .font(.headline)
                    .foregroundStyle(WesaidTheme.text1)
                if !character.description.isEmpty {
                    Text(character.description)
                        .font(.subheadline)
                        .foregroundStyle(WesaidTheme.text3)
                        .lineLimit(1)
                }
            }

            Spacer()
            // No manual chevron here — `NavigationLink` inside a `List`
            // already draws its own disclosure indicator; adding another
            // would show two.
        }
        .padding(12)
        .background(WesaidTheme.surface, in: RoundedRectangle(cornerRadius: WesaidTheme.radius))
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
