const openingFillers = new Set([
  'ah',
  'assim',
  'basicamente',
  'bom',
  'então',
  'entao',
  'okay',
  'ok',
  'so',
  'tipo',
  'well'
])

const wordPattern = /[\p{L}\p{N}]+(?:[.+#/-][\p{L}\p{N}+#/-]+)*/gu

export function automaticHistoryTitle(text: string): string {
  const normalized = text
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return 'Untitled transcript'

  const firstThought =
    normalized
      .split(/(?<=[.!?])\s+/u)
      .find((part) => part.match(wordPattern)?.length) || normalized
  const words = firstThought.match(wordPattern) || []
  while (
    words.length > 1 &&
    openingFillers.has(words[0]!.toLocaleLowerCase('pt-BR'))
  ) {
    words.shift()
  }
  const selected: string[] = []
  for (const word of words) {
    const candidate = [...selected, word].join(' ')
    if (selected.length >= 8 || (candidate.length > 64 && selected.length >= 3)) break
    selected.push(word)
  }
  if (selected.length === 0) return 'Untitled transcript'

  const first = selected[0]
  if (first !== first.toLocaleUpperCase('pt-BR')) {
    selected[0] =
      first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1)
  }
  return selected.join(' ').slice(0, 72)
}
