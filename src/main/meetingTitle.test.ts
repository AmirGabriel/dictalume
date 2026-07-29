import { describe, expect, it } from 'vitest'
import { automaticMeetingTitle } from './meetingTitle'

describe('automatic meeting titles', () => {
  it('keeps a title supplied by the user', () => {
    expect(
      automaticMeetingTitle(
        'IPS planning',
        undefined,
        '## Summary\n- Another topic',
        'Transcript'
      )
    ).toBe('IPS planning')
  })

  it('uses the first summary idea without making another AI request', () => {
    expect(
      automaticMeetingTitle(
        '',
        undefined,
        '## Summary\n- Revisamos a migração do HTML para o novo editor. <!-- evidence:turn-1 -->\n## Decisions',
        'Eu: texto'
      )
    ).toBe('Revisamos a migração do HTML para o novo editor')
  })

  it('falls back to a concise transcript title and removes generic speaker labels', () => {
    expect(
      automaticMeetingTitle('', 'Untitled meeting', '', 'Speaker A: Quarterly roadmap review. Next.')
    ).toBe('Quarterly roadmap review')
  })

  it('does not replace a meaningful existing meeting title when resuming', () => {
    expect(
      automaticMeetingTitle('', 'Weekly product sync', '## Summary\n- New subject', 'Transcript')
    ).toBe('Weekly product sync')
  })
})
