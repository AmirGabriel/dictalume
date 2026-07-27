const MAX_MEMORY_ITEMS = 200

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
