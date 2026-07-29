import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  migrateBuiltInModePrompt,
  migrateGrokCleanupModel
} from './defaults'

describe('built-in cleanup prompts', () => {
  it('keeps every built-in mode constrained to faithful editing', () => {
    for (const id of ['dictation', 'code', 'message']) {
      expect(defaultSettings.modes[id].prompt).toContain('Never summarize')
      expect(defaultSettings.modes[id].prompt).toContain('change its meaning')
    }
  })

  it('upgrades the old code prompt without overwriting a custom prompt', () => {
    const legacy =
      'Turn this spoken transcript into a precise instruction for a coding agent in the language being spoken. Preserve filenames, symbols, technical terms, preferred spellings, and stated constraints. If the speaker explains how a word is spelled, use that spelling but omit the spelling instruction. Use short paragraphs or bullets only when useful. Return only the instruction.'

    expect(migrateBuiltInModePrompt('code', legacy)).toBe(
      defaultSettings.modes.code.prompt
    )
    expect(migrateBuiltInModePrompt('code', 'My custom formatting.')).toBe(
      'My custom formatting.'
    )
  })

  it('moves only the previous Grok cleanup default to the fast model', () => {
    expect(migrateGrokCleanupModel('grok-4.5')).toBe('grok-4.3')
    expect(migrateGrokCleanupModel('my-private-model')).toBe('my-private-model')
  })
})
