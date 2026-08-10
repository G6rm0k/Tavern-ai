import SwiftUI

struct ChatView: View {
    @EnvironmentObject private var characters: CharacterStore
    @StateObject private var controller: ChatController
    @FocusState private var inputFocused: Bool
    @State private var showingProfile = false

    init(controller: ChatController) {
        _controller = StateObject(wrappedValue: controller)
    }

    var body: some View {
        VStack(spacing: 0) {
            messageList
            inputBar
        }
        .background(WesaidTheme.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Tapping either the name or the avatar opens the character's
            // full profile — same destination, two familiar targets.
            ToolbarItem(placement: .principal) {
                Button {
                    showingProfile = true
                } label: {
                    Text(controller.chat.characterName)
                        .font(.subheadline.bold())
                        .foregroundStyle(WesaidTheme.text1)
                        .lineLimit(1)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(WesaidTheme.surface, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingProfile = true
                } label: {
                    avatarView
                }
                .buttonStyle(.plain)
            }
        }
        // A blurred material bar, not a flat fill: the standard iOS way for
        // a bar to read as "over the content" rather than a hard-edged block
        // sitting on top of it — messages are visibly, softly present through
        // it while scrolling, same idea as Messages.app's own nav bar.
        .toolbarBackground(.ultraThinMaterial, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        // Matches the web version's `.mob-nav.nav-hidden`: the bottom nav
        // disappears entirely once you're inside a conversation, so the
        // keyboard and input bar get the full screen.
        .toolbar(.hidden, for: .tabBar)
        .sheet(isPresented: $showingProfile) {
            if let character = controller.character {
                CharacterEditorView(editing: character)
            } else {
                deletedCharacterNotice
            }
        }
        // Regenerating a reply that has messages after it abandons that
        // branch — mirrors the confirm() the web version shows.
        .alert("Дальнейшие сообщения будут удалены", isPresented: Binding(
            get: { controller.pendingRegenerateTruncation != nil },
            set: { if !$0 { controller.cancelRegenerateTruncation() } }
        )) {
            Button("Отмена", role: .cancel) { controller.cancelRegenerateTruncation() }
            Button("Перегенерировать", role: .destructive) { controller.confirmRegenerateTruncation() }
        }
    }

    private var avatarView: some View {
        Group {
            if let fileName = controller.chat.characterAvatar, let url = characters.avatars.url(for: fileName) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().aspectRatio(contentMode: .fill)
                    } else {
                        Text(controller.chat.characterAvatarEmoji).font(.system(size: 14))
                    }
                }
            } else {
                Text(controller.chat.characterAvatarEmoji).font(.system(size: 14))
            }
        }
        .frame(width: 32, height: 32)
        .background(WesaidTheme.surface2, in: Circle())
        .clipShape(Circle())
    }

    private var deletedCharacterNotice: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.crop.circle.badge.exclamationmark")
                .font(.system(size: 40))
                .foregroundStyle(WesaidTheme.text3)
            Text("Персонаж удалён")
                .font(.headline)
                .foregroundStyle(WesaidTheme.text1)
        }
        .padding(40)
        .presentationDetents([.height(180)])
    }

    /// `{{char}}`/`{{user}}` are placeholders meant to be substituted
    /// everywhere they can appear in user-facing text — a character's
    /// opening greeting is written with them (e.g. "Привет, {{user}}!") the
    /// same way its system prompt is, so it needs the same fill before
    /// display.
    private func displayText(for message: ChatMessage) -> String {
        PromptAssembler.fill(message.displayedContent, characterName: controller.chat.characterName, userName: controller.displayUserName)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(controller.chat.messages) { message in
                        MessageBubble(
                            text: displayText(for: message),
                            role: message.role,
                            characterAvatarEmoji: controller.chat.characterAvatarEmoji,
                            isLastMessage: message.id == controller.chat.messages.last?.id,
                            isStreaming: controller.isStreaming,
                            variantCount: message.variants.count,
                            variantIndex: message.variantIndex,
                            onSwipe: { direction in controller.swipe(messageID: message.id, direction: direction) },
                            onRegenerate: { controller.regenerate(messageID: message.id) }
                        )
                        .id(message.id)
                    }
                    if controller.isStreaming {
                        TypingIndicator(avatarEmoji: controller.chat.characterAvatarEmoji)
                            .id("typing")
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 12)
            }
            .scrollContentBackground(.hidden)
            .background(WesaidTheme.background)
            .onChange(of: controller.chat.messages.count) { _, _ in
                scrollToBottom(proxy)
            }
            .onChange(of: controller.isStreaming) { _, _ in
                scrollToBottom(proxy)
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        let target = controller.isStreaming ? "typing" : controller.chat.messages.last?.id
        guard let target else { return }
        withAnimation { proxy.scrollTo(target, anchor: .bottom) }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            controlsCluster

            TextField("Сообщение…", text: $controller.draftInputText, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(WesaidTheme.surface, in: RoundedRectangle(cornerRadius: WesaidTheme.radius))
                .foregroundStyle(WesaidTheme.text1)
                .tint(WesaidTheme.accent)
                .focused($inputFocused)

            if controller.isStreaming {
                Button {
                    controller.stop()
                } label: {
                    Image(systemName: "stop.fill")
                        .padding(10)
                        .background(.red, in: Circle())
                        .foregroundStyle(.white)
                }
            } else {
                Button {
                    let text = controller.draftInputText
                    inputFocused = false
                    controller.send(text)
                } label: {
                    Image(systemName: "arrow.up")
                        .padding(10)
                        .background(WesaidTheme.accent, in: Circle())
                        .foregroundStyle(.white)
                }
                .disabled(controller.draftInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        // Extending the fill past the bottom safe area (rather than stopping
        // exactly at it) is what makes this read as flush against the
        // keyboard's own rounded top edge instead of a flat bar with a
        // visible seam where the two don't quite meet.
        .background(WesaidTheme.background2.ignoresSafeArea(edges: .bottom))
    }

    /// One shared pill instead of two separate circles: the "thinking"
    /// toggle and the model switcher read as one control that forks in two,
    /// not two unrelated buttons that happen to sit next to each other.
    private var controlsCluster: some View {
        HStack(spacing: 0) {
            thinkingToggle
            if controller.modelChoices.count > 1 {
                Divider().frame(height: 18)
                modelSwitcher
            }
        }
        .background(WesaidTheme.surface, in: Capsule())
    }

    /// Forces the model to reason step by step before its final answer, for
    /// this chat only — works the same regardless of provider/model, since
    /// it's a system-prompt instruction, not a provider-specific API.
    private var thinkingToggle: some View {
        Button {
            controller.forceThinking.toggle()
        } label: {
            Image(systemName: "brain")
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 36, height: 36)
                .foregroundStyle(controller.forceThinking ? WesaidTheme.accent : WesaidTheme.text3)
        }
        .accessibilityLabel("Размышлять перед ответом")
    }

    /// Only shown once the active provider actually has more than one model
    /// to offer (its own default plus at least one starred model) — nothing
    /// to switch between otherwise. Picking here only affects this chat; it
    /// never touches the provider's own configured model in Settings.
    private var modelSwitcher: some View {
        Menu {
            ForEach(controller.modelChoices, id: \.self) { modelID in
                Button {
                    controller.modelOverride = modelID
                } label: {
                    if controller.effectiveModel == modelID {
                        Label(modelID, systemImage: "checkmark")
                    } else {
                        Text(modelID)
                    }
                }
            }
        } label: {
            Image(systemName: "cpu")
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 36, height: 36)
                .foregroundStyle(controller.modelOverride != nil ? WesaidTheme.accent : WesaidTheme.text3)
        }
        .accessibilityLabel("Модель для этого чата")
    }
}

private struct MessageBubble: View {
    let text: String
    let role: ChatRole
    let characterAvatarEmoji: String
    let isLastMessage: Bool
    let isStreaming: Bool
    let variantCount: Int
    let variantIndex: Int
    let onSwipe: (Int) -> Void
    let onRegenerate: () -> Void

    private var isUser: Bool { role == .user }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if isUser { Spacer(minLength: 40) }
            else { avatar }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                Text(text)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .foregroundStyle(isUser ? .white : WesaidTheme.text1)
                    .background {
                        if isUser {
                            MessageBubbleShape.user().fill(WesaidTheme.accent)
                                .shadow(color: WesaidTheme.accentGlow, radius: 12, y: 2)
                        } else {
                            MessageBubbleShape.bot().fill(.ultraThinMaterial)
                        }
                    }

                // Only the final reply's variant history can be paged through
                // without abandoning any conversation that came after it.
                if !isUser, isLastMessage, !isStreaming, variantCount >= 1 {
                    swipeBar
                } else if !isUser, !isStreaming {
                    regenerateButton
                }
            }

            if !isUser { Spacer(minLength: 40) }
        }
    }

    private var avatar: some View {
        Text(characterAvatarEmoji)
            .font(.system(size: 15))
            .frame(width: 30, height: 30)
            .background(WesaidTheme.surface2, in: Circle())
    }

    private var swipeBar: some View {
        let count = variantCount
        let index = variantIndex + 1
        return HStack(spacing: 10) {
            Button { onSwipe(-1) } label: { Image(systemName: "chevron.left") }
                .disabled(index <= 1)
            Text(count > 1 ? "\(index)/\(count)" : "1")
                .font(.caption)
                .foregroundStyle(WesaidTheme.text3)
            Button { onSwipe(1) } label: { Image(systemName: "chevron.right") }
        }
        .font(.caption)
        .foregroundStyle(WesaidTheme.text2)
        .buttonStyle(.plain)
        .padding(.leading, 6)
    }

    private var regenerateButton: some View {
        Button(action: onRegenerate) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.caption)
                .foregroundStyle(WesaidTheme.text3)
        }
        .buttonStyle(.plain)
        .padding(.leading, 6)
    }
}

private struct TypingIndicator: View {
    let avatarEmoji: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(avatarEmoji)
                .font(.system(size: 15))
                .frame(width: 30, height: 30)
                .background(WesaidTheme.surface2, in: Circle())
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle().frame(width: 6, height: 6)
                }
            }
            .foregroundStyle(WesaidTheme.text3)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background { MessageBubbleShape.bot().fill(.ultraThinMaterial) }
            Spacer(minLength: 40)
        }
    }
}
