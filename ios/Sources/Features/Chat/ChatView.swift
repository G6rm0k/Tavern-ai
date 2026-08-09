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
        .navigationTitle(controller.chat.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
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

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(controller.chat.messages) { message in
                        MessageBubble(
                            message: message,
                            characterAvatarEmoji: controller.chat.characterAvatarEmoji,
                            isLastMessage: message.id == controller.chat.messages.last?.id,
                            isStreaming: controller.isStreaming,
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
                .padding(.vertical, 8)
            }
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
        HStack(spacing: 8) {
            TextField("Сообщение…", text: $controller.draftInputText, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.roundedBorder)
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
                        .background(.tint, in: Circle())
                        .foregroundStyle(.white)
                }
                .disabled(controller.draftInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

private struct MessageBubble: View {
    let message: ChatMessage
    let characterAvatarEmoji: String
    let isLastMessage: Bool
    let isStreaming: Bool
    let onSwipe: (Int) -> Void
    let onRegenerate: () -> Void

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack(alignment: .top) {
            if isUser { Spacer(minLength: 40) }
            else { Text(characterAvatarEmoji).font(.title3) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                Text(message.displayedContent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(isUser ? Color.accentColor : Color.secondary.opacity(0.15),
                                in: RoundedRectangle(cornerRadius: 16))
                    .foregroundStyle(isUser ? .white : .primary)

                // Only the final reply can be re-rolled without rewriting history.
                if !isUser, isLastMessage, !isStreaming, message.variants.count >= 1 {
                    swipeBar
                }
            }

            if !isUser { Spacer(minLength: 40) }
        }
    }

    private var swipeBar: some View {
        let count = message.variants.count
        let index = message.variantIndex + 1
        return HStack(spacing: 12) {
            Button { onSwipe(-1) } label: { Image(systemName: "chevron.left") }
                .disabled(index <= 1)
            Text(count > 1 ? "\(index)/\(count)" : "1")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button { onSwipe(1) } label: { Image(systemName: "chevron.right") }
        }
        .buttonStyle(.plain)
        .padding(.leading, 4)
    }
}

private struct TypingIndicator: View {
    let avatarEmoji: String

    var body: some View {
        HStack(alignment: .top) {
            Text(avatarEmoji).font(.title3)
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle().frame(width: 6, height: 6)
                }
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 16))
            Spacer(minLength: 40)
        }
    }
}
