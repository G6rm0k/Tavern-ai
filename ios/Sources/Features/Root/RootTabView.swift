import SwiftUI

/// Home / Discover / Settings, exactly as the web version's bottom nav lays
/// them out. Deliberately a plain, uncustomized `TabView` — on iOS 26 the
/// floating "Liquid Glass" pill look (matching `.mob-nav-pill` in
/// main.css) is a side effect of the app being built against that SDK, not
/// an API to opt into, so there is nothing to build here beyond the tabs
/// themselves. See `.github/workflows/ios-build.yml`'s Xcode 26 selection
/// step — without linking against that SDK, this same code renders as a
/// flat, pre-26 bar regardless of what iOS version the device itself runs.
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
    }
}
