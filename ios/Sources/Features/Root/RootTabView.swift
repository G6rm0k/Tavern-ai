import SwiftUI

/// A plain system `TabView` renders as a flat, edge-to-edge bar — nothing
/// like wesaid's actual nav, which is a **floating glass pill** inset from
/// the screen edges (`.mob-nav-pill` in main.css: `width: calc(100vw - 32px);
/// border-radius: 99px; backdrop-filter: blur(56px)`), and it disappears
/// entirely once you're inside a chat (`.mob-nav.nav-hidden`). Waiting for
/// iOS 26 Liquid Glass to reshape a stock `TabView` into something close to
/// this was the original bet for this screen, but the runner doesn't have
/// that SDK yet, so this hand-builds the actual shape now instead of
/// shipping something that reads as a generic, unbranded app in the meantime.
struct RootTabView: View {
    enum Tab: Hashable {
        case home, discover, settings
    }

    @State private var selectedTab: Tab = .home
    /// Tracked so the floating bar can hide itself the moment a chat is
    /// pushed — Discover/Settings don't push anything deeper yet, so only
    /// Home's stack needs to be watched.
    @State private var homePath = NavigationPath()

    private var isInsideChat: Bool {
        selectedTab == .home && !homePath.isEmpty
    }

    var body: some View {
        Group {
            switch selectedTab {
            case .home:
                NavigationStack(path: $homePath) { HomeView() }
            case .discover:
                NavigationStack { DiscoverView() }
            case .settings:
                NavigationStack { SettingsView() }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !isInsideChat {
                FloatingTabBar(selected: $selectedTab)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 6)
            }
        }
        .animation(.easeOut(duration: 0.2), value: isInsideChat)
    }
}

private struct FloatingTabBar: View {
    @Binding var selected: RootTabView.Tab

    var body: some View {
        HStack(spacing: 4) {
            item(.home, systemImage: "house.fill", title: "Главная")
            item(.discover, systemImage: "sparkle.magnifyingglass", title: "Поиск")
            item(.settings, systemImage: "gearshape.fill", title: "Настройки")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .frame(height: 58)
        .background {
            Capsule()
                .fill(.ultraThinMaterial)
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
        }
        .shadow(color: .black.opacity(0.45), radius: 24, y: 8)
    }

    private func item(_ tab: RootTabView.Tab, systemImage: String, title: String) -> some View {
        let isOn = selected == tab
        return Button {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) { selected = tab }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: systemImage)
                    .font(.system(size: 20))
                    .scaleEffect(isOn ? 1.1 : 1)
                Text(title)
                    .font(.system(size: 9, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.4)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .foregroundStyle(isOn ? .white : WesaidTheme.text3)
            .background {
                if isOn {
                    RoundedRectangle(cornerRadius: 22).fill(WesaidTheme.accent.opacity(0.28))
                }
            }
        }
        .buttonStyle(.plain)
    }
}
