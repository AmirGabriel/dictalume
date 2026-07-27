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

    let recorder = AudioRecorder()
    let contextStore = SharedContextStore()
    private var recorderUpdates: AnyCancellable?

    init() {
        recorderUpdates = recorder.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
        refreshSharedContext()
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

    func transcribeRecording() async {
        guard let url = recorder.recordingURL else { return }
        isProcessing = true
        lastError = ""
        defer { isProcessing = false }
        do {
            let audio = try Data(contentsOf: url)
            let service = TranscriptionService(settings: settings)
            let raw = try await service.transcribe(audio: audio, filename: "conversation.m4a")
            let learned = SpellingMemory.extract(from: raw)
            if !learned.isEmpty {
                settings.vocabulary = SpellingMemory.merge(settings.vocabulary, learned)
                saveSettings()
            }
            let cleaned = try await service.cleanup(raw, vocabulary: settings.vocabulary)
            let item = MobileHistoryItem(
                id: UUID().uuidString,
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
}

struct MobileHistoryItem: Codable, Identifiable {
    let id: String
    let text: String
    let rawText: String
    let createdAt: Double
    let durationMs: Double
    let provider: String
    let mode: String
    let language: String
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
            let value = try? JSONDecoder().decode(Self.self, from: data)
        else { return Self() }
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
