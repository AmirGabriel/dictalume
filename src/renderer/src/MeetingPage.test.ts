import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MeetingCapture } from './MeetingPage'

class FakeStream {
  constructor(private readonly audioTracks = [{}]) {}
  getAudioTracks(): object[] {
    return this.audioTracks
  }
  getTracks(): Array<{ stop(): void }> {
    return [...this.audioTracks, { stop: vi.fn() }].map(() => ({ stop: vi.fn() }))
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
  })

  it('serializes a four-minute rotation with an immediate stop', async () => {
    const capture = new MeetingCapture()
    await capture.start(false)

    const rotation = vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    const stopping = capture.stop()
    await rotation
    const segments = await stopping

    expect(segments).toHaveLength(1)
    expect(segments.every((segment) => segment.audio.byteLength > 0)).toBe(true)
  })
})
