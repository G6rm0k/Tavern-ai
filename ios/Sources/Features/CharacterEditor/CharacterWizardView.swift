import SwiftUI

/// Chat-style UI for `CharacterWizardController` — the AI-assisted creation
/// flow from `public/js/charwizard.js`, presented as a sheet from
/// `CharacterEditorView`. Each accepted field writes straight into the form
/// underneath as it's accepted, same as the web version's live `_applyField`.
struct CharacterWizardView: View {
    @StateObject private var controller: CharacterWizardController
    @Environment(\.dismiss) private var dismiss
    @FocusState private var inputFocused: Bool

    init(controller: CharacterWizardController) {
        _controller = StateObject(wrappedValue: controller)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                messageList
                if let proposal = controller.pendingProposal {
                    proposalCard(proposal)
                }
                if let errorMessage = controller.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                        .padding(.top, 4)
                }
                inputBar
            }
            .background(WesaidTheme.background)
            .navigationTitle("✨ AI-помощник")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
        .tint(WesaidTheme.accent)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(controller.messages) { message in
                        bubble(for: message).id(message.id)
                    }
                    if controller.isThinking {
                        HStack(spacing: 6) {
                            ProgressView().tint(WesaidTheme.text3)
                            Text("Печатает…").font(.caption).foregroundStyle(WesaidTheme.text3)
                        }
                        .id("thinking")
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 12)
            }
            .onChange(of: controller.messages.count) { _, _ in scrollToBottom(proxy) }
            .onChange(of: controller.isThinking) { _, _ in scrollToBottom(proxy) }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        let target = controller.isThinking ? "thinking" : controller.messages.last?.id
        guard let target else { return }
        withAnimation { proxy.scrollTo(target, anchor: .bottom) }
    }

    private func bubble(for message: CharacterWizardController.Message) -> some View {
        HStack {
            if message.sender == .user { Spacer(minLength: 40) }
            Text(message.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .foregroundStyle(message.sender == .user ? Color.white : WesaidTheme.text1)
                .background(message.sender == .user ? WesaidTheme.accent : WesaidTheme.surface,
                            in: RoundedRectangle(cornerRadius: WesaidTheme.radius))
            if message.sender == .bot { Spacer(minLength: 40) }
        }
    }

    private func proposalCard(_ proposal: CharacterWizardController.Proposal) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label(for: proposal.field))
                .font(.caption.bold())
                .foregroundStyle(WesaidTheme.accent)
            Text(proposal.value)
                .font(.subheadline)
                .foregroundStyle(WesaidTheme.text1)
            HStack(spacing: 8) {
                Button("✓ Принять") { Task { await controller.accept() } }
                    .buttonStyle(.borderedProminent)
                    .tint(WesaidTheme.accent)
                Button("✏️ Изменить") { controller.beginEditingProposal() }
                    .buttonStyle(.bordered)
                Button("✕ Другой") { Task { await controller.reject() } }
                    .buttonStyle(.bordered)
            }
            .font(.footnote)
        }
        .padding(12)
        .background(WesaidTheme.surface, in: RoundedRectangle(cornerRadius: WesaidTheme.radius))
        .padding(.horizontal)
    }

    private func label(for field: CharacterWizardController.Field) -> String {
        switch field {
        case .name: return "📛 Имя персонажа"
        case .description: return "📝 Краткое описание"
        case .systemPrompt: return "🧠 Системный промпт"
        case .firstMessage: return "💬 Первое сообщение"
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Напиши что-нибудь…", text: $controller.draftInputText, axis: .vertical)
                .lineLimit(1...4)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(WesaidTheme.surface, in: RoundedRectangle(cornerRadius: WesaidTheme.radius))
                .foregroundStyle(WesaidTheme.text1)
                .tint(WesaidTheme.accent)
                .focused($inputFocused)
                .disabled(controller.isThinking)

            Button {
                inputFocused = false
                Task { await controller.send() }
            } label: {
                Image(systemName: "arrow.up")
                    .padding(10)
                    .background(WesaidTheme.accent, in: Circle())
                    .foregroundStyle(.white)
            }
            .disabled(controller.draftInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || controller.isThinking)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(WesaidTheme.background2.ignoresSafeArea(edges: .bottom))
    }
}
