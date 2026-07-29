const MAX_MEMORY_ITEMS = 200
const AUTOMATIC_TERM_THRESHOLD = 2

/**
 * Small, product-agnostic seed vocabulary for terms that are commonly spoken in
 * Portuguese sentences but should remain in their conventional English form.
 * User vocabulary is always sent first and therefore wins the provider limit.
 */
export const BUILT_IN_TECHNICAL_TERMS = [
  'HTML',
  'CSS',
  'JavaScript',
  'TypeScript',
  'React',
  'Swift',
  'SwiftUI',
  'Xcode',
  'GitHub',
  'API',
  'APIs',
  'SDK',
  'JSON',
  'SQL',
  'iOS',
  'macOS',
  'Windows',
  'IPS'
] as const

const automaticTermStopWords = new Set([
  'EU',
  'UM',
  'UMA',
  'UNS',
  'UMAS',
  'ELE',
  'ELA',
  'DE',
  'DO',
  'DA',
  'DOS',
  'DAS',
  'EM',
  'NO',
  'NA',
  'THE',
  'AND',
  'FOR',
  'WITH'
])

function normalizeSpelling(value: string): string {
  return value.replace(/[^A-Za-z]/g, '').toUpperCase()
}

export function extractSpellingMemories(transcript: string): string[] {
  const learned = new Set<string>()
  const add = (value: string): void => {
    const normalized = normalizeSpelling(value)
    if (normalized.length >= 2 && normalized.length <= 32) learned.add(normalized)
  }

  // Handles explicit sequences such as N-I-X, N.I.X, and N - I - X.
  for (const match of transcript.matchAll(/\b([A-Za-z](?:\s*[-.]\s*[A-Za-z]){1,})\b/g)) {
    add(match[1])
  }

  // Handles phrases such as “spell it N I X” when the provider removes hyphens.
  for (const match of transcript.matchAll(
    /\b(?:spell(?:ed|ing)?|write|written|escrev[ae]|soletr[ae])\b[^.!?\n]{0,48}?\b((?:[A-Za-z]\s+){1,}[A-Za-z])\b/gi
  )) {
    add(match[1])
  }

  return [...learned]
}

export function mergeVocabulary(vocabulary: string, learned: string[]): string {
  const lines = vocabulary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const searchable = lines.join('\n').toLocaleUpperCase()

  for (const spelling of learned) {
    if (!searchable.includes(spelling.toLocaleUpperCase())) {
      lines.push(`${spelling} — learned from your spelling`)
    }
  }

  return lines.slice(-MAX_MEMORY_ITEMS).join('\n')
}

function vocabularyTermFromLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*•]\s*/, '')
    .split(/\s+[—–]\s+/, 1)[0]
    .trim()
}

/**
 * Converts the human-readable vocabulary store into provider-ready keyterms.
 * This deliberately strips annotations such as “— learned from your spelling”;
 * sending those annotations as part of a keyterm weakens the STT bias.
 */
export function vocabularyKeyterms(vocabulary: string, limit = 100): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  const add = (value: string): void => {
    const term = vocabularyTermFromLine(value).slice(0, 50)
    const key = term.toLocaleLowerCase()
    if (!term || seen.has(key) || terms.length >= limit) return
    seen.add(key)
    terms.push(term)
  }

  vocabulary.split('\n').forEach(add)
  BUILT_IN_TECHNICAL_TERMS.forEach(add)
  return terms
}

function automaticTermCandidates(text: string): string[] {
  const candidates = text.match(/\b[A-Z][A-Z0-9.+#/-]{1,15}\b/g) || []
  return Array.from(
    new Set(
      candidates.filter((term) => {
        const letters = term.replace(/[^A-Z]/g, '')
        return letters.length >= 2 && !automaticTermStopWords.has(term)
      })
    )
  )
}

/**
 * Learns distinctive technical spellings only after they recur. The caller owns
 * the observation map, which lets a process collect evidence without persisting
 * one-off model guesses. Once returned, a term is stored in the normal synced
 * vocabulary and becomes a keyterm on every device.
 */
export function observeAutomaticTermMemories(
  cleanedTranscript: string,
  observations: Map<string, number>
): string[] {
  const learned: string[] = []
  const builtIns = new Set(BUILT_IN_TECHNICAL_TERMS.map((term) => term.toLocaleUpperCase()))

  for (const term of automaticTermCandidates(cleanedTranscript)) {
    if (builtIns.has(term.toLocaleUpperCase())) continue
    const count = (observations.get(term) || 0) + 1
    observations.set(term, count)
    if (count === AUTOMATIC_TERM_THRESHOLD) learned.push(term)
  }
  return learned
}
