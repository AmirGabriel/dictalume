export const DIGITAL_SILENCE_TIMEOUT_MS = 4_000
export const INPUT_RECOVERY_COOLDOWN_MS = 2_500

export interface AudioInputSnapshot {
  hasTrack: boolean
  trackMuted: boolean
  trackReadyState: MediaStreamTrackState | 'missing'
  contextState: AudioContextState | 'interrupted' | 'missing'
  silentForMs: number
}

export type AudioRecoveryReason =
  | 'missing-track'
  | 'ended-track'
  | 'muted-track'
  | 'suspended-context'
  | 'digital-silence'

export function audioRecoveryReason(
  snapshot: AudioInputSnapshot
): AudioRecoveryReason | null {
  if (!snapshot.hasTrack || snapshot.trackReadyState === 'missing') return 'missing-track'
  if (snapshot.trackReadyState === 'ended') return 'ended-track'
  if (snapshot.trackMuted) return 'muted-track'
  if (
    snapshot.contextState === 'suspended' ||
    snapshot.contextState === 'interrupted'
  ) {
    return 'suspended-context'
  }
  if (snapshot.silentForMs >= DIGITAL_SILENCE_TIMEOUT_MS) return 'digital-silence'
  return null
}
