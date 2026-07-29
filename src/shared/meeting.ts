import type {
  MeetingAudioSegment,
  MeetingRecord,
  MeetingRequest,
  SpeakerTagEvent
} from './types'

export function meetingSpeakerEvidenceKey(
  source: MeetingAudioSegment['source'],
  meetingSource: MeetingRequest['source'],
  diarizationLabel?: string,
  diarizationScope?: string
): string {
  if (diarizationLabel) {
    return `${source}:${diarizationScope ? `${diarizationScope}:` : ''}${diarizationLabel}`
  }
  if (source === 'microphone' && meetingSource !== 'conversation') return 'microphone:me'
  if (source === 'system') return 'system:others'
  return 'microphone:conversation'
}

export function meetingSpeakerName(evidenceKey: string, anonymousIndex: number): string {
  if (evidenceKey === 'microphone:me') return 'Me'
  if (evidenceKey === 'system:others') return 'Others'
  if (evidenceKey === 'microphone:conversation') return 'Conversation'
  return `Speaker ${String.fromCharCode(65 + (anonymousIndex % 26))}`
}

export function confirmedMeetingSpeakerName(
  names: Record<string, string> | undefined,
  evidenceKey: string
): string | undefined {
  const name = names?.[evidenceKey]?.trim().slice(0, 80)
  return name || undefined
}

export function speakerTagNameForInterval(
  events: SpeakerTagEvent[],
  startedAt: number,
  endedAt: number
): string | undefined {
  const start = Math.max(0, startedAt)
  const end = Math.max(start, endedAt)
  const duration = end - start
  if (duration > 15_000 || events.length === 0) return undefined
  const sampleTimes =
    duration < 1_000
      ? [start + duration / 2]
      : [
          start + duration * 0.25,
          start + duration * 0.5,
          start + duration * 0.75
        ]
  const names = sampleTimes.map((timestamp) => {
    let closest: SpeakerTagEvent | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const event of events) {
      const distance = Math.abs(event.capturedAt - timestamp)
      if (distance < bestDistance) {
        closest = event
        bestDistance = distance
      }
    }
    return closest && bestDistance <= 2_500 ? closest.name : ''
  })
  const first = names[0]
  return first && names.every((name) => name === first) ? first : undefined
}

export interface MeetingDirectoryPerson {
  key: string
  name: string
  email?: string
  company?: string
  meetingIds: string[]
  lastMetAt: number
}

export interface MeetingDirectoryCompany {
  domain: string
  name: string
  people: number
  meetings: number
  lastMetAt: number
}

const personalEmailDomains = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com'
])

function companyForEmail(email = ''): { domain: string; name: string } | null {
  const domain = email.split('@')[1]?.toLocaleLowerCase()
  if (!domain || personalEmailDomains.has(domain)) return null
  const label = domain.split('.')[0].replace(/[-_]+/g, ' ')
  return {
    domain,
    name: label.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
  }
}

export function buildMeetingDirectory(meetings: MeetingRecord[]): {
  people: MeetingDirectoryPerson[]
  companies: MeetingDirectoryCompany[]
} {
  const people = new Map<string, MeetingDirectoryPerson>()
  for (const meeting of meetings.filter((item) => !item.deletedAt)) {
    const candidates = [
      ...(meeting.attendees || []).map((attendee) => ({
        name: attendee.name,
        email: attendee.email
      })),
      ...(meeting.speakers || [])
        .filter(
          (speaker) =>
            !/^(me|others|conversation|speaker [a-z]|earlier transcript)$/i.test(
              speaker.name.trim()
            )
        )
        .map((speaker) => ({ name: speaker.name, email: undefined }))
    ]
    for (const candidate of candidates) {
      const normalizedName = candidate.name.trim().toLocaleLowerCase()
      if (!normalizedName) continue
      const key = candidate.email?.toLocaleLowerCase() || `name:${normalizedName}`
      const existingByName = [...people.values()].find(
        (person) => person.name.trim().toLocaleLowerCase() === normalizedName
      )
      const existing = people.get(key) || existingByName
      const company = companyForEmail(candidate.email)
      const next: MeetingDirectoryPerson = {
        key: existing?.key || key,
        name: candidate.name.trim(),
        ...(candidate.email || existing?.email
          ? { email: candidate.email || existing?.email }
          : {}),
        ...(company?.name || existing?.company
          ? { company: company?.name || existing?.company }
          : {}),
        meetingIds: Array.from(new Set([...(existing?.meetingIds || []), meeting.id])),
        lastMetAt: Math.max(existing?.lastMetAt || 0, meeting.createdAt)
      }
      if (existing && existing.key !== key) people.delete(existing.key)
      people.set(next.key, next)
    }
  }

  const companies = new Map<string, MeetingDirectoryCompany>()
  for (const person of people.values()) {
    const company = companyForEmail(person.email)
    if (!company) continue
    const existing = companies.get(company.domain)
    companies.set(company.domain, {
      domain: company.domain,
      name: company.name,
      people: (existing?.people || 0) + 1,
      meetings: 0,
      lastMetAt: Math.max(existing?.lastMetAt || 0, person.lastMetAt)
    })
  }
  // Recalculate unique meeting counts without encoding them in the public shape.
  const companyList = [...companies.values()].map((company) => ({
    ...company,
    meetings: new Set(
      [...people.values()]
        .filter((person) => companyForEmail(person.email)?.domain === company.domain)
        .flatMap((person) => person.meetingIds)
    ).size
  }))
  return {
    people: [...people.values()].sort((left, right) => right.lastMetAt - left.lastMetAt),
    companies: companyList.sort((left, right) => right.lastMetAt - left.lastMetAt)
  }
}
