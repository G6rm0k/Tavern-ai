import SwiftUI

struct ChatView: View {
    @StateObject private var controller: ChatController
    @FocusState private var inputFocused: Bool

    init(controller: ChatController) {
        _controller = StateObject(wrappedValue: controller)
    }

    var body: some View {
        VStack(spacing: 0) {
            messageList
            inputBar
        }
        .background(WesaidTheme.background)
        .navigationTitle(controller.chat.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
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
        .background(WesaidTheme.background2)
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
