import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, LoaderCircle, Mic, Settings, X } from 'lucide-react'
import type { AppSettings, ContextSnapshot, RecorderState } from '../../shared/types'

const BARS = 24
const ERROR_DISMISS_DELAY_MS = 3_000

function playFeedback(kind: 'start' | 'finish'): void {
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = kind === 'start' ? 510 : 690
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.11)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.12)
  oscillator.addEventListener('ended', () => void context.close())
}

function formatElapsed(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function RecorderOverlay(): React.JSX.Element {
  const [state, setState] = useState<RecorderState>({ status: 'idle' })
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.08))
  const [elapsed, setElapsed] = useState('0:00')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const animationRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const startedAtRef = useRef(0)
  const contextRef = useRef<ContextSnapshot>({})
  const languageOverrideRef = useRef<string | undefined>(undefined)
  const stateRef = useRef<RecorderState>(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    void window.desktop.getSettings().then(setSettings)
    return window.desktop.onSettingsChanged(setSettings)
  }, [])

  const stopAudioGraph = useCallback(() => {
    cancelAnimationFrame(animationRef.current)
    analyserRef.current?.disconnect()
    analyserRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const animateLevels = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(data)
    const bucketSize = Math.max(1, Math.floor(data.length / BARS))
    const next = Array.from({ length: BARS }, (_, index) => {
      let sum = 0
      for (let i = 0; i < bucketSize; i += 1) {
        sum += data[index * bucketSize + i] || 0
      }
      return Math.max(0.08, Math.min(1, sum / bucketSize / 155))
    })
    setLevels(next)
    animationRef.current = requestAnimationFrame(animateLevels)
  }, [])

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    setState({ status: 'processing', message: 'Turning speech into text…' })
    const durationMs = Date.now() - startedAtRef.current

    recorder.onstop = async () => {
      stopAudioGraph()
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
      chunksRef.current = []
      try {
        const audio = new Uint8Array(await blob.arrayBuffer())
        const result = await window.desktop.transcribe({
          audio,
          mimeType: recorder.mimeType || 'audio/webm',
          durationMs,
          languageOverride: languageOverrideRef.current,
          context: contextRef.current
        })
        if (settings?.soundEffects) playFeedback('finish')
        setState({ status: 'success', text: result.text })
        window.setTimeout(() => {
          setState({ status: 'idle' })
          void window.desktop.cancelRecording()
        }, 1050)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Transcription failed. Try again.'
        setState({ status: 'error', message })
      }
    }
    recorder.stop()
  }, [settings?.soundEffects, stopAudioGraph])

  const startRecording = useCallback(async () => {
    try {
      contextRef.current = await window.desktop.captureContext()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1
        }
      })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000
      })
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.75
      source.connect(analyser)

      streamRef.current = stream
      recorderRef.current = recorder
      analyserRef.current = analyser
      chunksRef.current = []
      startedAtRef.current = Date.now()
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.start(1000)
      if (settings?.soundEffects) playFeedback('start')
      setState({ status: 'recording', startedAt: startedAtRef.current })
      animateLevels()
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access is off. Open Dictalume to enable it.'
          : error instanceof Error
            ? error.message
            : 'Could not start the microphone.'
      setState({ status: 'error', message })
    }
  }, [animateLevels, settings?.soundEffects])

  const toggle = useCallback((languageOverride?: string) => {
    const current = stateRef.current.status
    if (current === 'recording') void finishRecording()
    else if (current !== 'processing') {
      languageOverrideRef.current = languageOverride
      void startRecording()
    }
  }, [finishRecording, startRecording])

  const cancel = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      recorder.stop()
    }
    stopAudioGraph()
    chunksRef.current = []
    setState({ status: 'idle' })
    void window.desktop.cancelRecording()
  }, [stopAudioGraph])

  useEffect(() => window.desktop.onRecordingToggle(toggle), [toggle])

  useEffect(() => {
    if (state.status !== 'error') return
    const timeout = window.setTimeout(cancel, ERROR_DISMISS_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [cancel, state.status])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancel])

  useEffect(() => {
    if (state.status !== 'recording') return
    const tick = window.setInterval(() => setElapsed(formatElapsed(state.startedAt)), 250)
    return () => window.clearInterval(tick)
  }, [state])

  const openSettings = (): void => {
    cancel()
    void window.desktop.showMainWindow()
  }

  return (
    <main className={`recorder-shell recorder-${state.status}`}>
      <div className="recorder-leading" aria-hidden="true">
        {state.status === 'recording' && <Mic size={19} />}
        {state.status === 'processing' && <LoaderCircle className="spin" size={19} />}
        {state.status === 'success' && <Check size={19} />}
        {state.status === 'error' && <AlertCircle size={19} />}
        {state.status === 'idle' && <Mic size={19} />}
      </div>

      <div className="recorder-content">
        {state.status === 'recording' && (
          <>
            <div className="waveform" aria-label="Microphone level">
              {levels.map((level, index) => (
                <span
                  // Frequency position is stable; there is no semantic list key.
                  key={index}
                  style={{ transform: `scaleY(${level})` }}
                />
              ))}
            </div>
            <div className="recorder-meta">
              <strong>
                Listening
                {languageOverrideRef.current === 'pt'
                  ? ' · Português'
                  : languageOverrideRef.current === 'en'
                    ? ' · English'
                    : ''}
              </strong>
              <span>{elapsed}</span>
            </div>
          </>
        )}
        {state.status === 'processing' && (
          <div className="recorder-copy">
            <strong>Working</strong>
            <span>{state.message}</span>
          </div>
        )}
        {state.status === 'success' && (
          <div className="recorder-copy">
            <strong>{settings?.autoPaste ? 'Pasted' : 'Copied'}</strong>
            <span className="success-preview">{state.text}</span>
          </div>
        )}
        {state.status === 'error' && (
          <div className="recorder-copy">
            <strong>Couldn’t transcribe</strong>
            <span>{state.message}</span>
          </div>
        )}
        {state.status === 'idle' && (
          <div className="recorder-copy">
            <strong>Ready</strong>
            <span>Press the shortcut to start</span>
          </div>
        )}
      </div>

      {state.status === 'error' ? (
        <button className="icon-button" onClick={openSettings} aria-label="Open settings">
          <Settings size={17} />
        </button>
      ) : (
        <button className="icon-button" onClick={cancel} aria-label="Cancel recording">
          <X size={17} />
        </button>
      )}
      {state.status === 'recording' && <span className="escape-hint">esc</span>}
    </main>
  )
}
