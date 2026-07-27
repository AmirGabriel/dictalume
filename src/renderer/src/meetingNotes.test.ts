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
      todos: [
        'Ana — publish the release notes by Thursday.',
        'Bruno — confirm the analytics event.'
      ]
    })
  })

  it('recognizes Portuguese section headings', () => {
    expect(
      parseMeetingNotes('## Resumo\n- Escopo aprovado.\n\n## Pendências\n- [ ] Enviar proposta.')
    ).toEqual({
      summary: ['Escopo aprovado.'],
      todos: ['Enviar proposta.']
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
