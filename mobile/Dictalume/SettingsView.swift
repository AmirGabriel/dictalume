import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var apiKey = ""
    @State private var meetingDeepgramKey = ""
    @State private var showingContextPicker = false
    @State private var contextMessage = ""

    var body: some View {
        Form {
            Section("Provider") {
                Picker("Transcription", selection: $model.settings.provider) {
                    ForEach(MobileProvider.allCases) { provider in
                        Text(provider.title).tag(provider)
                    }
                }
                SecureField("API key", text: $apiKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Base URL", text: $model.settings.baseURL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Transcription model", text: $model.settings.transcriptionModel)
                TextField("Cleanup model", text: $model.settings.cleanupModel)
            }

            Section("Writing") {
                Picker("Language", selection: $model.settings.language) {
                    Text("Detect automatically").tag("auto")
                    Text("English").tag("en")
                    Text("Português").tag("pt")
                }
                Toggle("AI punctuation and cleanup", isOn: $model.settings.cleanup)
                NavigationLink("Writing memory") {
                    TextEditor(text: $model.settings.vocabulary)
                        .font(.body)
                        .padding(8)
                        .navigationTitle("Writing memory")
                        .navigationBarTitleDisplayMode(.inline)
                }
            }

            Section {
                SecureField("Deepgram API key", text: $meetingDeepgramKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Label(
                    "Speaker labels come from acoustic diarization, not from AI guesses.",
                    systemImage: "person.2.wave.2"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            } header: {
                Text("In-person meetings")
            } footer: {
                Text("Used only when Meeting is selected. Speaker 1, 2, and 3 remain anonymous until you confirm or rename them.")
            }

            Section {
                Button {
                    showingContextPicker = true
                } label: {
                    Label("Choose shared context.json", systemImage: "arrow.triangle.2.circlepath")
                }
                if !contextMessage.isEmpty {
                    Text(contextMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Same context everywhere")
            } footer: {
                Text("Choose the Dictalume/context.json file in iCloud Drive, OneDrive, or Dropbox. The app merges new vocabulary and transcripts into the same file used by Mac and Windows.")
            }

            Section("Dictalume Keyboard") {
                Label("Open Settings → General → Keyboard → Keyboards", systemImage: "1.circle")
                Label("Add “Dictalume Keyboard”", systemImage: "2.circle")
                Label("Allow Full Access for shared transcripts", systemImage: "3.circle")
                Text("Apple does not permit microphone access inside keyboard extensions. Record here, return to the previous app, then tap Insert latest on the keyboard.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                NavigationLink {
                    ShortcutSetupView()
                } label: {
                    Label("Set up Action Button", systemImage: "button.programmable")
                }
            } header: {
                Text("Instant recording")
            } footer: {
                Text("The Dictalume actions are already installed in Shortcuts; no manual shortcut building is required.")
            }

            Section {
                Button("Save settings") {
                    KeychainStore.set(apiKey, account: "provider.\(model.settings.provider.rawValue)")
                    KeychainStore.set(meetingDeepgramKey, account: "meeting.deepgram")
                    model.saveSettings()
                }
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
        .onAppear {
            apiKey = KeychainStore.get(account: "provider.\(model.settings.provider.rawValue)")
            meetingDeepgramKey = KeychainStore.get(account: "meeting.deepgram")
        }
        .onChange(of: model.settings.provider) { _, provider in
            apiKey = KeychainStore.get(account: "provider.\(provider.rawValue)")
            applyDefaults(provider)
        }
        .onDisappear {
            model.saveSettings()
        }
        .sheet(isPresented: $showingContextPicker) {
            ContextDocumentPicker { url in
                do {
                    try model.contextStore.selectContextFile(url)
                    model.refreshSharedContext()
                    contextMessage = "Context connected."
                } catch {
                    contextMessage = error.localizedDescription
                }
                showingContextPicker = false
            }
        }
    }

    private func applyDefaults(_ provider: MobileProvider) {
        switch provider {
        case .openai:
            model.settings.baseURL = "https://api.openai.com/v1"
            model.settings.transcriptionModel = "gpt-4o-mini-transcribe"
            model.settings.cleanupModel = "gpt-4.1-mini"
        case .grok:
            model.settings.baseURL = "https://api.x.ai/v1"
            model.settings.transcriptionModel = "stt"
            model.settings.cleanupModel = "grok-4.3"
        case .groq:
            model.settings.baseURL = "https://api.groq.com/openai/v1"
            model.settings.transcriptionModel = "whisper-large-v3-turbo"
            model.settings.cleanupModel = "llama-3.3-70b-versatile"
        case .deepgram:
            model.settings.baseURL = "https://api.deepgram.com"
            model.settings.transcriptionModel = "nova-3"
            model.settings.cleanupModel = ""
        case .custom:
            model.settings.baseURL = "http://localhost:8000/v1"
            model.settings.transcriptionModel = "whisper-1"
            model.settings.cleanupModel = ""
        }
    }
}

struct ContextDocumentPicker: UIViewControllerRepresentable {
    let onPick: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json])
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: (URL) -> Void
        init(onPick: @escaping (URL) -> Void) { self.onPick = onPick }
        func documentPicker(
            _ controller: UIDocumentPickerViewController,
            didPickDocumentsAt urls: [URL]
        ) {
            if let url = urls.first { onPick(url) }
        }
    }
}
