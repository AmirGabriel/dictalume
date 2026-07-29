import SwiftUI

struct RecorderView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var recorderSymbolSize: CGFloat = 54
    private var recorder: AudioRecorder { model.recorder }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                Picker("Recording type", selection: $model.recordingMode) {
                    ForEach(MobileRecordingMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .disabled(recorder.isRecording || model.isProcessing)
                .accessibilityHint("Meeting mode separates speakers before creating notes.")

                VStack(spacing: 8) {
                    Image(systemName: recorder.isRecording ? "waveform.circle.fill" : "waveform.circle")
                        .font(.system(size: min(recorderSymbolSize, 72), weight: .regular))
                        .foregroundStyle(recorder.isRecording ? .red : .blue)
                        .symbolEffect(.pulse, isActive: recorder.isRecording && !reduceMotion)
                    Text(
                        recorder.isPaused
                            ? "Paused · \(elapsed)"
                            : recorder.isRecording ? elapsed : "Ready to listen"
                    )
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    Text(recorder.isRecording
                         ? recorder.isPaused
                            ? "Your recording is safe. Resume when you are ready."
                            : model.recordingMode == .meeting &&
                                !model.activeMeetingTitle.isEmpty
                                ? model.activeMeetingTitle
                                : "You can keep speaking for as long as you need."
                         : model.recordingMode == .meeting
                            ? "Record everyone in the room, then confirm who spoke."
                            : "Record a thought or dictation.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 20)

                HStack(spacing: 5) {
                    ForEach(0..<19, id: \.self) { index in
                        Capsule()
                            .fill(
                                recorder.isRecording && !recorder.isPaused
                                    ? Color.red
                                    : Color.secondary.opacity(0.22)
                            )
                            .frame(width: 4, height: barHeight(index))
                    }
                }
                .frame(height: 42)
                .accessibilityHidden(true)

                Button {
                    if recorder.isRecording {
                        recorder.stop()
                        Task { await model.transcribeRecording() }
                    } else {
                        model.startRecording()
                    }
                } label: {
                    Label(
                        recorder.isRecording ? "Stop recording" : "Start recording",
                        systemImage: recorder.isRecording ? "stop.fill" : "mic.fill"
                    )
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .tint(recorder.isRecording ? .red : .blue)
                .disabled(model.isProcessing)

                if recorder.isRecording {
                    Button {
                        if recorder.isPaused {
                            recorder.resume()
                        } else {
                            recorder.pause()
                        }
                    } label: {
                        Label(
                            recorder.isPaused ? "Resume recording" : "Pause recording",
                            systemImage: recorder.isPaused ? "play.fill" : "pause.fill"
                        )
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.isProcessing)
                }

                if model.recordingMode == .meeting &&
                    (recorder.isRecording || model.showMeetingNotesPreview)
                {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label("Your notes", systemImage: "square.and.pencil")
                                .font(.headline)
                            Spacer()
                            Button {
                                appendNotePrefix("### ")
                            } label: {
                                Image(systemName: "textformat.size")
                            }
                            .accessibilityLabel("Add heading")
                            Button {
                                appendNotePrefix("- ")
                            } label: {
                                Image(systemName: "list.bullet")
                            }
                            .accessibilityLabel("Add bullet")
                        }
                        ZStack(alignment: .topLeading) {
                            if model.liveMeetingNotes.isEmpty {
                                Text("Capture decisions or context while people speak…")
                                    .foregroundStyle(.tertiary)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 8)
                                    .allowsHitTesting(false)
                            }
                            TextEditor(text: $model.liveMeetingNotes)
                                .frame(height: 130)
                                .scrollContentBackground(.hidden)
                        }
                        Text("These notes guide emphasis; they never replace the speaker transcript.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(
                        Color(uiColor: .secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 18)
                    )
                }

                if model.isProcessing {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text(
                            model.recordingMode == .meeting
                                ? "Separating speakers…"
                                : "Transcribing and polishing…"
                        )
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                }

                if !model.lastError.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Label(model.lastError, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                        if recorder.permissionDenied {
                            Button("Open microphone settings") {
                                guard let url = URL(string: UIApplication.openSettingsURLString) else {
                                    return
                                }
                                UIApplication.shared.open(url)
                            }
                            .font(.footnote.weight(.semibold))
                            .frame(minHeight: 44)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                }

                if !recorder.recordingError.isEmpty {
                    Label(recorder.recordingError, systemImage: "waveform.badge.exclamationmark")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(
                            .orange.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 14)
                        )
                }

                if let latest = model.history.first {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Label("Latest transcript", systemImage: "text.quote")
                                .font(.headline)
                            Spacer()
                            Button {
                                UIPasteboard.general.string = latest.text
                            } label: {
                                Image(systemName: "doc.on.doc")
                                    .frame(minWidth: 44, minHeight: 44)
                            }
                            .accessibilityLabel("Copy transcript")
                        }
                        Text(latest.text)
                            .font(.body)
                            .lineLimit(latest.mode == "meeting" ? 12 : nil)
                            .textSelection(.enabled)
                        Text("Available in the Dictalume keyboard")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                    .background(Color(uiColor: .secondarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                }
            }
            .padding()
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Record")
        .navigationBarTitleDisplayMode(.large)
        .onAppear {
            // Keep the shared context fresh when returning from another device.
            model.refreshSharedContext()
        }
        .sheet(item: $model.pendingMeeting) { _ in
            MeetingSpeakerReviewView()
                .environmentObject(model)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private var elapsed: String {
        let total = Int(recorder.duration)
        return "\(total / 60):\(String(format: "%02d", total % 60))"
    }

    private func barHeight(_ index: Int) -> CGFloat {
        guard recorder.isRecording, !recorder.isPaused else {
            return CGFloat(8 + (index % 4) * 4)
        }
        let wave = abs(sin(Double(index) * 0.72 + recorder.duration * 6))
        return 8 + CGFloat(wave) * CGFloat(12 + recorder.level * 22)
    }

    private func appendNotePrefix(_ prefix: String) {
        if !model.liveMeetingNotes.isEmpty && !model.liveMeetingNotes.hasSuffix("\n") {
            model.liveMeetingNotes += "\n"
        }
        model.liveMeetingNotes += prefix
    }
}

private struct MeetingSpeakerReviewView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            Group {
                if let draft = model.pendingMeeting {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 22) {
                            VStack(alignment: .leading, spacing: 6) {
                                Label("Confirm speakers", systemImage: "person.2.wave.2")
                                    .font(.title2.weight(.semibold))
                                Text(
                                    "Voice patterns created these labels. Rename only the people you recognize; Dictalume will not guess."
                                )
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            }

                            if draft.speakerIDs.isEmpty {
                                Label(
                                    "No reliable speaker boundary was found. The transcript stays attributed to Unknown speaker.",
                                    systemImage: "person.crop.circle.badge.questionmark"
                                )
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .padding()
                                .background(
                                    Color(uiColor: .secondarySystemGroupedBackground),
                                    in: RoundedRectangle(cornerRadius: 16)
                                )
                            } else {
                                VStack(spacing: 0) {
                                    ForEach(draft.speakerIDs, id: \.self) { speakerID in
                                        HStack(spacing: 12) {
                                            Image(systemName: "person.crop.circle.fill")
                                                .font(.title2)
                                                .foregroundStyle(.blue)
                                            TextField(
                                                "Speaker \(speakerID + 1)",
                                                text: Binding(
                                                    get: {
                                                        model.pendingMeeting?
                                                            .speakerNames[speakerID] ?? ""
                                                    },
                                                    set: {
                                                        model.setPendingSpeakerName(
                                                            $0,
                                                            speakerID: speakerID
                                                        )
                                                    }
                                                )
                                            )
                                            .textInputAutocapitalization(.words)
                                            .submitLabel(.done)
                                        }
                                        .padding(.vertical, 12)
                                        if speakerID != draft.speakerIDs.last {
                                            Divider().padding(.leading, 42)
                                        }
                                    }
                                }
                                .padding(.horizontal)
                                .background(
                                    Color(uiColor: .secondarySystemGroupedBackground),
                                    in: RoundedRectangle(cornerRadius: 16)
                                )
                            }

                            VStack(alignment: .leading, spacing: 12) {
                                Text("Speaker transcript")
                                    .font(.headline)
                                ForEach(draft.turns) { turn in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(speakerName(turn.speakerID, draft: draft))
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.blue)
                                        Text(turn.text)
                                            .font(.body)
                                            .textSelection(.enabled)
                                    }
                                }
                            }

                            VStack(alignment: .leading, spacing: 10) {
                                Label("Your notes", systemImage: "square.and.pencil")
                                    .font(.headline)
                                TextEditor(
                                    text: Binding(
                                        get: { model.pendingMeeting?.userNotes ?? "" },
                                        set: { model.setPendingUserNotes($0) }
                                    )
                                )
                                .frame(height: 110)
                                .padding(6)
                                .background(
                                    Color(uiColor: .secondarySystemGroupedBackground),
                                    in: RoundedRectangle(cornerRadius: 14)
                                )
                                Text("Used only as emphasis and context for the final notes.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            if !model.lastError.isEmpty {
                                Label(
                                    model.lastError,
                                    systemImage: "exclamationmark.triangle.fill"
                                )
                                .font(.footnote)
                                .foregroundStyle(.red)
                            }

                            VStack(spacing: 10) {
                                Button {
                                    Task {
                                        await model.finishPendingMeeting(generateNotes: true)
                                    }
                                } label: {
                                    HStack {
                                        if model.isProcessing { ProgressView().tint(.white) }
                                        Text(
                                            model.isProcessing
                                                ? "Creating notes…"
                                                : "Create meeting notes"
                                        )
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 50)
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(model.isProcessing)

                                Button("Save speaker transcript only") {
                                    Task {
                                        await model.finishPendingMeeting(generateNotes: false)
                                    }
                                }
                                .buttonStyle(.bordered)
                                .frame(maxWidth: .infinity, minHeight: 48)
                                .disabled(model.isProcessing)
                            }
                        }
                        .padding()
                    }
                    .background(Color(uiColor: .systemGroupedBackground))
                }
            }
            .navigationTitle("Meeting")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Discard", role: .destructive) {
                        model.discardPendingMeeting()
                    }
                    .disabled(model.isProcessing)
                }
            }
        }
        .interactiveDismissDisabled(model.isProcessing)
    }

    private func speakerName(
        _ speakerID: Int,
        draft: MobileMeetingDraft
    ) -> String {
        guard speakerID >= 0 else { return "Unknown speaker" }
        let value = draft.speakerNames[speakerID]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value! : "Speaker \(speakerID + 1)"
    }
}
