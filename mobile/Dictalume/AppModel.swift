import AVFoundation
import Combine
import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var selectedTab: AppTab = .record
    @Published var history: [MobileHistoryItem] = []
    @Published var settings = MobileSettings.load()
    @Published var lastError = ""
    @Published var isProcessing = false
    @Published var recordingMode: MobileRecordingMode = .dictation
    @Published var pendingMeeting: MobileMeetingDraft?
    @Published var liveMeetingNotes = ""
    @Published var activeMeetingTitle = ""
    @Published var meetingChat: [MobileChatMessage] = []
    @Published var isChatting = false
    @Published var chatError = ""
#if DEBUG
    let showMeetingNotesPreview = ProcessInfo.processInfo.arguments.contains(
        "-dictalumeQAMeetingNotes"
    )
#else
    let showMeetingNotesPreview = false
#endif

    let recorder = AudioRecorder()
    let upcomingMeetings = UpcomingMeetingsStore()
    let contextStore = SharedContextStore()
    private var recorderUpdates: AnyCancellable?
    private var shortcutRequests: AnyCancellable?
    private var automaticTermObservations: [String: Int] = [:]

    init() {
        recorderUpdates = recorder.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
        shortcutRequests = NotificationCenter.default
            .publisher(for: ShortcutRecordingRequest.notification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.consumePendingShortcutRecording()
                }
        }
        refreshSharedContext()
        meetingChat = contextStore.localMeetingChat()
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-dictalumeQAChat") {
            meetingChat = [
                MobileChatMessage(
                    id: "qa-chat-user",
                    role: "user",
                    content: "What did we decide about the NIX deployment?",
                    createdAt: Date().timeIntervalSince1970 * 1000
                ),
                MobileChatMessage(
                    id: "qa-chat-assistant",
                    role: "assistant",
                    content: "I could not find an explicit deployment decision in the saved meetings. The customer interview mentions NIX, but no confirmed owner or deadline was recorded.",
                    createdAt: Date().timeIntervalSince1970 * 1000 + 1
                )
            ]
        }
#endif
    }

    func saveSettings() {
        settings.save()
    }

    func refreshSharedContext() {
        contextStore.refreshFromSelectedFile()
        settings.applySharedContext(contextStore.snapshot())
        let combined = contextStore.localHistory() + contextStore.sharedHistory()
        history = Dictionary(grouping: combined, by: \.id)
            .compactMap { $0.value.max(by: { $0.createdAt < $1.createdAt }) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func consumePendingShortcutRecording() {
        guard let mode = ShortcutRecordingRequest.consume() else { return }
        startRecordingFromShortcut(mode: mode)
    }

    func startRecordingFromShortcut(mode: MobileRecordingMode = .dictation) {
        selectedTab = .record
        recordingMode = mode
        if mode == .meeting {
            activeMeetingTitle = ""
        }
        startRecording()
    }

    func startMeeting(from meeting: MobileCalendarMeeting) {
        guard !isProcessing, !recorder.isRecording else { return }
        selectedTab = .record
        recordingMode = .meeting
        activeMeetingTitle = meeting.title
        startRecording()
    }

    func startRecording() {
        lastError = ""
        guard !isProcessing, !recorder.isRecording else { return }
        if recordingMode == .meeting {
            liveMeetingNotes = ""
            if activeMeetingTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                activeMeetingTitle = "In-person meeting"
            }
        }
        Task {
            await recorder.start()
            if recorder.permissionDenied {
                lastError = "Allow microphone access in Settings to start recording from a shortcut."
            } else if !recorder.recordingError.isEmpty {
                lastError = recorder.recordingError
            }
        }
    }

    func transcribeRecording() async {
        guard let url = recorder.recordingURL else { return }
        isProcessing = true
        lastError = ""
        defer { isProcessing = false }
        do {
            let audio = try Data(contentsOf: url)
            let service = TranscriptionService(settings: settings)
            if recordingMode == .meeting {
                let meetingKey = KeychainStore.get(account: "meeting.deepgram")
                let result = try await service.transcribeMeeting(
                    audio: audio,
                    deepgramAPIKey: meetingKey
                )
                pendingMeeting = MobileMeetingDraft(
                    id: UUID().uuidString,
                    title: activeMeetingTitle,
                    rawTranscript: result.transcript,
                    turns: result.turns,
                    speakerNames: Dictionary(
                        uniqueKeysWithValues: result.speakerIDs.map {
                            ($0, "Speaker \($0 + 1)")
                        }
                    ),
                    userNotes: liveMeetingNotes,
                    durationMs: recorder.duration * 1000,
                    createdAt: Date().timeIntervalSince1970 * 1000
                )
                return
            }
            let raw = try await service.transcribe(audio: audio, filename: "conversation.m4a")
            let learned = SpellingMemory.extract(from: raw)
            if !learned.isEmpty {
                settings.vocabulary = SpellingMemory.merge(settings.vocabulary, learned)
                saveSettings()
            }
            let cleaned = try await service.cleanup(raw, vocabulary: settings.vocabulary)
            let automaticTerms = SpellingMemory.observeAutomatic(
                from: cleaned,
                observations: &automaticTermObservations
            )
            if !automaticTerms.isEmpty {
                settings.vocabulary = SpellingMemory.merge(settings.vocabulary, automaticTerms)
                saveSettings()
            }
            let item = MobileHistoryItem(
                id: UUID().uuidString,
                title: AutomaticTitle.dictation(cleaned),
                text: cleaned,
                rawText: raw,
                createdAt: Date().timeIntervalSince1970 * 1000,
                durationMs: recorder.duration * 1000,
                provider: settings.provider.rawValue,
                mode: "dictation",
                language: settings.language
            )
            history.insert(item, at: 0)
            contextStore.saveLocalHistory(history)
            contextStore.publish(transcript: cleaned, item: item, vocabulary: settings.vocabulary)
        } catch {
            lastError = error.localizedDescription
        }
    }

    func setPendingSpeakerName(_ name: String, speakerID: Int) {
        pendingMeeting?.speakerNames[speakerID] = name
    }

    func setPendingUserNotes(_ notes: String) {
        pendingMeeting?.userNotes = String(notes.prefix(20_000))
    }

    func confirmedMeetingTranscript(_ draft: MobileMeetingDraft) -> String {
        draft.turns.map { turn in
            let fallback = turn.speakerID >= 0
                ? "Speaker \(turn.speakerID + 1)"
                : "Unknown speaker"
            let name = draft.speakerNames[turn.speakerID]?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return "\(name?.isEmpty == false ? name! : fallback): \(turn.text)"
        }.joined(separator: "\n\n")
    }

    func finishPendingMeeting(generateNotes: Bool) async {
        guard let draft = pendingMeeting, !isProcessing else { return }
        isProcessing = true
        lastError = ""
        defer { isProcessing = false }
        let transcript = confirmedMeetingTranscript(draft)
        do {
            let notes = generateNotes
                ? try await TranscriptionService(settings: settings)
                    .generateMeetingNotes(
                        transcript: transcript,
                        userNotes: draft.userNotes
                    )
                : nil
            let text = renderMeeting(notes: notes, transcript: transcript)
            let resolvedTitle = AutomaticTitle.meeting(
                explicitTitle: draft.title,
                notes: notes,
                transcript: transcript
            )
            let item = MobileHistoryItem(
                id: draft.id,
                title: resolvedTitle,
                text: text,
                rawText: draft.rawTranscript,
                createdAt: draft.createdAt,
                durationMs: draft.durationMs,
                provider: settings.provider.rawValue,
                mode: "meeting",
                language: settings.language,
                speakerTurns: draft.turns,
                speakerNames: draft.speakerNames,
                meetingNotes: notes,
                userNotes: draft.userNotes
            )
            history.insert(item, at: 0)
            contextStore.saveLocalHistory(history)
            contextStore.publish(transcript: text, item: item, vocabulary: settings.vocabulary)
            pendingMeeting = nil
            liveMeetingNotes = ""
            activeMeetingTitle = ""
        } catch {
            lastError = error.localizedDescription
        }
    }

    func discardPendingMeeting() {
        pendingMeeting = nil
        liveMeetingNotes = ""
        activeMeetingTitle = ""
        lastError = ""
    }

    func askMeetings(_ question: String) async {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isChatting else { return }
        chatError = ""
        isChatting = true
        let userMessage = MobileChatMessage(
            id: UUID().uuidString,
            role: "user",
            content: String(trimmed.prefix(4_000)),
            createdAt: Date().timeIntervalSince1970 * 1000
        )
        let priorConversation = meetingChat
        meetingChat.append(userMessage)
        contextStore.saveLocalMeetingChat(meetingChat)
        defer { isChatting = false }
        do {
            let answer = try await TranscriptionService(settings: settings)
                .answerMeetingQuestion(
                    userMessage.content,
                    meetings: history,
                    conversation: priorConversation
                )
            meetingChat.append(
                MobileChatMessage(
                    id: UUID().uuidString,
                    role: "assistant",
                    content: answer,
                    createdAt: Date().timeIntervalSince1970 * 1000
                )
            )
            contextStore.saveLocalMeetingChat(meetingChat)
        } catch {
            chatError = error.localizedDescription
        }
    }

    func clearMeetingChat() {
        meetingChat = []
        chatError = ""
        contextStore.saveLocalMeetingChat([])
    }

    private func renderMeeting(
        notes: MobileMeetingNotes?,
        transcript: String
    ) -> String {
        var sections: [String] = []
        if let notes {
            sections.append(
                "Summary\n" + notes.summary.map { "• \($0)" }.joined(separator: "\n")
            )
            if !notes.actionItems.isEmpty {
                sections.append(
                    "To do\n" + notes.actionItems.map { "☐ \($0)" }.joined(separator: "\n")
                )
            }
        }
        sections.append("Transcript\n\(transcript)")
        return sections.joined(separator: "\n\n")
    }
}

struct MobileHistoryItem: Codable, Identifiable {
    let id: String
    var title: String? = nil
    let text: String
    let rawText: String
    let createdAt: Double
    let durationMs: Double
    let provider: String
    let mode: String
    let language: String
    var speakerTurns: [MobileSpeakerTurn]? = nil
    var speakerNames: [Int: String]? = nil
    var meetingNotes: MobileMeetingNotes? = nil
    var userNotes: String? = nil
}

struct MobileChatMessage: Codable, Identifiable {
    let id: String
    let role: String
    let content: String
    let createdAt: Double
}

enum MobileRecordingMode: String, CaseIterable, Identifiable {
    case dictation
    case meeting

    var id: String { rawValue }
    var title: String { self == .dictation ? "Dictation" : "Meeting" }
}

struct MobileSpeakerTurn: Codable, Identifiable {
    let id: String
    let speakerID: Int
    let start: Double
    let end: Double
    let text: String
}

struct MobileMeetingTranscription {
    let transcript: String
    let turns: [MobileSpeakerTurn]

    var speakerIDs: [Int] {
        Array(Set(turns.map(\.speakerID).filter { $0 >= 0 })).sorted()
    }
}

struct MobileMeetingDraft: Identifiable {
    let id: String
    let title: String
    let rawTranscript: String
    let turns: [MobileSpeakerTurn]
    var speakerNames: [Int: String]
    var userNotes: String
    let durationMs: Double
    let createdAt: Double

    var speakerIDs: [Int] {
        Array(Set(turns.map(\.speakerID).filter { $0 >= 0 })).sorted()
    }
}

struct MobileMeetingNotes: Codable {
    let summary: [String]
    let actionItems: [String]
}

enum MobileProvider: String, Codable, CaseIterable, Identifiable {
    case openai
    case grok
    case groq
    case deepgram
    case custom

    var id: String { rawValue }
    var title: String {
        switch self {
        case .openai: "OpenAI"
        case .grok: "Grok · xAI"
        case .groq: "Groq Cloud"
        case .deepgram: "Deepgram"
        case .custom: "Custom"
        }
    }
}

struct MobileSettings: Codable {
    var provider: MobileProvider = .openai
    var language = "auto"
    var baseURL = "https://api.openai.com/v1"
    var transcriptionModel = "gpt-4o-mini-transcribe"
    var cleanupModel = "gpt-4.1-mini"
    var vocabulary = ""
    var cleanup = true
    var cleanupPrompt = "Rewrite the voice transcript as polished text in the language spoken. Preserve meaning, terminology, and preferred spellings; add punctuation; remove filler and false starts. If the speaker explains a spelling, use it and omit the spelling instruction. Return only the cleaned text."

    static func load() -> MobileSettings {
        guard
            let data = UserDefaults.standard.data(forKey: "mobileSettings"),
            var value = try? JSONDecoder().decode(Self.self, from: data)
        else { return Self() }
        if value.provider == .grok,
           ["grok-3-mini", "grok-4.5"].contains(value.cleanupModel) {
            value.cleanupModel = "grok-4.3"
        }
        return value
    }

    mutating func applySharedContext(_ context: SharedContextSnapshot?) {
        guard let context else { return }
        if !context.vocabulary.isEmpty { vocabulary = context.vocabulary }
        if let sharedProvider = MobileProvider(rawValue: context.provider) {
            provider = sharedProvider
        }
        if !context.language.isEmpty { language = context.language }
        if !context.baseURL.isEmpty { baseURL = context.baseURL }
        if !context.transcriptionModel.isEmpty { transcriptionModel = context.transcriptionModel }
        if !context.cleanupModel.isEmpty { cleanupModel = context.cleanupModel }
        cleanup = context.cleanup
        if !context.cleanupPrompt.isEmpty { cleanupPrompt = context.cleanupPrompt }
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: "mobileSettings")
        }
    }
}
