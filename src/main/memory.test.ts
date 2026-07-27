import { describe, expect, it } from 'vitest'
import { extractSpellingMemories, mergeVocabulary } from './memory'

describe('spelling memory', () => {
  it('learns explicitly hyphenated spellings', () => {
    expect(
      extractSpellingMemories('Let’s use nix. You write it like N-I-X from now on.')
    ).toEqual(['NIX'])
  })

  it('learns spaced spellings after an English or Portuguese cue', () => {
    expect(extractSpellingMemories('Please spell it N I X.')).toEqual(['NIX'])
    expect(extractSpellingMemories('Escreva como K L A B I N.')).toEqual(['KLABIN'])
  })

  it('merges learned spellings without duplicates', () => {
    const existing = 'NIX — always uppercase'
    expect(mergeVocabulary(existing, ['NIX', 'KLABIN'])).toBe(
      'NIX — always uppercase\nKLABIN — learned from your spelling'
    )
  })
})
