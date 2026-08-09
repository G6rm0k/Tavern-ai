import SwiftUI

@main
struct wesaidApp: App {
    @StateObject private var stores = AppStores()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                HomeView()
            }
            .environmentObject(stores.characters)
            .environmentObject(stores.chats)
            .environmentObject(stores.settings)
        }
        // iOS can suspend or terminate the app with no notice once it leaves
        // the foreground — unlike the desktop version, there is no SIGTERM to
        // catch a debounced write on. Flushing here is the equivalent gate.
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { stores.flushAll() }
        }
    }
}
