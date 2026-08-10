import SwiftUI

/// A small tab attached to the top-leading corner of an input bar — a
/// keycap silhouette (an upside-down Mac key), holding the thinking-mode
/// toggle and, when more than one model is available, the quick model
/// switcher. Shared between the main chat screen and the character wizard:
/// both drive an LLM through the same input-bar shape and both want the
/// same at-a-glance "is it thinking first, and which model" control without
/// permanently spending space inside the bar itself.
///
/// The model switcher is handed in as arbitrary content (a `Menu`, built by
/// the caller) rather than a list of choices, because the two callers pick
/// from differently-shaped state — `ChatController.modelChoices` spans every
/// provider's favorites, the wizard's own choices are scoped the same way
/// but through a different controller type. This view only owns the shape
/// and the thinking toggle, which both callers share exactly.
struct ModelControlTab<ModelMenu: View>: View {
    @Binding var forceThinking: Bool
    let showsModelSwitcher: Bool
    @ViewBuilder let modelMenu: () -> ModelMenu

    var body: some View {
        HStack(spacing: 6) {
            Button {
                forceThinking.toggle()
            } label: {
                Image(systemName: "brain")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(forceThinking ? WesaidTheme.accent : WesaidTheme.text3)
            }
            .accessibilityLabel("Размышлять перед ответом")

            if showsModelSwitcher {
                Divider().frame(height: 12)
                modelMenu()
            }
        }
        .buttonStyle(.plain)
        .padding(.leading, 12)
        .padding(.trailing, 14)
        .padding(.top, 6)
        .padding(.bottom, 11)
        .background(WesaidTheme.surface, in: KeyTabShape())
    }
}

enum ModelLabel {
    /// A short label for a model id — the tab has room for a glance, not the
    /// full string ("claude-opus-4-20250514" → "opus-4-2025…"). Anything
    /// after the last `/` only (OpenRouter-style ids ship as
    /// "openai/gpt-4o"; the provider prefix is redundant on a tab that's
    /// already scoped to one provider's request).
    static func abbreviate(_ model: String) -> String {
        let last = model.split(separator: "/").last.map(String.init) ?? model
        guard last.count > 13 else { return last }
        return String(last.prefix(12)) + "…"
    }
}

/// Flat on the left and bottom, sliced diagonally at the top-right — a
/// keycap turned upside down, poking up out of the bar it's attached to
/// rather than sitting flush with it.
private struct KeyTabShape: Shape {
    func path(in rect: CGRect) -> Path {
        let cut = min(rect.height, rect.width * 0.4)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
