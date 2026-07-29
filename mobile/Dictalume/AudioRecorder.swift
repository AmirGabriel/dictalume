import AVFoundation
import Foundation

@MainActor
final class AudioRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var isPaused = false
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var level: Float = 0
    @Published private(set) var permissionDenied = false
    @Published private(set) var recordingError = ""

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private(set) var recordingURL: URL?
    private var interruptionObserver: NSObjectProtocol?
    private var routeChangeObserver: NSObjectProtocol?

    override init() {
        super.init()
        let center = NotificationCenter.default
        interruptionObserver = center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in
                self?.handleInterruption(notification)
            }
        }
        routeChangeObserver = center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in
                self?.handleRouteChange(notification)
            }
        }
    }

    deinit {
        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
        }
        if let routeChangeObserver {
            NotificationCenter.default.removeObserver(routeChangeObserver)
        }
    }

    func start() async {
        permissionDenied = false
        recordingError = ""
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
            guard recorder?.record() == true else {
                throw RecorderFailure.couldNotStart
            }
            recordingURL = url
            duration = 0
            isRecording = true
            isPaused = false
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let recorder = self.recorder else { return }
                    recorder.updateMeters()
                    self.duration = recorder.currentTime
                    self.level = max(0, min(1, (recorder.averagePower(forChannel: 0) + 55) / 55))
                }
            }
        } catch {
            recordingError = "The microphone could not start. Check the active input and try again."
            try? AVAudioSession.sharedInstance().setActive(false)
        }
    }

    func pause() {
        guard isRecording, !isPaused else { return }
        recorder?.pause()
        isPaused = true
        level = 0
    }

    func resume() {
        guard isRecording, isPaused else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            guard recorder?.record() == true else {
                throw RecorderFailure.couldNotResume
            }
            isPaused = false
            recordingError = ""
        } catch {
            recordingError = "Recording could not resume. Stop safely and start a new recording."
        }
    }

    func recoverIfNeeded() {
        guard isRecording, !isPaused, recorder?.isRecording != true else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            guard recorder?.record() == true else {
                throw RecorderFailure.couldNotResume
            }
            recordingError = ""
        } catch {
            recordingError = "The microphone was interrupted and could not resume."
        }
    }

    func stop() {
        recorder?.stop()
        timer?.invalidate()
        timer = nil
        level = 0
        isRecording = false
        isPaused = false
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(
        _ recorder: AVAudioRecorder,
        error: Error?
    ) {
        let message = error?.localizedDescription
            ?? "The recording stopped because the audio could not be encoded."
        Task { @MainActor [weak self] in
            self?.recordingError = message
        }
    }

    private func handleInterruption(_ notification: Notification) {
        guard
            let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawType)
        else { return }
        if type == .began {
            level = 0
            return
        }
        guard isRecording, !isPaused else { return }
        let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
        if options.contains(.shouldResume) {
            recoverIfNeeded()
        } else {
            recordingError = "The microphone was interrupted. Tap Resume to continue."
            isPaused = true
        }
    }

    private func handleRouteChange(_ notification: Notification) {
        guard isRecording, !isPaused else { return }
        let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
        guard let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason) else { return }
        if reason == .oldDeviceUnavailable || reason == .newDeviceAvailable {
            recoverIfNeeded()
        }
    }
}

private enum RecorderFailure: Error {
    case couldNotStart
    case couldNotResume
}
