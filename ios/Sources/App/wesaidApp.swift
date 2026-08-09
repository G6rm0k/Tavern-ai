import SwiftUI

// Phase 1 skeleton: proves the whole pipeline (XcodeGen → xcodebuild archive →
// unsigned .ipa → sideload via AltStore/SideStore) end to end before any real
// feature code is written. Nothing else should be built on top of this until
// a human confirms it actually launches on their phone.
@main
struct wesaidApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("✦").font(.system(size: 48))
            Text("wesaid").font(.system(size: 28, weight: .bold, design: .rounded))
            Text("Пайплайн собрался и запустился.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}
