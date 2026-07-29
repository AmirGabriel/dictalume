export interface ParsedMeetingNotes {
  summary: string[]
  keyPoints: string[]
  decisions: string[]
  todos: string[]
  openQuestions: string[]
}

type MeetingSection = keyof ParsedMeetingNotes

function sectionForHeading(heading: string): MeetingSection | null {
  const normalized = heading
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  if (/summary|resumo|sintese/.test(normalized)) return 'summary'
  if (/key point|ponto.?chave|destaque|important context/.test(normalized)) return 'keyPoints'
  if (/decision|decisao|decisoes/.test(normalized)) return 'decisions'
  if (/to.?do|todo|action item|pendencia|proximo passo|acao/.test(normalized)) return 'todos'
  if (/open question|unresolved|questao em aberto|pergunta em aberto/.test(normalized)) {
    return 'openQuestions'
  }
  return null
}

function cleanListItem(line: string): string {
  return line
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .trim()
}

export function parseMeetingNotes(markdown: string): ParsedMeetingNotes {
  const result: ParsedMeetingNotes = {
    summary: [],
    keyPoints: [],
    decisions: [],
    todos: [],
    openQuestions: []
  }
  let section: MeetingSection = 'summary'

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const heading = line.match(/^#{1,6}\s+(.+)$/)
    if (heading) {
      const nextSection = sectionForHeading(heading[1])
      if (nextSection) section = nextSection
      continue
    }

    const item = cleanListItem(line)
    if (item) result[section].push(item)
  }

  return result
}

export function composeMeetingDocument(
  title: string,
  notes: string,
  transcript: string
): string {
  return [
    `# ${title}`,
    notes.trim(),
    '## Full transcript',
    transcript.trim()
  ]
    .filter(Boolean)
    .join('\n\n')
}
