import AppIntents
import Foundation

enum ShortcutRecordingRequest {
    static let notification = Notification.Name("DictalumeStartRecording")

    private static let pendingKey = "shortcutRecordingPending"
    private static let pendingModeKey = "shortcutRecordingMode"
    private static let group = UserDefaults(suiteName: SharedContextStore.suite)!

    @MainActor
    static func request(mode: MobileRecordingMode) {
        group.set(true, forKey: pendingKey)
        group.set(mode.rawValue, forKey: pendingModeKey)
        NotificationCenter.default.post(name: notification, object: nil)
    }

    @MainActor
    static func consume() -> MobileRecordingMode? {
        guard group.bool(forKey: pendingKey) else { return nil }
        group.set(false, forKey: pendingKey)
        return MobileRecordingMode(
            rawValue: group.string(forKey: pendingModeKey) ?? ""
        ) ?? .dictation
    }
}

struct StartDictalumeRecordingIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Dictalume Recording"
    static let description = IntentDescription(
        "Opens Dictalume and immediately starts recording a dictation or conversation."
    )
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ShortcutRecordingRequest.request(mode: .dictation)
        return .result()
    }
}

struct StartDictalumeMeetingIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Dictalume Meeting"
    static let description = IntentDescription(
        "Opens Dictalume in Meeting mode and immediately starts recording everyone in the room."
    )
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ShortcutRecordingRequest.request(mode: .meeting)
        return .result()
    }
}

struct DictalumeAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartDictalumeRecordingIntent(),
            phrases: [
                "Start recording with \(.applicationName)",
                "Record with \(.applicationName)",
                "Gravar com \(.applicationName)",
                "Começar ditado com \(.applicationName)"
            ],
            shortTitle: "Start recording",
            systemImageName: "waveform.circle.fill"
        )
        AppShortcut(
            intent: StartDictalumeMeetingIntent(),
            phrases: [
                "Start a meeting with \(.applicationName)",
                "Record a meeting with \(.applicationName)",
                "Gravar reunião com \(.applicationName)",
                "Começar reunião com \(.applicationName)"
            ],
            shortTitle: "Start meeting",
            systemImageName: "person.2.wave.2.fill"
        )
    }
}
