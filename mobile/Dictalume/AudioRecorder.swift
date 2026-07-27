import AVFoundation
import Foundation

@MainActor
final class AudioRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var level: Float = 0
    @Published private(set) var permissionDenied = false

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private(set) var recordingURL: URL?

    func start() async {
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else {
            permissionDenied = true
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .spokenAudio, options: [])
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("dictalume-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 24_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 48_000,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]
            recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder?.delegate = self
            recorder?.isMeteringEnabled = true
            recorder?.record()
            recordingURL = url
            duration = 0
            isRecording = true
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let recorder = self.recorder else { return }
                    recorder.updateMeters()
                    self.duration = recorder.currentTime
                    self.level = max(0, min(1, (recorder.averagePower(forChannel: 0) + 55) / 55))
                }
            }
        } catch {
            permissionDenied = true
        }
    }

    func stop() {
        recorder?.stop()
        timer?.invalidate()
        timer = nil
        level = 0
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false)
    }
}
