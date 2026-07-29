import { describe, expect, it } from 'vitest'
import { automaticHistoryTitle } from './historyTitle'

describe('private automatic history titles', () => {
  it('uses the first meaningful thought and keeps technical acronyms exact', () => {
    expect(
      automaticHistoryTitle(
        'Então, precisamos corrigir HTML e IPS no fluxo bilíngue. Depois revisamos.'
      )
    ).toBe('Precisamos corrigir HTML e IPS no fluxo bilíngue')
  })

  it('handles English dictation without changing its words', () => {
    expect(
      automaticHistoryTitle('Well, ship the Windows updater after the final test.')
    ).toBe('Ship the Windows updater after the final test')
  })

  it('returns a safe local fallback for empty legacy entries', () => {
    expect(automaticHistoryTitle('   ')).toBe('Untitled transcript')
  })
})
