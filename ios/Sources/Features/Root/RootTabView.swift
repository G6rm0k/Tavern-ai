import SwiftUI

/// The app's three sections, exactly as the web version's bottom nav lays
/// them out: Home, Discover, Settings. Left as a plain `TabView` on purpose —
/// on iOS 26 the Liquid Glass look is an effect of linking against that SDK,
/// not something to opt into with custom code, so there is nothing to build
/// here beyond the tabs themselves; a later phase revisits this only if the
/// CI runner's SDK needs it.
struct RootTabView: View {
    var body: some View {
        TabView {
            NavigationStack { HomeView() }
                .tabItem { Label("Главная", systemImage: "house.fill") }

            NavigationStack { DiscoverView() }
                .tabItem { Label("Поиск", systemImage: "sparkle.magnifyingglass") }

            NavigationStack { SettingsView() }
                .tabItem { Label("Настройки", systemImage: "gearshape.fill") }
        }
        .tint(WesaidTheme.accent)
        .toolbarBackground(WesaidTheme.background2, for: .tabBar)
    }
}
