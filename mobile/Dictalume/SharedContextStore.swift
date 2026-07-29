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

    func localMeetingChat() -> [MobileChatMessage] {
        guard
            let data = group.data(forKey: "mobileMeetingChat"),
            let messages = try? JSONDecoder().decode([MobileChatMessage].self, from: data)
        else { return [] }
        return messages
    }

    func saveLocalMeetingChat(_ messages: [MobileChatMessage]) {
        group.set(
            try? JSONEncoder().encode(Array(messages.suffix(100))),
            forKey: "mobileMeetingChat"
        )
    }

    func sharedHistory() -> [MobileHistoryItem] {
        guard let data = readSelectedFile(),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let history = root["history"],
              let encoded = try? JSONSerialization.data(withJSONObject: history),
              let items = try? JSONDecoder().decode([MobileHistoryItem].self, from: encoded)
        else { return [] }
        let historyIDs = Set(items.map(\.id))
        return items + desktopMeetingHistory(from: root).filter {
            !historyIDs.contains($0.id)
        }
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
        let mergedVocabulary = mergeVocabulary(
            settings["vocabulary"] as? String ?? "",
            vocabulary
        )
        settings["vocabulary"] = mergedVocabulary
        root["settings"] = settings
        group.set(mergedVocabulary, forKey: "vocabulary")
        var history = root["history"] as? [[String: Any]] ?? []
        history.removeAll { ($0["id"] as? String) == item.id }
        if let encoded = try? JSONEncoder().encode(item),
           let record = try? JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        {
            history.insert(record, at: 0)
        }
        root["history"] = Array(history.prefix(250))
        if item.mode == "meeting", let meeting = desktopMeetingRecord(for: item) {
            var meetings = root["meetings"] as? [[String: Any]] ?? []
            // A meeting may already have been edited on desktop. Mobile currently
            // publishes a completed meeting once, so never replace the richer copy.
            if !meetings.contains(where: { ($0["id"] as? String) == item.id }) {
                meetings.insert(meeting, at: 0)
            }
            root["meetings"] = Array(meetings.prefix(100))
        }
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

    private func desktopMeetingRecord(
        for item: MobileHistoryItem
    ) -> [String: Any]? {
        guard item.mode == "meeting" else { return nil }
        let turns = item.speakerTurns ?? []
        let speakerIDs = Array(Set(turns.map(\.speakerID))).sorted()
        let speakers: [[String: Any]] = speakerIDs.map { speakerID in
            let label = speakerName(speakerID, in: item)
            return [
                "id": desktopSpeakerID(speakerID, meetingID: item.id),
                "name": label,
                "source": "microphone",
                "evidenceKey": "mobile:\(item.id):speaker:\(speakerID)",
                "diarizationLabel": speakerID >= 0 ? "speaker_\(speakerID)" : "unknown",
                "diarizationScope": item.id
            ]
        }
        let transcriptTurns: [[String: Any]] = turns.map { turn in
            [
                "id": turn.id,
                "speakerId": desktopSpeakerID(turn.speakerID, meetingID: item.id),
                "source": "microphone",
                "startMs": max(0, turn.start * 1000),
                "endMs": max(turn.start, turn.end) * 1000,
                "text": turn.text
            ]
        }
        let transcript = turns.isEmpty
            ? item.rawText
            : turns.map {
                "\(speakerName($0.speakerID, in: item)): \($0.text)"
            }.joined(separator: "\n\n")
        var meeting: [String: Any] = [
            "id": item.id,
            "title": mobileMeetingTitle(item),
            "source": "conversation",
            "createdAt": item.createdAt,
            "durationMs": item.durationMs,
            "transcript": transcript,
            "notes": desktopMeetingNotes(item.meetingNotes),
            "provider": item.provider,
            "speakers": speakers,
            "transcriptTurns": transcriptTurns,
            "templateId": "general",
            "updatedAt": Date().timeIntervalSince1970 * 1000,
            "transcriptUpdatedAt": Date().timeIntervalSince1970 * 1000
        ]
        if let userNotes = item.userNotes?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !userNotes.isEmpty
        {
            meeting["userNotes"] = userNotes
        }
        return meeting
    }

    private func speakerName(
        _ speakerID: Int,
        in item: MobileHistoryItem
    ) -> String {
        if let confirmed = item.speakerNames?[speakerID]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !confirmed.isEmpty
        {
            return String(confirmed.prefix(80))
        }
        return speakerID >= 0 ? "Speaker \(speakerID + 1)" : "Unknown speaker"
    }

    private func desktopSpeakerID(
        _ speakerID: Int,
        meetingID: String
    ) -> String {
        speakerID >= 0
            ? "mobile-\(meetingID)-speaker-\(speakerID)"
            : "mobile-\(meetingID)-unknown"
    }

    private func desktopMeetingNotes(
        _ notes: MobileMeetingNotes?
    ) -> String {
        guard let notes else { return "" }
        var sections: [String] = []
        if !notes.summary.isEmpty {
            sections.append(
                "## Summary\n" + notes.summary.map { "- \($0)" }.joined(separator: "\n")
            )
        }
        if !notes.actionItems.isEmpty {
            sections.append(
                "## To-do list\n" +
                notes.actionItems.map { "- [ ] \($0)" }.joined(separator: "\n")
            )
        }
        return sections.joined(separator: "\n\n")
    }

    private func mobileMeetingTitle(_ item: MobileHistoryItem) -> String {
        if let title = item.title?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !title.isEmpty
        {
            return String(title.prefix(160))
        }
        let date = Date(timeIntervalSince1970: item.createdAt / 1000)
        let formatted = DateFormatter.localizedString(
            from: date,
            dateStyle: .medium,
            timeStyle: .short
        )
        return "iPhone meeting · \(formatted)"
    }

    private func desktopMeetingHistory(
        from root: [String: Any]
    ) -> [MobileHistoryItem] {
        let meetings = root["meetings"] as? [[String: Any]] ?? []
        return meetings.compactMap { meeting in
            guard meeting["deletedAt"] == nil,
                  let id = meeting["id"] as? String,
                  let createdAt = number(meeting["createdAt"])
            else { return nil }
            let transcript = meeting["transcript"] as? String ?? ""
            let notes = meeting["notes"] as? String ?? ""
            let turns = desktopSpeakerTurns(from: meeting)
            let names = desktopSpeakerNames(from: meeting, turns: turns)
            return MobileHistoryItem(
                id: id,
                title: meeting["title"] as? String,
                text: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? transcript
                    : notes,
                rawText: transcript,
                createdAt: createdAt,
                durationMs: number(meeting["durationMs"]) ?? 0,
                provider: meeting["provider"] as? String ?? "grok",
                mode: "meeting",
                language: "auto",
                speakerTurns: turns.isEmpty ? nil : turns,
                speakerNames: names.isEmpty ? nil : names,
                meetingNotes: desktopNotes(from: notes),
                userNotes: meeting["userNotes"] as? String
            )
        }
    }

    private func desktopSpeakerTurns(
        from meeting: [String: Any]
    ) -> [MobileSpeakerTurn] {
        let records = meeting["transcriptTurns"] as? [[String: Any]] ?? []
        var speakerIndexes: [String: Int] = [:]
        return records.compactMap { record in
            guard let text = record["text"] as? String, !text.isEmpty else { return nil }
            let desktopID = record["speakerId"] as? String ?? "unknown"
            let speakerID: Int
            if desktopID == "unknown" || desktopID.hasSuffix("-unknown") {
                speakerID = -1
            } else if let existing = speakerIndexes[desktopID] {
                speakerID = existing
            } else {
                speakerID = speakerIndexes.count
                speakerIndexes[desktopID] = speakerID
            }
            let start = (number(record["startMs"]) ?? 0) / 1000
            let end = max(start, (number(record["endMs"]) ?? 0) / 1000)
            return MobileSpeakerTurn(
                id: record["id"] as? String ?? UUID().uuidString,
                speakerID: speakerID,
                start: start,
                end: end,
                text: text
            )
        }
    }

    private func desktopSpeakerNames(
        from meeting: [String: Any],
        turns: [MobileSpeakerTurn]
    ) -> [Int: String] {
        let speakers = meeting["speakers"] as? [[String: Any]] ?? []
        let orderedDesktopIDs = (meeting["transcriptTurns"] as? [[String: Any]] ?? [])
            .compactMap { $0["speakerId"] as? String }
            .filter { $0 != "unknown" && !$0.hasSuffix("-unknown") }
            .reduce(into: [String]()) { result, value in
                if !result.contains(value) { result.append(value) }
            }
        var result: [Int: String] = [:]
        for (index, desktopID) in orderedDesktopIDs.enumerated() {
            if let name = speakers.first(where: {
                ($0["id"] as? String) == desktopID
            })?["name"] as? String {
                result[index] = name
            }
        }
        if turns.contains(where: { $0.speakerID == -1 }) {
            result[-1] = "Unknown speaker"
        }
        return result
    }

    private func desktopNotes(from notes: String) -> MobileMeetingNotes? {
        let lines = notes.components(separatedBy: .newlines)
        var summary: [String] = []
        var actions: [String] = []
        var inActions = false
        for rawLine in lines {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty else { continue }
            if line.hasPrefix("#") {
                let heading = line
                    .trimmingCharacters(in: CharacterSet(charactersIn: "# "))
                    .lowercased()
                inActions =
                    heading.contains("to-do") ||
                    heading.contains("to do") ||
                    heading.contains("action")
                continue
            }
            let cleaned = line
                .replacingOccurrences(of: "^-\\s*\\[[ xX]\\]\\s*", with: "", options: .regularExpression)
                .replacingOccurrences(of: "^[-*]\\s*", with: "", options: .regularExpression)
            guard !cleaned.isEmpty else { continue }
            if inActions || line.range(
                of: #"^-\s*\[[ xX]\]"#,
                options: .regularExpression
            ) != nil {
                actions.append(cleaned)
            } else {
                summary.append(cleaned)
            }
        }
        guard !summary.isEmpty || !actions.isEmpty else { return nil }
        return MobileMeetingNotes(summary: summary, actionItems: actions)
    }

    private func mergeVocabulary(_ first: String, _ second: String) -> String {
        var values: [String: String] = [:]
        var order: [String] = []
        for line in (first + "\n" + second).components(separatedBy: .newlines) {
            let value = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { continue }
            let key = value.components(separatedBy: "—").first?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .uppercased() ?? value.uppercased()
            if values[key] == nil { order.append(key) }
            values[key] = value
        }
        return order.suffix(200).compactMap { values[$0] }.joined(separator: "\n")
    }

    private func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        return value as? Double
    }
}
