import { describe, expect, it } from 'vitest'
import {
  extractSpellingMemories,
  mergeVocabulary,
  observeAutomaticTermMemories,
  vocabularyKeyterms
} from './memory'

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

  it('sends clean user terms before built-in mixed-language technical terms', () => {
    const terms = vocabularyKeyterms(
      'NIX — learned from your spelling\n• Klabin — preferred company spelling'
    )

    expect(terms.slice(0, 2)).toEqual(['NIX', 'Klabin'])
    expect(terms).toContain('HTML')
    expect(terms).toContain('IPS')
    expect(terms).not.toContain('NIX — learned from your spelling')
  })

  it('learns a recurring technical acronym but ignores one-off guesses', () => {
    const observations = new Map<string, number>()

    expect(observeAutomaticTermMemories('Abra o portal ACME.', observations)).toEqual([])
    expect(observeAutomaticTermMemories('Use o fluxo ACME novamente.', observations)).toEqual([
      'ACME'
    ])
    expect(observeAutomaticTermMemories('HTML e IPS já são termos padrão.', observations)).toEqual(
      []
    )
  })
})
