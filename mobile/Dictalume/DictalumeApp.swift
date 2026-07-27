import SwiftUI

@main
struct DictalumeApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .tint(.blue)
                .onOpenURL { url in
                    if url.host == "record" {
                        model.selectedTab = .record
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        model.refreshSharedContext()
                    }
                }
        }
    }
}

enum AppTab: Hashable {
    case record
    case history
    case settings
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView(selection: $model.selectedTab) {
            NavigationStack {
                RecorderView()
            }
            .tabItem { Label("Record", systemImage: "waveform") }
            .tag(AppTab.record)

            NavigationStack {
                HistoryView()
            }
            .tabItem { Label("History", systemImage: "clock") }
            .tag(AppTab.history)

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
            .tag(AppTab.settings)
        }
    }
}
