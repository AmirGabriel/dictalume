import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, LoaderCircle, Settings, X } from 'lucide-react'
import type { AppSettings, ContextSnapshot, RecorderState } from '../../shared/types'
import {
  INPUT_RECOVERY_COOLDOWN_MS,
  audioRecoveryReason,
  type AudioRecoveryReason
} from './audioRecovery'

const BARS = 18
const ERROR_DISMISS_DELAY_MS = 3_000
const microphoneConstraints: MediaTrackConstraints = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  channelCount: 1
}

type InputHealth = 'healthy' | 'recovering' | 'unavailable'

function playFeedback(kind: 'start' | 'finish'): void {
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(kind === 'start' ? 660 : 760, context.currentTime)
  oscillator.frequency.exponentialRampToValueAtTime(
    kind === 'start' ? 820 : 690,
    context.currentTime + 0.09
  )
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.026, context.currentTime + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.13)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + 0.14)
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
  const [inputHealth, setInputHealth] = useState<InputHealth>('healthy')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const animationRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const inputGainRef = useRef<GainNode | null>(null)
  const compressorRef = useRef<DynamicsCompressorNode | null>(null)
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const recoveryRef = useRef<Promise<void> | null>(null)
  const retryTimerRef = useRef<number>(0)
  const shouldRecoverRef = useRef(false)
  const lastSignalAtRef = useRef(Date.now())
  const lastRecoveryAtRef = useRef(0)
  const silenceRecoveryAttemptedRef = useRef(false)
  const requestRecoveryRef = useRef<(reason: AudioRecoveryReason) => void>(() => {})
  const startedAtRef = useRef(0)
  const contextRef = useRef<ContextSnapshot>({})
  const languageOverrideRef = useRef<string | undefined>(undefined)
  const startAttemptRef = useRef(0)
  const stateRef = useRef<RecorderState>(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    void window.desktop.getSettings().then(setSettings)
    return window.desktop.onSettingsChanged(setSettings)
  }, [])

  const stopAudioGraph = useCallback(() => {
    shouldRecoverRef.current = false
    window.clearTimeout(retryTimerRef.current)
    retryTimerRef.current = 0
    cancelAnimationFrame(animationRef.current)
    sourceRef.current?.disconnect()
    sourceRef.current = null
    inputGainRef.current?.disconnect()
    inputGainRef.current = null
    compressorRef.current?.disconnect()
    compressorRef.current = null
    analyserRef.current?.disconnect()
    analyserRef.current = null
    destinationRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recoveryRef.current = null
    silenceRecoveryAttemptedRef.current = false
    setInputHealth('healthy')
  }, [])

  const connectMicrophone = useCallback(
    (stream: MediaStream, context: AudioContext): void => {
      const analyser = analyserRef.current
      const inputGain = inputGainRef.current
      const destination = destinationRef.current
      if (!analyser || !inputGain || !destination) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error('The audio recorder is not ready.')
      }

      const nextSource = context.createMediaStreamSource(stream)
      nextSource.connect(inputGain)
      const track = stream.getAudioTracks()[0]
      if (!track) {
        nextSource.disconnect()
        stream.getTracks().forEach((item) => item.stop())
        throw new Error('macOS did not provide an audio input.')
      }

      const requestRecovery = (): void => {
        if (!shouldRecoverRef.current) return
        requestRecoveryRef.current(track.readyState === 'ended' ? 'ended-track' : 'muted-track')
      }
      track.addEventListener('mute', requestRecovery)
      track.addEventListener('ended', requestRecovery)

      const previousSource = sourceRef.current
      const previousStream = streamRef.current
      sourceRef.current = nextSource
      streamRef.current = stream
      lastSignalAtRef.current = Date.now()
      previousSource?.disconnect()
      previousStream?.getTracks().forEach((item) => item.stop())
    },
    []
  )

  const recoverMicrophone = useCallback(
    (reason: AudioRecoveryReason): void => {
      if (!shouldRecoverRef.current || recoveryRef.current) return
      const now = Date.now()
      if (now - lastRecoveryAtRef.current < INPUT_RECOVERY_COOLDOWN_MS) return
      lastRecoveryAtRef.current = now
      if (reason === 'digital-silence') silenceRecoveryAttemptedRef.current = true
      setInputHealth('recovering')

      const recovery = Promise.resolve().then(async () => {
        try {
          const context = audioContextRef.current
          if (!context || context.state === 'closed') {
            throw new Error('The audio engine stopped.')
          }
          if (context.state !== 'running') await context.resume()
          sourceRef.current?.disconnect()
          sourceRef.current = null
          streamRef.current?.getTracks().forEach((track) => track.stop())
          streamRef.current = null
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: microphoneConstraints
          })
          if (!shouldRecoverRef.current) {
            stream.getTracks().forEach((track) => track.stop())
            return
          }
          connectMicrophone(stream, context)
          setInputHealth('healthy')
        } catch {
          if (!shouldRecoverRef.current) return
          setInputHealth('unavailable')
          window.clearTimeout(retryTimerRef.current)
          retryTimerRef.current = window.setTimeout(
            () => recoverMicrophone('missing-track'),
            INPUT_RECOVERY_COOLDOWN_MS
          )
        } finally {
          recoveryRef.current = null
        }
      })
      recoveryRef.current = recovery
    },
    [connectMicrophone]
  )

  useEffect(() => {
    requestRecoveryRef.current = recoverMicrophone
  }, [recoverMicrophone])

  const animateLevels = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    const data = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(data)
    let sumSquares = 0
    let peak = 0
    for (const value of data) {
      sumSquares += value * value
      peak = Math.max(peak, Math.abs(value))
    }
    const rms = Math.sqrt(sumSquares / data.length)
    if (peak > 0.000_001) {
      lastSignalAtRef.current = Date.now()
      silenceRecoveryAttemptedRef.current = false
      setInputHealth((current) => (current === 'healthy' ? current : 'healthy'))
    }
    const energy = Math.max(0.08, Math.min(1, rms * 120))
    const next = Array.from({ length: BARS }, (_, index) => {
      const centerDistance = Math.abs(index - (BARS - 1) / 2) / (BARS / 2)
      const envelope = 0.68 + (1 - centerDistance) * 0.32
      const texture = 0.88 + 0.12 * Math.sin(index * 1.7)
      return Math.max(0.08, Math.min(1, energy * envelope * texture))
    })
    setLevels(next)
    animationRef.current = requestAnimationFrame(animateLevels)
  }, [])

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    shouldRecoverRef.current = false
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
    const attempt = ++startAttemptRef.current
    setState({ status: 'processing', message: 'Opening microphone…' })
    try {
      contextRef.current = await window.desktop.captureContext()
      if (attempt !== startAttemptRef.current) return
      const audioContext = new AudioContext()
      await audioContext.resume()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.72
      const inputGain = audioContext.createGain()
      inputGain.gain.value = 2.8
      const compressor = audioContext.createDynamicsCompressor()
      compressor.threshold.value = -18
      compressor.knee.value = 12
      compressor.ratio.value = 4
      compressor.attack.value = 0.003
      compressor.release.value = 0.25
      const destination = audioContext.createMediaStreamDestination()
      inputGain.connect(compressor)
      compressor.connect(analyser)
      compressor.connect(destination)
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      inputGainRef.current = inputGain
      compressorRef.current = compressor
      destinationRef.current = destination
      shouldRecoverRef.current = true
      lastSignalAtRef.current = Date.now()
      silenceRecoveryAttemptedRef.current = false
      setInputHealth('healthy')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneConstraints
      })
      if (attempt !== startAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        void audioContext.close()
        return
      }
      connectMicrophone(stream, audioContext)
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : ''
      const recorder = new MediaRecorder(destination.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000
      })

      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.addEventListener('start', () => {
        startedAtRef.current = Date.now()
        if (settings?.soundEffects) playFeedback('start')
        setState({ status: 'recording', startedAt: startedAtRef.current })
        animateLevels()
      }, { once: true })
      recorder.start(1000)
    } catch (error) {
      stopAudioGraph()
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access is off. Open Dictalume to enable it.'
          : error instanceof Error
            ? error.message
            : 'Could not start the microphone.'
      setState({ status: 'error', message })
    }
  }, [animateLevels, connectMicrophone, settings?.soundEffects, stopAudioGraph])

  const toggle = useCallback((languageOverride?: string) => {
    const current = stateRef.current.status
    if (current === 'recording') void finishRecording()
    else if (current !== 'processing') {
      languageOverrideRef.current = languageOverride
      void startRecording()
    }
  }, [finishRecording, startRecording])

  const cancel = useCallback(() => {
    startAttemptRef.current += 1
    shouldRecoverRef.current = false
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

  useEffect(() => {
    if (state.status !== 'recording') return
    const checkInput = (): void => {
      const track = streamRef.current?.getAudioTracks()[0]
      const context = audioContextRef.current
      const reason = audioRecoveryReason({
        hasTrack: Boolean(track),
        trackMuted: track?.muted ?? false,
        trackReadyState: track?.readyState || 'missing',
        contextState:
          (context?.state as AudioContextState | 'interrupted' | undefined) || 'missing',
        silentForMs: Date.now() - lastSignalAtRef.current
      })
      if (!reason) return
      if (reason === 'digital-silence' && silenceRecoveryAttemptedRef.current) {
        setInputHealth('unavailable')
        return
      }
      recoverMicrophone(reason)
    }
    checkInput()
    const watchdog = window.setInterval(checkInput, 750)
    return () => window.clearInterval(watchdog)
  }, [recoverMicrophone, state.status])

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices) return
    const handleDeviceChange = (): void => {
      if (stateRef.current.status === 'recording') recoverMicrophone('missing-track')
    }
    mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange)
  }, [recoverMicrophone])

  const openSettings = (): void => {
    cancel()
    void window.desktop.showMainWindow()
  }

  return (
    <main
      className={`recorder-shell recorder-${state.status} recorder-input-${inputHealth}`}
    >
      {state.status !== 'recording' && (
        <div className="recorder-leading" aria-hidden="true">
        {state.status === 'processing' && <LoaderCircle className="spin" size={19} />}
        {state.status === 'success' && <Check size={19} />}
        {state.status === 'error' && <AlertCircle size={19} />}
        </div>
      )}

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
                {inputHealth === 'recovering'
                  ? 'Reconnecting microphone…'
                  : inputHealth === 'unavailable'
                    ? 'No microphone signal'
                    : languageOverrideRef.current === 'pt'
                      ? 'Português'
                      : languageOverrideRef.current === 'en'
                        ? 'English'
                        : 'Listening'}
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
    </main>
  )
}
