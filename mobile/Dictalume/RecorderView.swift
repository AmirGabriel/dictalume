import SwiftUI

struct RecorderView: View {
    @EnvironmentObject private var model: AppModel
    private var recorder: AudioRecorder { model.recorder }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: recorder.isRecording ? "waveform.circle.fill" : "waveform.circle")
                        .font(.system(size: 54, weight: .regular))
                        .foregroundStyle(recorder.isRecording ? .red : .blue)
                        .symbolEffect(.pulse, isActive: recorder.isRecording)
                    Text(recorder.isRecording ? elapsed : "Ready to listen")
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    Text(recorder.isRecording
                         ? "You can keep speaking for as long as you need."
                         : "Record a thought or an in-person conversation.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 20)

                HStack(spacing: 5) {
                    ForEach(0..<19, id: \.self) { index in
                        Capsule()
                            .fill(recorder.isRecording ? Color.red : Color.secondary.opacity(0.22))
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
                        Task { await recorder.start() }
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

                if model.isProcessing {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Transcribing and polishing…")
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                }

                if !model.lastError.isEmpty {
                    Label(model.lastError, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
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
                            }
                            .accessibilityLabel("Copy transcript")
                        }
                        Text(latest.text)
                            .font(.body)
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
    }

    private var elapsed: String {
        let total = Int(recorder.duration)
        return "\(total / 60):\(String(format: "%02d", total % 60))"
    }

    private func barHeight(_ index: Int) -> CGFloat {
        guard recorder.isRecording else { return CGFloat(8 + (index % 4) * 4) }
        let wave = abs(sin(Double(index) * 0.72 + recorder.duration * 6))
        return 8 + CGFloat(wave) * CGFloat(12 + recorder.level * 22)
    }
}
