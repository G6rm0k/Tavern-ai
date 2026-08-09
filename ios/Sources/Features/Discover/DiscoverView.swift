import SwiftUI

/// Placeholder for the Chub.ai character search — the actual network
/// integration (`api.chub.ai`, PNG card import) is separate work still
/// ahead. This exists now so the tab bar itself is complete and every tab
/// leads somewhere styled, rather than one being conspicuously missing.
struct DiscoverView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "sparkle.magnifyingglass")
                .font(.system(size: 40))
                .foregroundStyle(WesaidTheme.accent)
            Text("Скоро здесь появится поиск персонажей на Chub.ai")
                .font(.subheadline)
                .foregroundStyle(WesaidTheme.text2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WesaidTheme.background)
        .navigationTitle("Поиск")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
    }
}
