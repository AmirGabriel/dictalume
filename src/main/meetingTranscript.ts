import type {
  MeetingRecord,
  MeetingSpeaker,
  MeetingTranscriptTurn
} from '../shared/types'

export function renderMeetingTranscript(
  turns: MeetingTranscriptTurn[],
  speakers: MeetingSpeaker[]
): string {
  const names = new Map(speakers.map((speaker) => [speaker.id, speaker.name]))
  return turns
    .map((turn) => {
      const totalSeconds = Math.max(0, Math.floor(turn.startMs / 1000))
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      const timestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      return `[${timestamp}] ${names.get(turn.speakerId) || 'Unknown speaker'}: ${turn.text}`
    })
    .join('\n\n')
}

export function relevantMeetings(
  meetings: MeetingRecord[],
  question: string
): MeetingRecord[] {
  const terms = Array.from(
    new Set(
      (question.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || [])
        .filter(
          (term) =>
            !['about', 'from', 'that', 'this', 'what', 'when', 'where', 'which'].includes(term)
        )
    )
  )
  return meetings
    .map((meeting) => {
      const title = meeting.title.toLocaleLowerCase()
      const notes = meeting.notes.toLocaleLowerCase()
      const transcript = meeting.transcript.toLocaleLowerCase()
      const score = terms.reduce(
        (total, term) =>
          total +
          (title.includes(term) ? 6 : 0) +
          (notes.includes(term) ? 3 : 0) +
          (transcript.includes(term) ? 1 : 0),
        0
      )
      return { meeting, score }
    })
    .sort(
      (left, right) =>
        right.score - left.score || right.meeting.createdAt - left.meeting.createdAt
    )
    .slice(0, 6)
    .map(({ meeting }) => meeting)
}

export function applyMeetingTranscriptRetention(
  meetings: MeetingRecord[],
  retentionDays: number,
  now = Date.now()
): { meetings: MeetingRecord[]; changed: boolean } {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { meetings, changed: false }
  }

  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  let changed = false
  const retained = meetings.map((meeting) => {
    const hasTranscript =
      Boolean(meeting.transcript.trim()) || Boolean(meeting.transcriptTurns?.length)
    const transcriptAgeAnchor = meeting.transcriptUpdatedAt || meeting.createdAt
    if (transcriptAgeAnchor > cutoff || meeting.transcriptDeletedAt || !hasTranscript) {
      return meeting
    }
    changed = true
    return {
      ...meeting,
      transcript: '',
      transcriptTurns: [],
      transcriptDeletedAt: now,
      updatedAt: now
    }
  })

  return { meetings: retained, changed }
}

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? '').replace(/\r\n?/g, '\n')
  return `"${text.replace(/"/g, '""')}"`
}

export function buildMeetingsCsv(meetings: MeetingRecord[]): string {
  const headings = [
    'id',
    'title',
    'created_at',
    'duration_seconds',
    'source',
    'space',
    'attendees',
    'notes',
    'user_notes',
    'transcript'
  ]
  const rows = meetings
    .filter((meeting) => !meeting.deletedAt)
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((meeting) => [
      meeting.id,
      meeting.title,
      new Date(meeting.createdAt).toISOString(),
      Math.round(meeting.durationMs / 1000),
      meeting.source,
      meeting.space,
      (meeting.attendees || [])
        .map((attendee) =>
          attendee.email
            ? `${attendee.name || attendee.email} <${attendee.email}>`
            : attendee.name
        )
        .filter(Boolean)
        .join('; '),
      meeting.notes,
      meeting.userNotes,
      meeting.transcript
    ])

  return `\uFEFF${[headings, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(','))
    .join('\r\n')}\r\n`
}
