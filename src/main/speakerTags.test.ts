import { describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { SPEAKER_TAG_PORT, SpeakerTagManager } from './speakerTags'

describe('Google Meet speaker tags', () => {
  it('matches only a nearby active-speaker heartbeat', () => {
    const now = 1_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const manager = new SpeakerTagManager()
    const receive = (
      manager as unknown as { receive(data: Buffer): void }
    ).receive.bind(manager)

    receive(Buffer.from(JSON.stringify({
      type: 'speaker-active',
      name: '  Ana   Silva ',
      capturedAt: now,
      meetingUrl: 'https://meet.google.com/abc-defg-hij'
    })))

    expect(manager.speakerAt(now + 2_000)).toBe('Ana Silva')
    expect(manager.speakerAt(now + 3_000)).toBeUndefined()
    vi.restoreAllMocks()
  })

  it('rejects stale, malformed, and non-Meet events', () => {
    const now = 2_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const manager = new SpeakerTagManager()
    const receive = (
      manager as unknown as { receive(data: Buffer): void }
    ).receive.bind(manager)

    for (const payload of [
      { type: 'speaker-active', name: 'Ana', capturedAt: now - 70_000, meetingUrl: 'https://meet.google.com/a' },
      { type: 'speaker-active', name: '', capturedAt: now, meetingUrl: 'https://meet.google.com/a' },
      { type: 'speaker-active', name: 'Ana', capturedAt: now, meetingUrl: 'https://example.com/' }
    ]) {
      receive(Buffer.from(JSON.stringify(payload)))
    }

    expect(manager.eventsBetween(0, now)).toEqual([])
    vi.restoreAllMocks()
  })

  it('accepts live events through the loopback bridge from an extension origin', async () => {
    const manager = new SpeakerTagManager()
    const status = await manager.start()
    expect(status.error).toBe('')
    const socket = new WebSocket(`ws://127.0.0.1:${SPEAKER_TAG_PORT}`, {
      origin: 'chrome-extension://dictalume-test'
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    const capturedAt = Date.now()
    socket.send(JSON.stringify({
      type: 'speaker-active',
      name: 'Ana Silva',
      capturedAt,
      meetingUrl: 'https://meet.google.com/abc-defg-hij'
    }))

    await vi.waitFor(() => {
      expect(manager.speakerAt(capturedAt)).toBe('Ana Silva')
    })
    socket.close()
    manager.stop()
  })
})
