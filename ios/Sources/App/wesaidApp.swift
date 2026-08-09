import SwiftUI

@main
struct wesaidApp: App {
    @StateObject private var stores = AppStores()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(stores.characters)
                .environmentObject(stores.chats)
                .environmentObject(stores.settings)
                // wesaid defaults to a dark theme, not "whatever the system
                // prefers" (`app: { theme: 'dark', ... }` in the web version's
                // settings.js — light is an opt-in the user switches to). Forcing
                // it here keeps system-drawn chrome (alerts, keyboard, nav bar)
                // from clashing with the app's own dark backgrounds until a
                // settings screen exists to make this a real toggle.
                .preferredColorScheme(.dark)
                .tint(WesaidTheme.accent)
        }
        // iOS can suspend or terminate the app with no notice once it leaves
        // the foreground — unlike the desktop version, there is no SIGTERM to
        // catch a debounced write on. Flushing here is the equivalent gate.
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { stores.flushAll() }
        }
    }
}
