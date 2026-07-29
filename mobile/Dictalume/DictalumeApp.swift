import AppIntents
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
                        model.startRecordingFromShortcut(mode: .dictation)
                    } else if url.host == "meeting" {
                        model.startRecordingFromShortcut(mode: .meeting)
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        model.refreshSharedContext()
                        model.consumePendingShortcutRecording()
                        model.recorder.recoverIfNeeded()
                    }
                }
                .task {
                    DictalumeAppShortcuts.updateAppShortcutParameters()
                    model.consumePendingShortcutRecording()
#if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("-dictalumeQAMeeting") {
                        model.startRecordingFromShortcut(mode: .meeting)
                    } else if ProcessInfo.processInfo.arguments.contains("-dictalumeQACalendar") {
                        model.selectedTab = .calendar
                    } else if ProcessInfo.processInfo.arguments.contains("-dictalumeQAChat") {
                        model.selectedTab = .chat
                    }
#endif
                }
        }
    }
}

enum AppTab: Hashable {
    case record
    case calendar
    case history
    case chat
    case settings
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel
#if DEBUG
    @State private var showShortcutQA = ProcessInfo.processInfo.arguments.contains(
        "-dictalumeQAShortcuts"
    )
#endif

    var body: some View {
        TabView(selection: $model.selectedTab) {
            NavigationStack {
                RecorderView()
            }
            .tabItem { Label("Record", systemImage: "waveform") }
            .tag(AppTab.record)

            NavigationStack {
                UpcomingMeetingsView()
            }
            .tabItem { Label("Coming Up", systemImage: "calendar") }
            .tag(AppTab.calendar)

            NavigationStack {
                HistoryView()
            }
            .tabItem { Label("History", systemImage: "clock") }
            .tag(AppTab.history)

            NavigationStack {
                MeetingChatView()
            }
            .tabItem { Label("Ask", systemImage: "sparkles") }
            .tag(AppTab.chat)

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
            .tag(AppTab.settings)
        }
#if DEBUG
        .sheet(isPresented: $showShortcutQA) {
            NavigationStack {
                ShortcutSetupView()
            }
        }
#endif
    }
}
