import Foundation

struct SharedContextSnapshot {
    let vocabulary: String
    let provider: String
    let language: String
    let baseURL: String
    let transcriptionModel: String
    let cleanupModel: String
    let cleanup: Bool
    let cleanupPrompt: String
}

final class SharedContextStore {
    static let suite = "group.com.dictalume.app"
    private let group = UserDefaults(suiteName: suite)!
    private let bookmarkKey = "sharedContextBookmark"

    func localHistory() -> [MobileHistoryItem] {
        guard
            let data = group.data(forKey: "mobileHistory"),
            let value = try? JSONDecoder().decode([MobileHistoryItem].self, from: data)
        else { return [] }
        return value
    }

    func saveLocalHistory(_ history: [MobileHistoryItem]) {
        group.set(try? JSONEncoder().encode(Array(history.prefix(250))), forKey: "mobileHistory")
    }

    func sharedHistory() -> [MobileHistoryItem] {
        guard let data = readSelectedFile(),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let history = root["history"],
              let encoded = try? JSONSerialization.data(withJSONObject: history),
              let items = try? JSONDecoder().decode([MobileHistoryItem].self, from: encoded)
        else { return [] }
        return items
    }

    func selectContextFile(_ url: URL) throws {
        let bookmark = try url.bookmarkData(
            options: .minimalBookmark,
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        group.set(bookmark, forKey: bookmarkKey)
        refreshFromSelectedFile()
    }

    func snapshot() -> SharedContextSnapshot? {
        guard let data = readSelectedFile(),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let settings = root["settings"] as? [String: Any]
        else { return nil }
        let providerID = settings["provider"] as? String ?? ""
        let providers = settings["providers"] as? [String: Any]
        let provider = providers?[providerID] as? [String: Any]
        let modeID = settings["mode"] as? String ?? "dictation"
        let modes = settings["modes"] as? [String: Any]
        let mode = modes?[modeID] as? [String: Any]
        return SharedContextSnapshot(
            vocabulary: settings["vocabulary"] as? String ?? "",
            provider: providerID,
            language: settings["language"] as? String ?? "",
            baseURL: provider?["baseUrl"] as? String ?? "",
            transcriptionModel: provider?["model"] as? String ?? "",
            cleanupModel: provider?["cleanupModel"] as? String ?? "",
            cleanup: mode?["cleanup"] as? Bool ?? true,
            cleanupPrompt: mode?["prompt"] as? String ?? ""
        )
    }

    func refreshFromSelectedFile() {
        guard let snapshot = snapshot() else { return }
        group.set(snapshot.vocabulary, forKey: "vocabulary")
        if let latest = sharedHistory().max(by: { $0.createdAt < $1.createdAt }) {
            group.set(latest.text, forKey: "latestTranscript")
            group.set(latest.createdAt / 1000, forKey: "latestTranscriptDate")
        }
    }

    func publish(
        transcript: String,
        item: MobileHistoryItem,
        vocabulary: String
    ) {
        group.set(transcript, forKey: "latestTranscript")
        group.set(Date().timeIntervalSince1970, forKey: "latestTranscriptDate")
        group.set(vocabulary, forKey: "vocabulary")

        guard let url = selectedURL() else { return }
        defer { url.stopAccessingSecurityScopedResource() }
        guard let data = coordinatedRead(url),
              var root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        var settings = root["settings"] as? [String: Any] ?? [:]
        settings["vocabulary"] = vocabulary
        root["settings"] = settings
        var history = root["history"] as? [[String: Any]] ?? []
        history.removeAll { ($0["id"] as? String) == item.id }
        history.insert([
            "id": item.id,
            "text": item.text,
            "rawText": item.rawText,
            "createdAt": item.createdAt,
            "durationMs": item.durationMs,
            "provider": item.provider,
            "mode": item.mode,
            "language": item.language
        ], at: 0)
        root["history"] = Array(history.prefix(250))
        root["revision"] = UUID().uuidString
        root["updatedAt"] = Date().timeIntervalSince1970 * 1000
        if let next = try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted]) {
            coordinatedWrite(next, to: url)
        }
    }

    private func readSelectedFile() -> Data? {
        guard let url = selectedURL() else { return nil }
        defer { url.stopAccessingSecurityScopedResource() }
        return coordinatedRead(url)
    }

    private func selectedURL() -> URL? {
        guard let bookmark = group.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: bookmark,
            options: .withoutUI,
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        ) else { return nil }
        guard url.startAccessingSecurityScopedResource() else { return nil }
        if stale, let renewed = try? url.bookmarkData(
            options: .minimalBookmark,
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        ) {
            group.set(renewed, forKey: bookmarkKey)
        }
        return url
    }

    private func coordinatedRead(_ url: URL) -> Data? {
        let coordinator = NSFileCoordinator()
        var result: Data?
        var coordinationError: NSError?
        coordinator.coordinate(
            readingItemAt: url,
            options: .withoutChanges,
            error: &coordinationError
        ) { coordinatedURL in
            result = try? Data(contentsOf: coordinatedURL)
        }
        return result
    }

    private func coordinatedWrite(_ data: Data, to url: URL) {
        let coordinator = NSFileCoordinator()
        var coordinationError: NSError?
        coordinator.coordinate(
            writingItemAt: url,
            options: .forMerging,
            error: &coordinationError
        ) { coordinatedURL in
            try? data.write(to: coordinatedURL, options: .atomic)
        }
    }
}
