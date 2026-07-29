const untitledMeeting = /^untitled meeting$/i

function cleanCandidate(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .replace(/^(?:speaker [a-z]|others?|conversation|unknown speaker|eu|me)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?;:,—–-]+$/, '')
    .trim()
}

function truncateTitle(value: string, limit = 64): string {
  if (value.length <= limit) return value
  const boundary = value.slice(0, limit + 1).lastIndexOf(' ')
  return `${value.slice(0, boundary > 32 ? boundary : limit).trim()}…`
}

/**
 * Produces an immediate, local title from the generated summary. It makes no
 * additional provider request, so leaving the title blank never adds latency or
 * sends more data than the notes request already did.
 */
export function automaticMeetingTitle(
  requestedTitle: string,
  existingTitle: string | undefined,
  notes: string,
  transcript: string
): string {
  const requested = requestedTitle.trim()
  if (requested && !untitledMeeting.test(requested)) return requested

  const existing = existingTitle?.trim() || ''
  if (existing && !untitledMeeting.test(existing)) return existing

  const noteLines = notes.split(/\r?\n/)
  const summaryIndex = noteLines.findIndex((line) => /^##\s+summary\s*$/i.test(line.trim()))
  const candidates =
    summaryIndex >= 0
      ? noteLines.slice(summaryIndex + 1).filter((line) => {
          const trimmed = line.trim()
          return Boolean(trimmed) && !trimmed.startsWith('#')
        })
      : []
  const transcriptCandidates = transcript
    .split(/\r?\n|(?<=[.!?])\s+/)
    .filter(Boolean)
  const candidate = [...candidates, ...transcriptCandidates]
    .map(cleanCandidate)
    .find((line) => line.length >= 4)

  return candidate ? truncateTitle(candidate) : 'Untitled meeting'
}
