import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLiveMeetingTurns,
  buildLiveSpeakerEvidence,
  MeetingCapture,
  scheduledMeetingDelay,
  speakerNamesFromTags,
  shouldAutoStopMeeting
} from './MeetingPage'

class FakeTrack extends EventTarget {
  stop = vi.fn()
}

class FakeStream {
  readonly audioTracks: FakeTrack[]
  readonly videoTracks: FakeTrack[]

  constructor(audioTracks = [new FakeTrack()], videoTracks = [new FakeTrack()]) {
    this.audioTracks = audioTracks
    this.videoTracks = videoTracks
  }
  getAudioTracks(): FakeTrack[] {
    return this.audioTracks
  }
  getTracks(): FakeTrack[] {
    return [...this.audioTracks, ...this.videoTracks]
  }
}

class FakeAudioContext {
  createMediaStreamDestination(): { stream: FakeStream } {
    return { stream: new FakeStream() }
  }
  createMediaStreamSource(): { connect(): void } {
    return { connect: vi.fn() }
  }
  resume(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
}

class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return true
  }

  state: RecordingState = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void | Promise<void>) | null = null

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['meeting-audio'], { type: this.mimeType }) })
    queueMicrotask(() => void this.onstop?.())
  }
}

describe('long meeting capture', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(new FakeStream()),
        getDisplayMedia: vi.fn().mockResolvedValue(new FakeStream())
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits for the final encoded segment before returning', async () => {
    const capture = new MeetingCapture()
    await capture.start(false)

    const segments = await capture.stop()

    expect(segments).toHaveLength(1)
    expect(segments[0].audio.byteLength).toBeGreaterThan(0)
    expect(segments[0]).toMatchObject({ source: 'microphone', startedAtMs: 0 })
  })

  it('keeps microphone and computer audio in separate source-labelled files', async () => {
    const capture = new MeetingCapture()
    await capture.start(true)

    const segments = await capture.stop()

    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.source)).toEqual(['microphone', 'system'])
  })

  it('serializes a thirty-second rotation with an immediate stop', async () => {
    const capture = new MeetingCapture()
    await capture.start(false)

    const rotation = vi.advanceTimersByTimeAsync(30 * 1000)
    const stopping = capture.stop()
    await rotation
    const segments = await stopping

    expect(segments).toHaveLength(1)
    expect(segments.every((segment) => segment.audio.byteLength > 0)).toBe(true)
  })

  it('can pause and resume without merging or losing encoded chunks', async () => {
    const capture = new MeetingCapture()
    await capture.start(false)

    await capture.pause()
    capture.resume()
    const segments = await capture.stop()

    expect(segments).toHaveLength(2)
    expect(segments.every((segment) => segment.source === 'microphone')).toBe(true)
  })

  it('delivers each finalized segment for live transcription before stop resolves', async () => {
    const onSegment = vi.fn(async () => undefined)
    const capture = new MeetingCapture(onSegment)
    await capture.start(false)

    const segments = await capture.stop()

    expect(onSegment).toHaveBeenCalledOnce()
    expect(onSegment).toHaveBeenCalledWith(segments[0])
    expect(segments[0].id).toBeTruthy()
  })

  it('notifies once when the shared meeting source ends', async () => {
    const display = new FakeStream()
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValueOnce(
      display as unknown as MediaStream
    )
    const onEnded = vi.fn()
    const capture = new MeetingCapture(undefined, onEnded)
    await capture.start(true)

    display.videoTracks[0].dispatchEvent(new Event('ended'))
    display.audioTracks[0].dispatchEvent(new Event('ended'))

    expect(onEnded).toHaveBeenCalledOnce()
    await capture.stop()
  })
})

describe('meeting auto-stop', () => {
  it('stops after fifteen silent minutes', () => {
    expect(shouldAutoStopMeeting(15 * 60_000, 0)).toBe(true)
    expect(shouldAutoStopMeeting(14 * 60_000, 0)).toBe(false)
  })

  it('uses calendar end only after two quiet minutes', () => {
    const now = 10 * 60_000
    expect(shouldAutoStopMeeting(now, now - 3 * 60_000, now - 1)).toBe(true)
    expect(shouldAutoStopMeeting(now, now - 30_000, now - 1)).toBe(false)
    expect(shouldAutoStopMeeting(now, now - 3 * 60_000, now + 1)).toBe(false)
  })
})

describe('scheduled meeting start', () => {
  const event = {
    id: 'event',
    title: 'Planning',
    startsAt: 10_000,
    endsAt: 20_000,
    joinUrl: '',
    provider: 'google-meet' as const
  }

  it('arms only a future event that has not ended', () => {
    expect(scheduledMeetingDelay(event, 7_000)).toBe(3_000)
    expect(scheduledMeetingDelay(event, 10_000)).toBeNull()
    expect(scheduledMeetingDelay(event, 21_000)).toBeNull()
  })
})

describe('live meeting transcript', () => {
  it('keeps source identity and stable diarization labels in chronological order', () => {
    expect(
      buildLiveMeetingTurns(
        [
          {
            segmentId: 'system',
            source: 'system',
            startedAtMs: 0,
            durationMs: 10_000,
            learnedVocabulary: [],
            chunks: [
              {
                text: 'Remote answer.',
                startMs: 3_000,
                endMs: 5_000,
                diarizationLabel: 'speaker-0'
              }
            ]
          },
          {
            segmentId: 'mic',
            source: 'microphone',
            startedAtMs: 0,
            durationMs: 10_000,
            learnedVocabulary: [],
            chunks: [{ text: 'My question.', startMs: 1_000, endMs: 2_000 }]
          },
          {
            segmentId: 'system-next',
            source: 'system',
            startedAtMs: 10_000,
            durationMs: 10_000,
            learnedVocabulary: [],
            chunks: [
              {
                text: 'Possibly another person.',
                startMs: 1_000,
                endMs: 2_000,
                diarizationLabel: 'speaker-0'
              }
            ]
          }
        ],
        'google-meet'
      )
    ).toEqual([
      {
        id: 'mic:0',
        source: 'microphone',
        speakerName: 'Me',
        startMs: 1_000,
        endMs: 2_000,
        text: 'My question.'
      },
      {
        id: 'system:0',
        source: 'system',
        speakerName: 'Speaker A',
        startMs: 3_000,
        endMs: 5_000,
        text: 'Remote answer.'
      },
      {
        id: 'system-next:0',
        source: 'system',
        speakerName: 'Speaker B',
        startMs: 11_000,
        endMs: 12_000,
        text: 'Possibly another person.'
      }
    ])
  })

  it('builds stable evidence keys for pre-note speaker confirmation', () => {
    expect(
      buildLiveSpeakerEvidence(
        [
          {
            segmentId: 'mic',
            source: 'microphone',
            startedAtMs: 0,
            durationMs: 10_000,
            learnedVocabulary: [],
            chunks: [{ text: 'My question.', startMs: 0, endMs: 1_000 }]
          },
          {
            segmentId: 'remote-1',
            source: 'system',
            startedAtMs: 0,
            durationMs: 10_000,
            learnedVocabulary: [],
            chunks: [
              {
                text: 'First answer.',
                startMs: 1_000,
                endMs: 2_000,
                diarizationLabel: 'speaker-0'
              },
              {
                text: 'More detail.',
                startMs: 2_000,
                endMs: 3_000,
                diarizationLabel: 'speaker-0'
              }
            ]
          }
        ],
        'google-meet'
      )
    ).toEqual([
      {
        key: 'microphone:me',
        suggestedName: 'Me',
        source: 'microphone',
        turnCount: 1
      },
      {
        key: 'system:remote-1:speaker-0',
        suggestedName: 'Speaker A',
        source: 'system',
        diarizationLabel: 'speaker-0',
        turnCount: 2
      }
    ])
  })

  it('uses only a temporally nearby Google Meet active-speaker signal', () => {
    const meetingStartedAt = 1_000_000
    const transcription = {
      segmentId: 'remote',
      source: 'system' as const,
      startedAtMs: 10_000,
      durationMs: 10_000,
      learnedVocabulary: [],
      chunks: [{
        text: 'The answer.',
        startMs: 1_000,
        endMs: 3_000,
        diarizationLabel: 'speaker-0'
      }]
    }
    expect(
      speakerNamesFromTags(
        [transcription],
        'google-meet',
        meetingStartedAt,
        [{
          name: 'Ana Silva',
          capturedAt: meetingStartedAt + 12_500,
          meetingUrl: 'https://meet.google.com/abc-defg-hij',
          source: 'google-meet'
        }]
      )
    ).toEqual({ 'system:remote:speaker-0': 'Ana Silva' })
    expect(
      speakerNamesFromTags(
        [transcription],
        'google-meet',
        meetingStartedAt,
        [{
          name: 'Wrong time',
          capturedAt: meetingStartedAt + 20_000,
          meetingUrl: 'https://meet.google.com/abc-defg-hij',
          source: 'google-meet'
        }]
      )
    ).toEqual({})
  })
})
