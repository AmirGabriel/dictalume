export interface ParsedMeetingNotes {
  summary: string[]
  todos: string[]
}

type MeetingSection = 'summary' | 'todos'

function sectionForHeading(heading: string): MeetingSection | null {
  const normalized = heading
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  if (/summary|resumo|sintese|decision|key detail/.test(normalized)) return 'summary'
  if (/to.?do|todo|action item|pendencia|proximo passo|acao/.test(normalized)) return 'todos'
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
  const result: ParsedMeetingNotes = { summary: [], todos: [] }
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
