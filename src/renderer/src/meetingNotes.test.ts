import { describe, expect, it } from 'vitest'
import { composeMeetingDocument, parseMeetingNotes } from './meetingNotes'

describe('meeting notes', () => {
  it('separates summary bullets and pending tasks', () => {
    expect(
      parseMeetingNotes(`
## Summary
- The launch remains scheduled for Friday.
- Design approved the final flow.

## To-do list
- [ ] Ana — publish the release notes by Thursday.
- [ ] Bruno — confirm the analytics event.
      `)
    ).toEqual({
      summary: [
        'The launch remains scheduled for Friday.',
        'Design approved the final flow.'
      ],
      keyPoints: [],
      decisions: [],
      todos: [
        'Ana — publish the release notes by Thursday.',
        'Bruno — confirm the analytics event.'
      ],
      openQuestions: []
    })
  })

  it('recognizes Portuguese section headings', () => {
    expect(
      parseMeetingNotes('## Resumo\n- Escopo aprovado.\n\n## Pendências\n- [ ] Enviar proposta.')
    ).toEqual({
      summary: ['Escopo aprovado.'],
      keyPoints: [],
      decisions: [],
      todos: ['Enviar proposta.'],
      openQuestions: []
    })
  })

  it('keeps decisions and open questions in their own sections', () => {
    expect(
      parseMeetingNotes(
        '## Summary\n- Reviewed launch.\n\n## Decisions\n- Ship Friday.\n\n## Open questions\n- Who owns support?'
      )
    ).toEqual({
      summary: ['Reviewed launch.'],
      keyPoints: [],
      decisions: ['Ship Friday.'],
      todos: [],
      openQuestions: ['Who owns support?']
    })
  })

  it('copies the complete document with the transcript last', () => {
    const document = composeMeetingDocument(
      'Weekly',
      '## Summary\n- Shipped.',
      'Complete spoken transcript.'
    )
    expect(document).toContain('# Weekly')
    expect(document.indexOf('## Summary')).toBeLessThan(document.indexOf('## Full transcript'))
    expect(document.endsWith('Complete spoken transcript.')).toBe(true)
  })
})
