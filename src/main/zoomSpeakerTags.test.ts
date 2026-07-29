import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  isZoomSelfSpeakerCandidate,
  parseZoomSpeakerCandidate,
  ZOOM_ACCESSIBILITY_SCRIPT,
  ZOOM_CONSENT_SCRIPT,
  ZoomConsentGate
} from './zoomSpeakerTags'

const execFileAsync = promisify(execFile)

describe('Zoom Accessibility speaker tags', () => {
  it('extracts only names attached to an active-speaker signal', () => {
    expect(parseZoomSpeakerCandidate('Video of Ana Silva, is speaking')).toBe(
      'Ana Silva'
    )
    expect(parseZoomSpeakerCandidate('Active speaker: Bruno Costa')).toBe(
      'Bruno Costa'
    )
    expect(parseZoomSpeakerCandidate('Carla Souza está falando')).toBe(
      'Carla Souza'
    )
  })

  it('does not treat ordinary Zoom labels as speaker evidence', () => {
    expect(parseZoomSpeakerCandidate('Ana Silva')).toBe('')
    expect(parseZoomSpeakerCandidate('Mute button')).toBe('')
    expect(parseZoomSpeakerCandidate('Active speaker')).toBe('')
  })

  it('separates the local participant from other active speakers', () => {
    expect(isZoomSelfSpeakerCandidate('Video of Amir (Me), is speaking')).toBe(true)
    expect(parseZoomSpeakerCandidate('Video of Amir (Me), is speaking')).toBe('Amir')
    expect(isZoomSelfSpeakerCandidate('Video of Ana, is speaking')).toBe(false)
  })

  it('allows one consent message per meeting, only after another person speaks', () => {
    const gate = new ZoomConsentGate()
    gate.configure(true, 'This meeting is being transcribed.')
    expect(gate.messageForCandidate('Video of Amir (Me), is speaking', 10_000)).toBe('')
    expect(gate.messageForCandidate('Video of Ana, is speaking', 10_000)).toBe(
      'This meeting is being transcribed.'
    )
    gate.markSent()
    expect(gate.messageForCandidate('Video of Bruno, is speaking', 20_000)).toBe('')
    gate.reset()
    expect(gate.messageForCandidate('Video of Bruno, is speaking', 20_000)).toBe(
      'This meeting is being transcribed.'
    )
  })

  it.skipIf(process.platform !== 'darwin')(
    'uses valid macOS Accessibility automation syntax',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dictalume-zoom-script-'))
      try {
        const result = await execFileAsync('/usr/bin/osacompile', [
          '-o',
          join(directory, 'zoom-speaker.scpt'),
          '-e',
          ZOOM_ACCESSIBILITY_SCRIPT
        ])
        expect(typeof result.stdout).toBe('string')
        const consentResult = await execFileAsync('/usr/bin/osacompile', [
          '-o',
          join(directory, 'zoom-consent.scpt'),
          '-e',
          ZOOM_CONSENT_SCRIPT
        ])
        expect(typeof consentResult.stdout).toBe('string')
      } finally {
        await rm(directory, { recursive: true })
      }
    }
  )
})
