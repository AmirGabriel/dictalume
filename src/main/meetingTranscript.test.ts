import { describe, expect, it } from 'vitest'
import type { MeetingRecord } from '../shared/types'
import {
  applyMeetingTranscriptRetention,
  buildMeetingsCsv,
  relevantMeetings,
  renderMeetingTranscript
} from './meetingTranscript'
import {
  buildMeetingDirectory,
  confirmedMeetingSpeakerName,
  meetingSpeakerEvidenceKey,
  meetingSpeakerName,
  speakerTagNameForInterval
} from '../shared/meeting'

describe('meeting speaker evidence', () => {
  it('uses audio routing as identity evidence without inventing a name', () => {
    expect(meetingSpeakerEvidenceKey('microphone', 'google-meet')).toBe('microphone:me')
    expect(meetingSpeakerEvidenceKey('system', 'google-meet')).toBe('system:others')
    expect(meetingSpeakerEvidenceKey('system', 'zoom', 'speaker-3')).toBe(
      'system:speaker-3'
    )
    expect(meetingSpeakerEvidenceKey('system', 'zoom', 'speaker-3', 'segment-2')).toBe(
      'system:segment-2:speaker-3'
    )
    expect(meetingSpeakerName('microphone:me', 0)).toBe('Me')
    expect(meetingSpeakerName('system:others', 0)).toBe('Others')
    expect(meetingSpeakerName('system:speaker-3', 0)).toBe('Speaker A')
  })

  it('does not call a single in-person microphone stream “Me”', () => {
    const evidence = meetingSpeakerEvidenceKey('microphone', 'conversation')
    expect(evidence).toBe('microphone:conversation')
    expect(meetingSpeakerName(evidence, 0)).toBe('Conversation')
  })

  it('accepts only an explicitly confirmed name for an exact evidence key', () => {
    const names = {
      'system:segment-2:speaker-3': '  Ana Silva  ',
      other: 'Another person'
    }
    expect(
      confirmedMeetingSpeakerName(names, 'system:segment-2:speaker-3')
    ).toBe('Ana Silva')
    expect(confirmedMeetingSpeakerName(names, 'system:segment-1:speaker-3')).toBeUndefined()
  })

  it('uses a display name only when the whole short interval is consistent', () => {
    const events = [1_000, 2_000, 3_000].map((capturedAt) => ({
      name: 'Ana Silva',
      capturedAt,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      source: 'google-meet' as const
    }))
    expect(speakerTagNameForInterval(events, 1_000, 3_000)).toBe('Ana Silva')
    expect(speakerTagNameForInterval(events, 1_000, 20_000)).toBeUndefined()
    expect(
      speakerTagNameForInterval(
        [
          events[0],
          { ...events[1], name: 'Bruno' },
          events[2]
        ],
        1_000,
        3_000
      )
    ).toBeUndefined()
  })

  it('renders authoritative labels with timestamps', () => {
    expect(
      renderMeetingTranscript(
        [{
          id: 'turn',
          speakerId: 'speaker',
          source: 'system',
          startMs: 65_000,
          endMs: 70_000,
          text: 'Ship on Friday.'
        }],
        [{ id: 'speaker', name: 'Speaker A', source: 'system' }]
      )
    ).toBe('[01:05] Speaker A: Ship on Friday.')
  })
})

describe('cross-meeting retrieval', () => {
  const meeting = (
    id: string,
    title: string,
    notes: string,
    createdAt: number
  ): MeetingRecord => ({
    id,
    title,
    notes,
    transcript: notes,
    source: 'other',
    createdAt,
    durationMs: 1,
    provider: 'openai'
  })

  it('prioritizes title and note matches before recent unrelated meetings', () => {
    const launch = meeting('launch', 'Launch review', 'Beta ships Friday.', 1)
    const unrelated = meeting('other', 'Hiring', 'Candidate loop.', 2)
    expect(relevantMeetings([unrelated, launch], 'What did we decide about launch?')[0].id)
      .toBe('launch')
  })
})

describe('meeting people directory', () => {
  it('derives people and companies from calendar attendees without generic speakers', () => {
    const item: MeetingRecord = {
      id: 'meeting',
      title: 'Customer call',
      source: 'google-meet',
      createdAt: 10,
      durationMs: 1,
      transcript: '',
      notes: '',
      provider: 'openai',
      attendees: [
        { name: 'Ana Silva', email: ['ana', 'acme.com'].join('@') },
        { name: 'Personal Guest', email: ['guest', 'gmail.com'].join('@') }
      ],
      speakers: [
        { id: 'me', name: 'Me', source: 'microphone' },
        { id: 'other', name: 'Speaker A', source: 'system' }
      ]
    }

    const directory = buildMeetingDirectory([item])
    expect(directory.people.map((person) => person.name)).toEqual([
      'Ana Silva',
      'Personal Guest'
    ])
    expect(directory.companies).toEqual([
      {
        domain: 'acme.com',
        name: 'Acme',
        people: 1,
        meetings: 1,
        lastMetAt: 10
      }
    ])
  })
})

describe('meeting transcript retention', () => {
  const day = 24 * 60 * 60 * 1000
  const item = (createdAt: number): MeetingRecord => ({
    id: `meeting-${createdAt}`,
    title: 'Planning',
    source: 'other',
    createdAt,
    durationMs: 60_000,
    transcript: 'A raw transcript.',
    transcriptTurns: [{
      id: 'turn',
      speakerId: 'speaker',
      source: 'microphone',
      startMs: 0,
      endMs: 1_000,
      text: 'A raw transcript.'
    }],
    notes: 'Keep these notes.',
    provider: 'openai'
  })

  it('removes only expired raw transcripts while preserving generated notes', () => {
    const now = 100 * day
    const expired = item(now - 31 * day)
    const current = item(now - 29 * day)
    const result = applyMeetingTranscriptRetention([expired, current], 30, now)

    expect(result.changed).toBe(true)
    expect(result.meetings[0]).toMatchObject({
      transcript: '',
      transcriptTurns: [],
      transcriptDeletedAt: now,
      notes: 'Keep these notes.'
    })
    expect(result.meetings[1]).toBe(current)
  })

  it('keeps raw transcripts indefinitely when retention is disabled', () => {
    const meetings = [item(1)]
    expect(applyMeetingTranscriptRetention(meetings, 0, 10 * day)).toEqual({
      meetings,
      changed: false
    })
  })

  it('starts the retention window again when an old meeting is resumed', () => {
    const now = 100 * day
    const resumed = {
      ...item(now - 100 * day),
      transcriptUpdatedAt: now - day
    }
    expect(applyMeetingTranscriptRetention([resumed], 7, now)).toEqual({
      meetings: [resumed],
      changed: false
    })
  })
})

describe('bulk meeting export', () => {
  it('creates Excel-friendly CSV and safely escapes multiline content', () => {
    const csv = buildMeetingsCsv([{
      id: 'one',
      title: 'Roadmap, “Q4”',
      source: 'zoom',
      createdAt: Date.UTC(2026, 6, 28),
      durationMs: 90_400,
      transcript: 'Ana said "ship".\nThen we agreed.',
      notes: 'Summary',
      provider: 'openai',
      attendees: [{ name: 'Ana', email: ['ana', 'example.com'].join('@') }]
    }])

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Roadmap, “Q4”"')
    expect(csv).toContain('"Ana said ""ship"".\nThen we agreed."')
    expect(csv).toContain('"Ana <ana@example.com>"')
  })
})
