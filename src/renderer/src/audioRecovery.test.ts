import { describe, expect, it } from 'vitest'
import {
  DIGITAL_SILENCE_TIMEOUT_MS,
  audioRecoveryReason
} from './audioRecovery'

const healthy = {
  hasTrack: true,
  trackMuted: false,
  trackReadyState: 'live' as const,
  contextState: 'running' as const,
  silentForMs: 0
}

describe('microphone recovery health checks', () => {
  it('keeps a live microphone connected', () => {
    expect(audioRecoveryReason(healthy)).toBeNull()
  })

  it('detects tracks that macOS muted or ended', () => {
    expect(audioRecoveryReason({ ...healthy, trackMuted: true })).toBe('muted-track')
    expect(
      audioRecoveryReason({ ...healthy, trackReadyState: 'ended' })
    ).toBe('ended-track')
  })

  it('detects an interrupted audio context', () => {
    expect(
      audioRecoveryReason({ ...healthy, contextState: 'interrupted' })
    ).toBe('suspended-context')
  })

  it('waits before treating exact digital zero as a failed input', () => {
    expect(
      audioRecoveryReason({
        ...healthy,
        silentForMs: DIGITAL_SILENCE_TIMEOUT_MS - 1
      })
    ).toBeNull()
    expect(
      audioRecoveryReason({
        ...healthy,
        silentForMs: DIGITAL_SILENCE_TIMEOUT_MS
      })
    ).toBe('digital-silence')
  })
})
