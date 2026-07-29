import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bold,
  CalendarDays,
  Bot,
  Building2,
  Check,
  CircleStop,
  Copy,
  Download,
  FolderOpen,
  FolderTree,
  Headphones,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  LogOut,
  Mic,
  MonitorUp,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Radio,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  Users
} from 'lucide-react'
import type {
  AppSettings,
  CalendarAttendee,
  CalendarEvent,
  CalendarStatus,
  MeetingAudioSegment,
  MeetingAttachment,
  MeetingCaptureSupport,
  MeetingRecord,
  MeetingRequest,
  MeetingSegmentTranscription,
  MeetingSpace,
  MeetingTemplateId,
  MeetingTranscriptTurn,
  PreMeetingBrief,
  ProviderId,
  SpeakerTagEvent,
  SpeakerTagStatus
} from '../../shared/types'
import {
  buildMeetingDirectory,
  meetingSpeakerEvidenceKey,
  meetingSpeakerName,
  speakerTagNameForInterval
} from '../../shared/meeting'
import {
  descendantSpaceIds,
  meetingSpaceIds,
  normalizedSpaceTitle,
  spacePath
} from '../../shared/meetingSpaces'
import { composeMeetingDocument, parseMeetingNotes } from './meetingNotes'

type CaptureStatus =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'reviewing'
  | 'processing'
  | 'error'

function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(timestamp)
}

const supportedMeetingImageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
])

async function meetingAttachmentFromFile(file: File): Promise<MeetingAttachment> {
  if (!supportedMeetingImageTypes.has(file.type)) {
    throw new Error('Use a PNG, JPEG, WebP, or GIF image.')
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Each meeting image must be 5 MB or smaller.')
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('The image could not be read.'))
    reader.onerror = () => reject(new Error('The image could not be read.'))
    reader.readAsDataURL(file)
  })
  return {
    id: crypto.randomUUID(),
    name: file.name || 'Pasted image',
    mimeType: file.type as MeetingAttachment['mimeType'],
    dataUrl,
    createdAt: Date.now()
  }
}

function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    return part
  })
}

function MarkdownNote({ text }: { text: string }): React.JSX.Element {
  const blocks = text.split('\n')
  return (
    <div className="meeting-user-notes">
      {blocks.map((line, index) => {
        if (line.startsWith('### ')) {
          return <h4 key={index}>{inlineMarkdown(line.slice(4))}</h4>
        }
        if (/^[-*] /.test(line)) {
          return <p className="markdown-list-item" key={index}>• {inlineMarkdown(line.slice(2))}</p>
        }
        return line ? <p key={index}>{inlineMarkdown(line)}</p> : <br key={index} />
      })}
    </div>
  )
}

function MeetingAttachmentGallery({
  attachments,
  onRemove
}: {
  attachments: MeetingAttachment[]
  onRemove?: (id: string) => void
}): React.JSX.Element | null {
  if (attachments.length === 0) return null
  return (
    <div className="meeting-attachment-gallery">
      {attachments.map((attachment) => (
        <figure key={attachment.id}>
          <img src={attachment.dataUrl} alt={attachment.name} />
          <figcaption title={attachment.name}>{attachment.name}</figcaption>
          {onRemove && (
            <button
              aria-label={`Remove ${attachment.name}`}
              onClick={() => onRemove(attachment.id)}
            >
              ×
            </button>
          )}
        </figure>
      ))}
    </div>
  )
}

function MarkdownToolbar({
  textareaRef,
  value,
  onChange,
  onFiles
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  onFiles: (files: File[]) => void
}): React.JSX.Element {
  const insert = (prefix: string, suffix = '', linePrefix = false): void => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = value.slice(start, end)
    const before = value.slice(0, start)
    const after = value.slice(end)
    const needsLineBreak = linePrefix && before.length > 0 && !before.endsWith('\n')
    const insertion = `${needsLineBreak ? '\n' : ''}${prefix}${selected}${suffix}`
    onChange(`${before}${insertion}${after}`)
    window.requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + insertion.length - suffix.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  return (
    <div className="markdown-toolbar" aria-label="Note formatting">
      <button type="button" aria-label="Bold" onClick={() => insert('**', '**')}>
        <Bold size={13} />
      </button>
      <button type="button" aria-label="Italic" onClick={() => insert('_', '_')}>
        <Italic size={13} />
      </button>
      <button type="button" aria-label="Heading" onClick={() => insert('### ', '', true)}>
        <Heading3 size={13} />
      </button>
      <button type="button" aria-label="Bullet list" onClick={() => insert('- ', '', true)}>
        <List size={13} />
      </button>
      <label title="Attach image">
        <ImagePlus size={13} />
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={(event) => {
            onFiles(Array.from(event.target.files || []))
            event.target.value = ''
          }}
        />
      </label>
    </div>
  )
}

export function shouldAutoStopMeeting(
  now: number,
  lastSpeechAt: number,
  scheduledEndAt = 0
): boolean {
  const silentFor = Math.max(0, now - lastSpeechAt)
  if (silentFor >= 15 * 60 * 1000) return true
  return Boolean(
    scheduledEndAt > 0 &&
    now >= scheduledEndAt &&
    silentFor >= 2 * 60 * 1000
  )
}

export function scheduledMeetingDelay(
  event: CalendarEvent,
  now: number
): number | null {
  if (event.startsAt <= now || event.endsAt <= now) return null
  return Math.max(0, event.startsAt - now)
}

interface LiveMeetingTurn {
  id: string
  source: MeetingAudioSegment['source']
  speakerName: string
  startMs: number
  endMs: number
  text: string
}

export function buildLiveMeetingTurns(
  transcriptions: MeetingSegmentTranscription[],
  meetingSource: MeetingRequest['source']
): LiveMeetingTurn[] {
  const nameByEvidence = new Map<string, string>()
  let anonymousIndex = 0
  return transcriptions
    .flatMap((transcription) =>
      transcription.chunks.map((chunk, index) => {
        const evidence = meetingSpeakerEvidenceKey(
          transcription.source,
          meetingSource,
          chunk.diarizationLabel,
          transcription.segmentId
        )
        let speakerName = nameByEvidence.get(evidence)
        if (!speakerName) {
          speakerName = meetingSpeakerName(evidence, anonymousIndex)
          nameByEvidence.set(evidence, speakerName)
          if (
            evidence !== 'microphone:me' &&
            evidence !== 'system:others' &&
            evidence !== 'microphone:conversation'
          ) {
            anonymousIndex += 1
          }
        }
        return {
          id: `${transcription.segmentId}:${index}`,
          source: transcription.source,
          speakerName,
          startMs: transcription.startedAtMs + chunk.startMs,
          endMs: transcription.startedAtMs + chunk.endMs,
          text: chunk.text
        }
      })
    )
    .sort((left, right) => left.startMs - right.startMs)
}

export interface LiveSpeakerEvidence {
  key: string
  suggestedName: string
  source: MeetingAudioSegment['source']
  diarizationLabel?: string
  turnCount: number
}

export function buildLiveSpeakerEvidence(
  transcriptions: MeetingSegmentTranscription[],
  meetingSource: MeetingRequest['source']
): LiveSpeakerEvidence[] {
  const evidence = new Map<string, LiveSpeakerEvidence>()
  let anonymousIndex = 0
  for (const transcription of [...transcriptions].sort(
    (left, right) => left.startedAtMs - right.startedAtMs
  )) {
    for (const chunk of transcription.chunks) {
      const key = meetingSpeakerEvidenceKey(
        transcription.source,
        meetingSource,
        chunk.diarizationLabel,
        transcription.segmentId
      )
      const existing = evidence.get(key)
      if (existing) {
        existing.turnCount += 1
        continue
      }
      const suggestedName = meetingSpeakerName(key, anonymousIndex)
      if (
        key !== 'microphone:me' &&
        key !== 'system:others' &&
        key !== 'microphone:conversation'
      ) {
        anonymousIndex += 1
      }
      evidence.set(key, {
        key,
        suggestedName,
        source: transcription.source,
        ...(chunk.diarizationLabel
          ? { diarizationLabel: chunk.diarizationLabel }
          : {}),
        turnCount: 1
      })
    }
  }
  return [...evidence.values()]
}

export function speakerNamesFromTags(
  transcriptions: MeetingSegmentTranscription[],
  meetingSource: MeetingRequest['source'],
  meetingStartedAt: number,
  events: SpeakerTagEvent[]
): Record<string, string> {
  if (meetingSource !== 'google-meet' && meetingSource !== 'zoom') return {}
  const names: Record<string, string> = {}
  const matchingEvents = events.filter((event) => event.source === meetingSource)
  for (const transcription of transcriptions) {
    if (transcription.source !== 'system') continue
    for (const chunk of transcription.chunks) {
      const chunkStartedAt =
        meetingStartedAt + transcription.startedAtMs + chunk.startMs
      const chunkEndedAt =
        meetingStartedAt + transcription.startedAtMs + chunk.endMs
      const name = speakerTagNameForInterval(
        matchingEvents,
        chunkStartedAt,
        chunkEndedAt
      )
      if (!name) continue
      const key = meetingSpeakerEvidenceKey(
        transcription.source,
        meetingSource,
        chunk.diarizationLabel,
        transcription.segmentId
      )
      names[key] = name
    }
  }
  return names
}

function MeetingTranscriptView({
  meeting,
  onUpdate
}: {
  meeting: MeetingRecord
  onUpdate: (meeting: MeetingRecord) => void
}): React.JSX.Element {
  const speakers = meeting.speakers || []
  const turns = meeting.transcriptTurns || []
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, string>>(
    Object.fromEntries(speakers.map((speaker) => [speaker.id, speaker.name]))
  )
  const [turnSpeakerDrafts, setTurnSpeakerDrafts] = useState<Record<string, string>>(
    Object.fromEntries(turns.map((turn) => [turn.id, turn.speakerId]))
  )
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingAssignments, setSavingAssignments] = useState(false)
  const [error, setError] = useState('')
  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker]))
  const visibleTurns = turns.filter((turn) =>
    `${speakerById.get(turn.speakerId)?.name || ''} ${turn.text}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  )

  useEffect(() => {
    setSpeakerDrafts(Object.fromEntries(speakers.map((speaker) => [speaker.id, speaker.name])))
    setTurnSpeakerDrafts(
      Object.fromEntries(turns.map((turn) => [turn.id, turn.speakerId]))
    )
  }, [meeting.id, meeting.updatedAt])
  const changedAssignments = turns.filter(
    (turn) => (turnSpeakerDrafts[turn.id] || turn.speakerId) !== turn.speakerId
  ).length

  const saveSpeakers = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const updated = await window.desktop.updateMeeting({
        meetingId: meeting.id,
        speakers: speakers.map((speaker) => ({
          ...speaker,
          name: speakerDrafts[speaker.id] || speaker.name
        })),
        regenerateNotes: true
      })
      onUpdate(updated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save speaker names.')
    } finally {
      setSaving(false)
    }
  }

  const saveAssignments = async (): Promise<void> => {
    setSavingAssignments(true)
    setError('')
    try {
      const updated = await window.desktop.updateMeeting({
        meetingId: meeting.id,
        transcriptTurns: turns.map((turn) => ({
          ...turn,
          speakerId: turnSpeakerDrafts[turn.id] || turn.speakerId
        })),
        regenerateNotes: true
      })
      onUpdate(updated)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save speaker assignments.'
      )
    } finally {
      setSavingAssignments(false)
    }
  }

  if (turns.length === 0) {
    if (meeting.transcriptDeletedAt) {
      return (
        <div className="transcript-retention-notice">
          <Trash2 size={14} />
          <div>
            <strong>Transcript removed</strong>
            <span>
              Dictalume deleted the raw transcript according to your retention setting.
              The meeting notes were preserved.
            </span>
          </div>
        </div>
      )
    }
    return <p className="legacy-meeting-transcript">{meeting.transcript}</p>
  }

  return (
    <div className="speaker-transcript">
      <div className="meeting-participants">
        <div className="meeting-participants-heading">
          <div>
            <strong><UserRound size={15} /> Speakers</strong>
            <small>
              Names are never guessed. Rename a verified speaker
              {(meeting.attendees?.length || 0) > 0 ? ' or choose a calendar attendee.' : '.'}
            </small>
          </div>
          <button
            className="secondary-button compact"
            disabled={saving}
            onClick={() => void saveSpeakers()}
          >
            <Save size={14} /> {saving ? 'Saving…' : 'Save names'}
          </button>
        </div>
        <div className="speaker-name-grid">
          {speakers.map((speaker) => (
            <label key={speaker.id}>
              <span>
                {speaker.source === 'microphone' ? 'Microphone' : 'Computer audio'}
                {speaker.diarizationLabel ? ` · ${speaker.diarizationLabel}` : ''}
              </span>
              <input
                value={speakerDrafts[speaker.id] ?? speaker.name}
                list={`attendees-${meeting.id}`}
                onChange={(event) =>
                  setSpeakerDrafts((current) => ({
                    ...current,
                    [speaker.id]: event.target.value
                  }))
                }
              />
            </label>
          ))}
          <datalist id={`attendees-${meeting.id}`}>
            {(meeting.attendees || []).map((attendee) => (
              <option
                value={attendee.name}
                key={`${attendee.email || ''}:${attendee.name}`}
              />
            ))}
          </datalist>
        </div>
        {error && <p className="meeting-chat-error" role="alert">{error}</p>}
      </div>
      <div className="transcript-toolbar">
        <label>
          <Search size={14} />
          <input
            value={search}
            placeholder="Search transcript"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="icon-text-button"
          onClick={() => void window.desktop.copyText(meeting.transcript)}
        >
          <Copy size={14} /> Copy all
        </button>
        {changedAssignments > 0 && (
          <button
            className="secondary-button compact"
            disabled={savingAssignments}
            onClick={() => void saveAssignments()}
          >
            <Save size={13} />{' '}
            {savingAssignments
              ? 'Saving…'
              : `Save ${changedAssignments} assignment${
                  changedAssignments === 1 ? '' : 's'
                }`}
          </button>
        )}
      </div>
      <div className="transcript-turns">
        {visibleTurns.map((turn) => {
          const speaker = speakerById.get(turn.speakerId)
          const ownVoice = speaker?.name === 'Me' || (
            turn.source === 'microphone' && meeting.source !== 'conversation'
          )
          return (
            <article
              className={`transcript-turn ${ownVoice ? 'is-own-voice' : ''}`}
              key={turn.id}
            >
              <div className="transcript-turn-meta">
                <select
                  value={turnSpeakerDrafts[turn.id] || turn.speakerId}
                  aria-label={`Speaker at ${formatDuration(turn.startMs)}`}
                  onChange={(event) =>
                    setTurnSpeakerDrafts((current) => ({
                      ...current,
                      [turn.id]: event.target.value
                    }))
                  }
                >
                  {speakers.map((candidate) => (
                    <option value={candidate.id} key={candidate.id}>
                      {speakerDrafts[candidate.id] || candidate.name}
                      {' · '}
                      {candidate.source === 'microphone' ? 'mic' : 'computer'}
                    </option>
                  ))}
                </select>
                <span>{formatDuration(turn.startMs)}</span>
                <span>{turn.source === 'microphone' ? 'Microphone' : 'Computer audio'}</span>
              </div>
              <p>{turn.text}</p>
              <div className="transcript-turn-actions">
                <button
                  aria-label="Copy transcript chunk"
                  onClick={() => void window.desktop.copyText(turn.text)}
                >
                  <Copy size={13} />
                </button>
                <button
                  aria-label="Delete transcript chunk"
                  onClick={async () => {
                    const updated = await window.desktop.updateMeeting({
                      meetingId: meeting.id,
                      transcriptTurns: turns.filter((item) => item.id !== turn.id),
                      regenerateNotes: true
                    })
                    onUpdate(updated)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function NoteList({
  title,
  icon,
  items,
  meeting
}: {
  title: string
  icon: ReactNode
  items: string[]
  meeting: MeetingRecord
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <section className="meeting-note-section">
      <h3>{icon} {title}</h3>
      <ul className="meeting-summary-list">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <div className="meeting-note-content">
              <span>{item}</span>
              <MeetingNoteEvidenceButton meeting={meeting} noteText={item} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MeetingNoteEvidenceButton({
  meeting,
  noteText
}: {
  meeting: MeetingRecord
  noteText: string
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const evidence = meeting.noteEvidence?.find((item) => item.noteText === noteText)
  if (!evidence || evidence.turnIds.length === 0) return null
  const turnsById = new Map(
    (meeting.transcriptTurns || []).map((turn) => [turn.id, turn])
  )
  const speakersById = new Map(
    (meeting.speakers || []).map((speaker) => [speaker.id, speaker])
  )
  const turns = evidence.turnIds
    .map((id) => turnsById.get(id))
    .filter((turn): turn is MeetingTranscriptTurn => Boolean(turn))
  if (turns.length === 0) return null

  return (
    <>
      <button
        className="meeting-note-evidence-button"
        aria-label={open ? `Hide source for: ${noteText}` : `Show source for: ${noteText}`}
        aria-expanded={open}
        title="Show source in transcript"
        onClick={() => setOpen((value) => !value)}
      >
        <Search size={12} />
      </button>
      {open && (
        <div className="meeting-note-evidence" role="note">
          <strong>Source in transcript</strong>
          {turns.map((turn) => (
            <blockquote key={turn.id}>
              <span>{speakersById.get(turn.speakerId)?.name || 'Unknown speaker'}</span>
              {turn.text}
            </blockquote>
          ))}
        </div>
      )}
    </>
  )
}

function MeetingDocumentHeader({
  meeting,
  onUpdate
}: {
  meeting: MeetingRecord
  onUpdate: (meeting: MeetingRecord) => void
}): React.JSX.Element {
  const [titleDraft, setTitleDraft] = useState(meeting.title)
  const [saving, setSaving] = useState(false)

  useEffect(() => setTitleDraft(meeting.title), [meeting.id, meeting.title])

  const saveTitle = async (): Promise<void> => {
    const title = titleDraft.trim()
    if (!title || title === meeting.title || saving) {
      if (!title) setTitleDraft(meeting.title)
      return
    }
    setSaving(true)
    try {
      onUpdate(await window.desktop.updateMeeting({ meetingId: meeting.id, title }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <header className="meeting-document-header">
      <div className="meeting-document-icon" aria-hidden="true">
        <Mic size={21} />
      </div>
      <input
        className="meeting-document-title"
        aria-label="Meeting title"
        value={titleDraft}
        disabled={saving}
        onChange={(event) => setTitleDraft(event.target.value)}
        onBlur={() => void saveTitle()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setTitleDraft(meeting.title)
            event.currentTarget.blur()
          }
        }}
      />
      <div className="meeting-document-properties">
        <span><CalendarDays size={13} /> {formatDate(meeting.createdAt)}</span>
        <span><Mic size={13} /> {formatDuration(meeting.durationMs)}</span>
        <span className="meeting-document-source">{meeting.source.replace('-', ' ')}</span>
      </div>
    </header>
  )
}

function MeetingNotesView({
  meeting,
  onUpdate
}: {
  meeting: MeetingRecord
  onUpdate: (meeting: MeetingRecord) => void
}): React.JSX.Element {
  const sections = parseMeetingNotes(meeting.notes)
  const [editing, setEditing] = useState(false)
  const [notesDraft, setNotesDraft] = useState(meeting.notes)
  const [userNotesDraft, setUserNotesDraft] = useState(meeting.userNotes || '')
  const [attachmentsDraft, setAttachmentsDraft] = useState(meeting.attachments || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const userNotesRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setNotesDraft(meeting.notes)
    setUserNotesDraft(meeting.userNotes || '')
    setAttachmentsDraft(meeting.attachments || [])
  }, [meeting.id, meeting.updatedAt])

  const addFiles = async (files: File[]): Promise<void> => {
    try {
      const added = await Promise.all(files.map(meetingAttachmentFromFile))
      setAttachmentsDraft((items) => [...items, ...added].slice(0, 20))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The image could not be attached.')
    }
  }

  if (editing) {
    return (
      <div className="meeting-notes-editor">
        <div className="meeting-notes-editor-heading">
          <div>
            <strong>Edit meeting notes</strong>
            <small>
              Markdown headings keep Summary, Decisions and To-do list structured.
              Saving here does not call an AI.
            </small>
          </div>
          <div>
            <button
              className="icon-text-button"
              disabled={saving}
              onClick={() => {
                setNotesDraft(meeting.notes)
                setUserNotesDraft(meeting.userNotes || '')
                setAttachmentsDraft(meeting.attachments || [])
                setEditing(false)
                setError('')
              }}
            >
              Cancel
            </button>
            <button
              className="primary-button compact"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                setError('')
                try {
                  const updated = await window.desktop.updateMeeting({
                    meetingId: meeting.id,
                    notes: notesDraft,
                    userNotes: userNotesDraft,
                    attachments: attachmentsDraft
                  })
                  onUpdate(updated)
                  setEditing(false)
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : 'Could not save meeting notes.'
                  )
                } finally {
                  setSaving(false)
                }
              }}
            >
              <Save size={13} /> {saving ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </div>
        <label>
          Generated notes
          <textarea
            rows={16}
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
          />
        </label>
        <label>
          Your notes
          <MarkdownToolbar
            textareaRef={userNotesRef}
            value={userNotesDraft}
            onChange={setUserNotesDraft}
            onFiles={(files) => void addFiles(files)}
          />
          <textarea
            ref={userNotesRef}
            rows={5}
            value={userNotesDraft}
            placeholder="Add private context or reminders…"
            onChange={(event) => setUserNotesDraft(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files).filter((file) =>
                file.type.startsWith('image/')
              )
              if (files.length > 0) {
                event.preventDefault()
                void addFiles(files)
              }
            }}
          />
        </label>
        <MeetingAttachmentGallery
          attachments={attachmentsDraft}
          onRemove={(id) =>
            setAttachmentsDraft((items) => items.filter((item) => item.id !== id))
          }
        />
        {error && <p className="meeting-chat-error" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className="meeting-document">
      <div className="meeting-document-toolbar">
        <span>Meeting notes</span>
        <button className="icon-text-button" onClick={() => setEditing(true)}>
          <Pencil size={13} /> Edit
        </button>
      </div>
      <NoteList
        title="Summary"
        icon={<Sparkles size={15} />}
        items={sections.summary}
        meeting={meeting}
      />
      {sections.todos.length > 0 && (
        <section className="meeting-note-section">
          <h3><Check size={15} /> To-do list</h3>
          <ul className="meeting-todo-list">
            {sections.todos.map((item, index) => (
              <li
                className={(meeting.completedTodos || []).includes(item) ? 'is-complete' : ''}
                key={`${item}-${index}`}
              >
                <button
                  className="meeting-checkbox"
                  aria-label={
                    (meeting.completedTodos || []).includes(item)
                      ? `Mark incomplete: ${item}`
                      : `Mark complete: ${item}`
                  }
                  onClick={async () => {
                    const completed = new Set(meeting.completedTodos || [])
                    if (completed.has(item)) completed.delete(item)
                    else completed.add(item)
                    onUpdate(
                      await window.desktop.updateMeeting({
                        meetingId: meeting.id,
                        completedTodos: [...completed]
                      })
                    )
                  }}
                >
                  {(meeting.completedTodos || []).includes(item) && <Check size={10} />}
                </button>
                <div className="meeting-note-content">
                  <span>{item}</span>
                  <MeetingNoteEvidenceButton meeting={meeting} noteText={item} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <NoteList
        title="Key points"
        icon={<Radio size={15} />}
        items={sections.keyPoints}
        meeting={meeting}
      />
      <NoteList
        title="Decisions"
        icon={<Check size={15} />}
        items={sections.decisions}
        meeting={meeting}
      />
      <NoteList
        title="Open questions"
        icon={<Users size={15} />}
        items={sections.openQuestions}
        meeting={meeting}
      />
      {(meeting.userNotes?.trim() || (meeting.attachments || []).length > 0) && (
        <section className="meeting-note-section">
          <h3><UserRound size={15} /> Your notes</h3>
          {meeting.userNotes?.trim() && <MarkdownNote text={meeting.userNotes} />}
          <MeetingAttachmentGallery attachments={meeting.attachments || []} />
        </section>
      )}
      <section className="meeting-note-section meeting-transcript-section">
        <h3><Mic size={15} /> Full transcript</h3>
        <MeetingTranscriptView meeting={meeting} onUpdate={onUpdate} />
      </section>
    </div>
  )
}

function MeetingOrganizationBar({
  meeting,
  spaces,
  onUpdate,
  onResume,
  resumeDisabled
}: {
  meeting: MeetingRecord
  spaces: MeetingSpace[]
  onUpdate: (meeting: MeetingRecord) => void
  onResume: () => void
  resumeDisabled: boolean
}): React.JSX.Element {
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>(
    meetingSpaceIds(meeting, spaces)
  )
  const [saving, setSaving] = useState(false)

  useEffect(
    () => setSelectedSpaceIds(meetingSpaceIds(meeting, spaces)),
    [meeting.id, meeting.space, meeting.spaceIds, spaces]
  )
  const savedSpaceIds = meetingSpaceIds(meeting, spaces)
  const changed =
    [...selectedSpaceIds].sort().join('|') !== [...savedSpaceIds].sort().join('|')

  return (
    <div className="meeting-organization-bar">
      <details className="meeting-space-picker">
        <summary>
          <FolderOpen size={14} />
          {selectedSpaceIds.length > 0
            ? `${selectedSpaceIds.length} space${selectedSpaceIds.length === 1 ? '' : 's'}`
            : 'Add to spaces'}
        </summary>
        <div className="meeting-space-options">
          {spaces.length === 0 ? (
            <small>Create a Space below first.</small>
          ) : spaces.map((space) => (
            <label key={space.id}>
              <input
                type="checkbox"
                checked={selectedSpaceIds.includes(space.id)}
                onChange={(event) =>
                  setSelectedSpaceIds((ids) =>
                    event.target.checked
                      ? [...ids, space.id]
                      : ids.filter((id) => id !== space.id)
                  )
                }
              />
              <span>{space.icon}</span>
              {spacePath(space, spaces)}
            </label>
          ))}
        </div>
      </details>
      <button
        className="secondary-button compact"
        disabled={saving || !changed}
        onClick={async () => {
          setSaving(true)
          try {
            onUpdate(
              await window.desktop.updateMeeting({
                meetingId: meeting.id,
                spaceIds: selectedSpaceIds
              })
            )
          } finally {
            setSaving(false)
          }
        }}
      >
        {saving ? 'Saving…' : 'Save spaces'}
      </button>
      <span className="meeting-organization-divider" />
      <button className="icon-text-button" disabled={resumeDisabled} onClick={onResume}>
        <Play size={13} /> Resume
      </button>
      <button
        className="icon-text-button"
        onClick={() =>
          void window.desktop.exportMeeting({ meetingId: meeting.id, format: 'markdown' })
        }
      >
        <Download size={13} /> Markdown
      </button>
      <button
        className="icon-text-button"
        onClick={() =>
          void window.desktop.exportMeeting({ meetingId: meeting.id, format: 'json' })
        }
      >
        <Download size={13} /> JSON
      </button>
    </div>
  )
}

function MeetingChat({
  meeting,
  settings,
  onUpdate
}: {
  meeting: MeetingRecord
  settings: AppSettings | null
  onUpdate: (meeting: MeetingRecord) => void
}): React.JSX.Element {
  const defaultProvider =
    settings?.cleanupProvider === 'same'
      ? settings.provider
      : settings?.cleanupProvider || 'grok'
  const [provider, setProvider] = useState<Exclude<ProviderId, 'deepgram'>>(
    defaultProvider === 'deepgram' ? 'grok' : defaultProvider
  )
  const [question, setQuestion] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const chat = meeting.chat || []
  const providers = settings
    ? (Object.keys(settings.providers) as ProviderId[]).filter(
        (id): id is Exclude<ProviderId, 'deepgram'> => id !== 'deepgram'
      )
    : []

  useEffect(() => {
    if (!settings) return
    const current = settings.providers[provider]
    if (current.apiKey || current.baseUrl.includes('localhost')) return
    const configured = providers.find((id) => {
      const candidate = settings.providers[id]
      return Boolean(candidate.apiKey || candidate.baseUrl.includes('localhost'))
    })
    if (configured) setProvider(configured)
  }, [provider, providers, settings])

  const ask = async (prompt = question): Promise<void> => {
    if (!prompt.trim() || working) return
    setWorking(true)
    setError('')
    try {
      const updated = await window.desktop.askMeeting({
        meetingId: meeting.id,
        question: prompt,
        provider
      })
      setQuestion('')
      onUpdate(updated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not answer this question.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="meeting-chat" aria-label={`Chat about ${meeting.title}`}>
      <div className="meeting-chat-heading">
        <div>
          <h3><Bot size={15} /> Ask about this meeting</h3>
          <p>Answers use this meeting’s notes and full transcript.</p>
        </div>
        <label>
          <span className="sr-only">AI provider</span>
          <select
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value as Exclude<ProviderId, 'deepgram'>)
            }
          >
            {providers.map((id) => {
              const item = settings?.providers[id]
              const configured = Boolean(item?.apiKey || item?.baseUrl.includes('localhost'))
              return (
                <option key={id} value={id} disabled={!configured}>
                  {item?.name}{configured ? '' : ' · add key'}
                </option>
              )
            })}
          </select>
        </label>
      </div>
      {chat.length > 0 && (
        <div className="meeting-chat-messages" aria-live="polite">
          {chat.map((message) => (
            <div
              className={`meeting-chat-message meeting-chat-${message.role}`}
              key={message.id}
            >
              <span>{message.role === 'user' ? 'You' : settings?.providers[message.provider || provider]?.name || 'AI'}</span>
              <p>{message.content}</p>
            </div>
          ))}
        </div>
      )}
      <div className="meeting-chat-composer">
        <textarea
          rows={2}
          value={question}
          placeholder="What was decided about…"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void ask()
            }
          }}
        />
        <button
          className="primary-button compact"
          disabled={working || !question.trim()}
          onClick={() => void ask()}
        >
          <Send size={14} /> {working ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      <div className="meeting-chat-recipes" aria-label="Meeting AI shortcuts">
        {(settings?.meetingRecipes || []).map((recipe) => (
          <button key={recipe.id} onClick={() => void ask(recipe.prompt)}>
            {recipe.name}
          </button>
        ))}
      </div>
      {error && <p className="meeting-chat-error" role="alert">{error}</p>}
    </section>
  )
}

function MeetingLibraryChat({
  meetings,
  settings
}: {
  meetings: MeetingRecord[]
  settings: AppSettings | null
}): React.JSX.Element | null {
  const configuredProviders = settings
    ? (Object.keys(settings.providers) as ProviderId[]).filter(
        (id): id is Exclude<ProviderId, 'deepgram'> =>
          id !== 'deepgram' &&
          Boolean(
            settings.providers[id].apiKey ||
            settings.providers[id].baseUrl.includes('localhost')
          )
      )
    : []
  const defaultProvider =
    settings?.cleanupProvider === 'same'
      ? settings.provider
      : settings?.cleanupProvider || 'grok'
  const [provider, setProvider] = useState<Exclude<ProviderId, 'deepgram'>>(
    defaultProvider === 'deepgram' ? 'grok' : defaultProvider
  )
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (configuredProviders.length > 0 && !configuredProviders.includes(provider)) {
      setProvider(configuredProviders[0])
    }
  }, [configuredProviders, provider])

  if (meetings.length < 2) return null

  const ask = async (): Promise<void> => {
    if (!question.trim() || working) return
    setWorking(true)
    setError('')
    try {
      const result = await window.desktop.askMeetings({ question, provider })
      setAnswer(result.answer)
      setSources(result.meetingTitles)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not search your meetings.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="meeting-library-chat">
      <div className="meeting-library-chat-heading">
        <div>
          <span className="row-icon"><Bot size={16} /></span>
          <div>
            <strong>Ask across meetings</strong>
            <small>Compare decisions, themes, and follow-ups from your meeting history.</small>
          </div>
        </div>
        <select
          aria-label="AI provider for meeting search"
          value={provider}
          onChange={(event) =>
            setProvider(event.target.value as Exclude<ProviderId, 'deepgram'>)
          }
        >
          {configuredProviders.map((id) => (
            <option key={id} value={id}>{settings?.providers[id].name}</option>
          ))}
        </select>
      </div>
      <div className="meeting-library-composer">
        <input
          value={question}
          placeholder="What did we decide about the launch across recent meetings?"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void ask()
          }}
        />
        <button
          className="primary-button compact"
          disabled={working || !question.trim() || configuredProviders.length === 0}
          onClick={() => void ask()}
        >
          <Sparkles size={14} /> {working ? 'Searching…' : 'Ask'}
        </button>
      </div>
      {answer && (
        <div className="meeting-library-answer">
          <p>{answer}</p>
          <small>Used: {sources.join(' · ')}</small>
        </div>
      )}
      {error && <p className="meeting-chat-error" role="alert">{error}</p>}
    </section>
  )
}

function MeetingCustomization({
  settings,
  onSettings,
  speakerTagStatus
}: {
  settings: AppSettings | null
  onSettings: (settings: AppSettings) => void
  speakerTagStatus: SpeakerTagStatus | null
}): React.JSX.Element | null {
  const [templateName, setTemplateName] = useState('')
  const [templateGuidance, setTemplateGuidance] = useState('')
  const [recipeName, setRecipeName] = useState('')
  const [recipePrompt, setRecipePrompt] = useState('')
  const [consentMessageDraft, setConsentMessageDraft] = useState(
    settings?.meetingConsentMessage || ''
  )
  const [saving, setSaving] = useState(false)
  useEffect(
    () => setConsentMessageDraft(settings?.meetingConsentMessage || ''),
    [settings?.meetingConsentMessage]
  )
  if (!settings) return null

  const save = async (next: AppSettings): Promise<void> => {
    setSaving(true)
    try {
      onSettings(await window.desktop.saveSettings(next))
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="meeting-customization">
      <summary>
        <Sparkles size={14} />
        Templates, recipes & privacy
        <span>{settings.meetingTemplates.length + settings.meetingRecipes.length}</span>
      </summary>
      <div className="meeting-customization-body">
        <section>
          <div>
            <strong>Note templates</strong>
            <small>Tell the notes model what to emphasize.</small>
          </div>
          <div className="customization-tags">
            {settings.meetingTemplates.map((template) => (
              <span key={template.id}>
                {template.name}
                {!template.builtIn && (
                  <button
                    aria-label={`Delete ${template.name} template`}
                    onClick={() =>
                      void save({
                        ...settings,
                        meetingTemplates: settings.meetingTemplates.filter(
                          (item) => item.id !== template.id
                        )
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          <input
            value={templateName}
            placeholder="Template name"
            onChange={(event) => setTemplateName(event.target.value)}
          />
          <textarea
            rows={3}
            value={templateGuidance}
            placeholder="What should the notes prioritize?"
            onChange={(event) => setTemplateGuidance(event.target.value)}
          />
          <button
            className="secondary-button compact"
            disabled={saving || !templateName.trim() || !templateGuidance.trim()}
            onClick={async () => {
              await save({
                ...settings,
                meetingTemplates: [
                  ...settings.meetingTemplates,
                  {
                    id: `custom-${crypto.randomUUID()}`,
                    name: templateName.trim().slice(0, 60),
                    guidance: templateGuidance.trim().slice(0, 2_000)
                  }
                ]
              })
              setTemplateName('')
              setTemplateGuidance('')
            }}
          >
            <Plus size={13} /> Add template
          </button>
        </section>
        <section>
          <div>
            <strong>Saved recipes</strong>
            <small>Reusable prompts appear under every meeting chat.</small>
          </div>
          <div className="customization-tags">
            {settings.meetingRecipes.map((recipe) => (
              <span key={recipe.id}>
                {recipe.name}
                {!recipe.builtIn && (
                  <button
                    aria-label={`Delete ${recipe.name} recipe`}
                    onClick={() =>
                      void save({
                        ...settings,
                        meetingRecipes: settings.meetingRecipes.filter(
                          (item) => item.id !== recipe.id
                        )
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          <input
            value={recipeName}
            placeholder="Recipe name"
            onChange={(event) => setRecipeName(event.target.value)}
          />
          <textarea
            rows={3}
            value={recipePrompt}
            placeholder="What should AI produce from the meeting?"
            onChange={(event) => setRecipePrompt(event.target.value)}
          />
          <button
            className="secondary-button compact"
            disabled={saving || !recipeName.trim() || !recipePrompt.trim()}
            onClick={async () => {
              await save({
                ...settings,
                meetingRecipes: [
                  ...settings.meetingRecipes,
                  {
                    id: `custom-${crypto.randomUUID()}`,
                    name: recipeName.trim().slice(0, 60),
                    prompt: recipePrompt.trim().slice(0, 2_000)
                  }
                ]
              })
              setRecipeName('')
              setRecipePrompt('')
            }}
          >
            <Plus size={13} /> Add recipe
          </button>
        </section>
        <section className="meeting-retention-setting">
          <div>
            <strong>Raw transcript retention</strong>
            <small>
              Keep generated notes, while automatically removing older raw transcripts
              from this device and your shared context folder.
            </small>
          </div>
          <label>
            Delete raw transcripts
            <select
              value={settings.meetingTranscriptRetentionDays}
              disabled={saving}
              onChange={(event) =>
                void save({
                  ...settings,
                  meetingTranscriptRetentionDays: Number(
                    event.target.value
                  ) as AppSettings['meetingTranscriptRetentionDays']
                })
              }
            >
              <option value={0}>Never</option>
              <option value={7}>After 7 days</option>
              <option value={30}>After 30 days</option>
              <option value={90}>After 90 days</option>
            </select>
          </label>
          <small>
            This is irreversible after the next sync. Summaries, decisions and action
            items remain available.
          </small>
        </section>
        <section className="meeting-provider-setting">
          <div>
            <strong>Meeting transcription provider</strong>
            <small>
              Choose the speech model separately from the AI that writes your notes.
            </small>
          </div>
          <label>
            Transcribe meetings with
            <select
              value={settings.meetingTranscriptionProvider}
              disabled={saving}
              onChange={(event) =>
                void save({
                  ...settings,
                  meetingTranscriptionProvider:
                    event.target.value as AppSettings['meetingTranscriptionProvider']
                })
              }
            >
              <option value="same">Same as dictation</option>
              {(Object.keys(settings.providers) as ProviderId[]).map((id) => (
                <option value={id} key={id}>{settings.providers[id].name}</option>
              ))}
            </select>
          </label>
          <small>
            Deepgram is recommended when speaker separation matters. Participant names
            still require calendar evidence or your confirmation.
          </small>
        </section>
        <section className="meeting-speaker-tags-setting">
          <div>
            <strong>Speaker tags</strong>
            <small>
              Uses participant names and active-speaker signals shown by the meeting app.
              No audio, video, captions, or chat are read.
            </small>
          </div>
          <div className="speaker-tag-status-row">
            <span className={speakerTagStatus?.connected ? 'is-connected' : ''}>
              Google Meet ·{' '}
              {speakerTagStatus?.connected ? 'Connected' : 'Not connected'}
            </span>
            <button
              className="secondary-button compact"
              onClick={() => void window.desktop.openSpeakerTagExtensionFolder()}
            >
              <FolderOpen size={13} /> Show extension folder
            </button>
          </div>
          <small>
            In your Chromium browser, open chrome://extensions, enable Developer mode,
            choose Load unpacked, and select the folder. The bridge stays on this computer.
          </small>
          <div className="speaker-tag-status-row">
            <span className={speakerTagStatus?.zoomSupported ? 'is-connected' : ''}>
              Zoom ·{' '}
              {speakerTagStatus?.zoomSupported
                ? 'Available on this Mac'
                : 'Requires macOS'}
            </span>
          </div>
          <small>
            Zoom tags use macOS Accessibility only while a Zoom meeting is actively
            recording. Your own microphone remains labelled Me.
            {speakerTagStatus?.lastSpeaker
              ? ` Last ${speakerTagStatus.lastSource === 'zoom' ? 'Zoom' : 'Meet'} signal: ${
                  speakerTagStatus.lastSpeaker
                }.`
              : ''}
          </small>
          {speakerTagStatus?.error && (
            <p className="meeting-chat-error">{speakerTagStatus.error}</p>
          )}
        </section>
        <section className="meeting-consent-setting">
          <div>
            <strong>Automatic Zoom consent message</strong>
            <small>
              Optional. Sends once after another participant starts speaking.
            </small>
          </div>
          <label className="meeting-consent-toggle">
            <input
              type="checkbox"
              checked={settings.meetingConsentMessageEnabled}
              disabled={saving || !speakerTagStatus?.zoomSupported}
              onChange={(event) =>
                void save({
                  ...settings,
                  meetingConsentMessageEnabled: event.target.checked
                })
              }
            />
            Post a disclosure in Zoom chat
          </label>
          <textarea
            rows={4}
            maxLength={500}
            value={consentMessageDraft}
            disabled={!speakerTagStatus?.zoomSupported}
            aria-label="Automatic Zoom consent message"
            onChange={(event) => setConsentMessageDraft(event.target.value)}
          />
          <div className="meeting-consent-actions">
            <small>
              Zoom must be the focused app. Dictalume does not post on Google Meet or
              iPhone, matching the currently supported Granola behavior.
            </small>
            <button
              className="secondary-button compact"
              disabled={
                saving ||
                !speakerTagStatus?.zoomSupported ||
                !consentMessageDraft.trim() ||
                consentMessageDraft.trim() === settings.meetingConsentMessage
              }
              onClick={() =>
                void save({
                  ...settings,
                  meetingConsentMessage: consentMessageDraft
                })
              }
            >
              <Save size={13} /> Save message
            </button>
          </div>
        </section>
      </div>
    </details>
  )
}

function MeetingSpaceEditor({
  space,
  spaces,
  calendarEvents,
  saving,
  onSave,
  onDelete
}: {
  space: MeetingSpace
  spaces: MeetingSpace[]
  calendarEvents: CalendarEvent[]
  saving: boolean
  onSave: (space: MeetingSpace) => void
  onDelete: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(space)
  useEffect(() => setDraft(space), [space])
  const changed = JSON.stringify(draft) !== JSON.stringify(space)
  const seriesRules = draft.autoAddTitles.filter((rule) => rule.startsWith('series:'))
  const titleRules = draft.autoAddTitles.filter((rule) => !rule.startsWith('series:'))

  return (
    <article className="meeting-space-editor">
      <div className="meeting-space-editor-title">
        <input
          className="meeting-space-icon-input"
          aria-label={`${space.name} icon`}
          value={draft.icon}
          maxLength={8}
          onChange={(event) => setDraft({ ...draft, icon: event.target.value })}
        />
        <input
          aria-label="Space name"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </div>
      <textarea
        rows={2}
        aria-label={`${space.name} description`}
        placeholder="What belongs in this Space?"
        value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
      />
      <div className="meeting-space-editor-rules">
        <label>
          Parent folder
          <select
            value={draft.parentId || ''}
            onChange={(event) =>
              setDraft({ ...draft, parentId: event.target.value || undefined })
            }
          >
            <option value="">No parent</option>
            {spaces
              .filter((item) => item.id !== space.id)
              .map((item) => (
                <option value={item.id} key={item.id}>
                  {item.icon} {spacePath(item, spaces)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Auto-add exact meeting names
          <input
            value={titleRules.join(', ')}
            placeholder="Product weekly, Design sync"
            onChange={(event) =>
              setDraft({
                ...draft,
                autoAddTitles: [
                  ...seriesRules,
                  ...event.target.value
                    .split(',')
                    .map((title) => title.trim())
                    .filter(Boolean)
                ]
              })
            }
          />
        </label>
      </div>
      {calendarEvents.some((event) => event.seriesId) && (
        <label className="meeting-series-rule">
          Recurring calendar series
          <select
            value=""
            onChange={(event) => {
              const seriesId = event.target.value
              if (!seriesId || seriesRules.includes(`series:${seriesId}`)) return
              setDraft({
                ...draft,
                autoAddTitles: [...draft.autoAddTitles, `series:${seriesId}`]
              })
            }}
          >
            <option value="">Add a recurring series…</option>
            {calendarEvents
              .filter((event) => event.seriesId)
              .map((event) => (
                <option value={event.seriesId} key={`${event.id}:${event.seriesId}`}>
                  {event.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {seriesRules.length > 0 && (
        <div className="meeting-series-chips">
          {seriesRules.map((rule) => {
            const seriesId = rule.slice('series:'.length)
            const event = calendarEvents.find((item) => item.seriesId === seriesId)
            return (
              <span key={rule}>
                {event?.title || 'Recurring calendar series'}
                <button
                  aria-label={`Remove ${event?.title || 'calendar series'} rule`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      autoAddTitles: draft.autoAddTitles.filter((item) => item !== rule)
                    })
                  }
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
      <div className="meeting-space-editor-actions">
        <button className="icon-text-button danger" onClick={onDelete}>
          <Trash2 size={13} /> Delete
        </button>
        <button
          className="secondary-button compact"
          disabled={saving || !changed || !draft.name.trim()}
          onClick={() => onSave(draft)}
        >
          <Save size={13} /> Save
        </button>
      </div>
    </article>
  )
}

function MeetingSpacesPanel({
  settings,
  onSettings,
  calendarEvents
}: {
  settings: AppSettings | null
  onSettings: (settings: AppSettings) => void
  calendarEvents: CalendarEvent[]
}): React.JSX.Element | null {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📁')
  const [description, setDescription] = useState('')
  const [parentId, setParentId] = useState('')
  const [autoAddTitles, setAutoAddTitles] = useState('')
  const [calendarSeriesRule, setCalendarSeriesRule] = useState('')
  const [saving, setSaving] = useState(false)
  if (!settings) return null
  const spaces = settings.meetingSpaces || []

  const saveSpaces = async (nextSpaces: MeetingSpace[]): Promise<void> => {
    setSaving(true)
    try {
      onSettings(
        await window.desktop.saveSettings({
          ...settings,
          meetingSpaces: nextSpaces
        })
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="meeting-spaces-panel">
      <summary>
        <FolderTree size={15} />
        Spaces
        <span>{spaces.length}</span>
      </summary>
      <div className="meeting-spaces-body">
        <div className="meeting-space-create">
          <div className="meeting-space-create-heading">
            <strong>Create a Space</strong>
            <small>Organize related meetings without moving or duplicating notes.</small>
          </div>
          <div className="meeting-space-create-grid">
            <input
              className="meeting-space-icon-input"
              aria-label="New Space icon"
              value={icon}
              maxLength={8}
              onChange={(event) => setIcon(event.target.value)}
            />
            <input
              value={name}
              placeholder="Space name"
              aria-label="New Space name"
              onChange={(event) => setName(event.target.value)}
            />
            <select
              value={parentId}
              aria-label="New Space parent"
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">No parent folder</option>
              {spaces.map((space) => (
                <option value={space.id} key={space.id}>
                  {space.icon} {spacePath(space, spaces)}
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={2}
            value={description}
            placeholder="Short description"
            aria-label="New Space description"
            onChange={(event) => setDescription(event.target.value)}
          />
          <input
            value={autoAddTitles}
            placeholder="Auto-add exact meeting names, separated by commas"
            aria-label="New Space automatic meeting names"
            onChange={(event) => setAutoAddTitles(event.target.value)}
          />
          {calendarEvents.some((event) => event.seriesId) && (
            <select
              value={calendarSeriesRule}
              aria-label="New Space recurring calendar series"
              onChange={(event) => setCalendarSeriesRule(event.target.value)}
            >
              <option value="">No recurring calendar series</option>
              {calendarEvents
                .filter((event) => event.seriesId)
                .map((event) => (
                  <option value={event.seriesId} key={`${event.id}:${event.seriesId}`}>
                    Auto-add: {event.title}
                  </option>
                ))}
            </select>
          )}
          <button
            className="primary-button compact"
            disabled={saving || !name.trim()}
            onClick={() => {
              void saveSpaces([
                ...spaces,
                {
                  id: crypto.randomUUID(),
                  name,
                  description,
                  icon: icon || '📁',
                  ...(parentId ? { parentId } : {}),
                  autoAddTitles: autoAddTitles
                    .split(',')
                    .map((title) => title.trim())
                    .filter(Boolean)
                    .concat(
                      calendarSeriesRule ? [`series:${calendarSeriesRule}`] : []
                    )
                }
              ]).then(() => {
                setName('')
                setIcon('📁')
                setDescription('')
                setParentId('')
                setAutoAddTitles('')
                setCalendarSeriesRule('')
              })
            }}
          >
            <Plus size={14} /> Create Space
          </button>
        </div>
        {spaces.length > 0 && (
          <div className="meeting-space-editor-list">
            {spaces.map((space) => (
              <MeetingSpaceEditor
                key={space.id}
                space={space}
                spaces={spaces}
                calendarEvents={calendarEvents}
                saving={saving}
                onSave={(updated) =>
                  void saveSpaces(
                    spaces.map((item) => item.id === updated.id ? updated : item)
                  )
                }
                onDelete={() =>
                  void saveSpaces(
                    spaces
                      .filter((item) => item.id !== space.id)
                      .map((item) =>
                        item.parentId === space.id
                          ? { ...item, parentId: undefined }
                          : item
                      )
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

function MeetingPeopleDirectory({
  meetings,
  onSelectPerson
}: {
  meetings: MeetingRecord[]
  onSelectPerson: (name: string) => void
}): React.JSX.Element | null {
  const directory = buildMeetingDirectory(meetings)
  if (directory.people.length === 0) return null
  return (
    <details className="meeting-people-directory">
      <summary>
        <Users size={14} />
        People & companies
        <span>
          {directory.people.length} people · {directory.companies.length} companies
        </span>
      </summary>
      <div className="meeting-directory-body">
        <section>
          <h3><UserRound size={14} /> People</h3>
          <div>
            {directory.people.slice(0, 24).map((person) => (
              <button key={person.key} onClick={() => onSelectPerson(person.name)}>
                <span>{person.name.slice(0, 1).toLocaleUpperCase()}</span>
                <div>
                  <strong>{person.name}</strong>
                  <small>
                    {person.company || person.email || 'Named meeting speaker'} ·{' '}
                    {person.meetingIds.length} {person.meetingIds.length === 1 ? 'meeting' : 'meetings'}
                  </small>
                </div>
              </button>
            ))}
          </div>
        </section>
        {directory.companies.length > 0 && (
          <section>
            <h3><Building2 size={14} /> Companies</h3>
            <div>
              {directory.companies.slice(0, 16).map((company) => (
                <article key={company.domain}>
                  <span><Building2 size={13} /></span>
                  <div>
                    <strong>{company.name}</strong>
                    <small>{company.people} people · {company.meetings} meetings</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </details>
  )
}

function LiveMeetingTranscript({
  transcriptions,
  meetingSource,
  pending,
  error,
  onDelete
}: {
  transcriptions: MeetingSegmentTranscription[]
  meetingSource: MeetingRequest['source']
  pending: number
  error: string
  onDelete: (turnId: string) => void
}): React.JSX.Element {
  const [visible, setVisible] = useState(true)
  const [search, setSearch] = useState('')
  const turns = buildLiveMeetingTurns(transcriptions, meetingSource)
  const filtered = turns.filter((turn) =>
    `${turn.speakerName} ${turn.text}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  )
  const transcript = turns
    .map((turn) => `[${formatDuration(turn.startMs)}] ${turn.speakerName}: ${turn.text}`)
    .join('\n\n')

  return (
    <section className="live-transcript-panel" aria-live="polite">
      <div className="live-transcript-heading">
        <div>
          <span className={`live-transcript-dot ${pending > 0 ? 'is-working' : ''}`} />
          <div>
            <strong>Live transcript</strong>
            <small>
              {pending > 0
                ? `${pending} audio ${pending === 1 ? 'chunk' : 'chunks'} processing…`
                : turns.length > 0
                  ? `${turns.length} source-labelled ${turns.length === 1 ? 'turn' : 'turns'}`
                  : 'The first words appear after the initial audio chunk.'}
            </small>
          </div>
        </div>
        <button className="icon-text-button" onClick={() => setVisible((value) => !value)}>
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {visible && (
        <>
          <div className="live-transcript-toolbar">
            <label>
              <Search size={13} />
              <input
                value={search}
                placeholder="Search live transcript"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button
              className="icon-text-button"
              disabled={!transcript}
              onClick={() => void window.desktop.copyText(transcript)}
            >
              <Copy size={13} /> Copy all
            </button>
          </div>
          <div className="live-transcript-turns">
            {filtered.map((turn) => {
              const ownVoice =
                turn.source === 'microphone' && meetingSource !== 'conversation'
              return (
                <article
                  className={`live-transcript-turn ${ownVoice ? 'is-own-voice' : ''}`}
                  key={turn.id}
                >
                  <div>
                    <strong>{turn.speakerName}</strong>
                    <span>{formatDuration(turn.startMs)}</span>
                    <span>{turn.source === 'microphone' ? 'Microphone' : 'Computer audio'}</span>
                  </div>
                  <p>{turn.text}</p>
                  <div className="live-transcript-turn-actions">
                    <button
                      aria-label="Copy live transcript chunk"
                      onClick={() => void window.desktop.copyText(turn.text)}
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      aria-label="Delete live transcript chunk"
                      onClick={() => onDelete(turn.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </article>
              )
            })}
            {turns.length === 0 && pending === 0 && (
              <div className="live-transcript-empty">
                Listening for the first source-labelled chunk…
              </div>
            )}
          </div>
        </>
      )}
      {error && <p className="meeting-chat-error" role="alert">{error}</p>}
    </section>
  )
}

function SpeakerReview({
  evidence,
  attendees,
  names,
  error,
  onNames,
  onGenerate,
  onDiscard
}: {
  evidence: LiveSpeakerEvidence[]
  attendees: CalendarAttendee[]
  names: Record<string, string>
  error: string
  onNames: (names: Record<string, string>) => void
  onGenerate: () => void
  onDiscard: () => void
}): React.JSX.Element {
  const unresolved = evidence.filter(
    (speaker) =>
      !names[speaker.key]?.trim() &&
      !['Me'].includes(speaker.suggestedName)
  ).length
  return (
    <section className="speaker-review">
      <div className="speaker-review-heading">
        <div>
          <strong><UserRound size={15} /> Confirm who spoke</strong>
          <small>
            Optional, but recommended. Only names you confirm are sent to the notes AI.
            Anonymous labels are never guessed.
          </small>
        </div>
        <span>{unresolved} anonymous</span>
      </div>
      {evidence.length > 0 ? (
        <div className="speaker-review-grid">
          {evidence.map((speaker) => (
            <label key={speaker.key}>
              <span>
                {speaker.suggestedName} ·{' '}
                {speaker.source === 'microphone' ? 'microphone' : 'computer audio'}
                {speaker.diarizationLabel ? ` · ${speaker.diarizationLabel}` : ''}
                {' · '}
                {speaker.turnCount} {speaker.turnCount === 1 ? 'turn' : 'turns'}
              </span>
              <input
                value={names[speaker.key] || ''}
                list="meeting-review-attendees"
                placeholder={
                  speaker.suggestedName === 'Me'
                    ? 'Me (or enter your name)'
                    : `Leave as ${speaker.suggestedName}`
                }
                onChange={(event) =>
                  onNames({ ...names, [speaker.key]: event.target.value })
                }
              />
            </label>
          ))}
          <datalist id="meeting-review-attendees">
            {attendees.map((attendee) => (
              <option
                value={attendee.name}
                key={`${attendee.email || ''}:${attendee.name}`}
              />
            ))}
          </datalist>
        </div>
      ) : (
        <p className="speaker-review-empty">
          No completed live chunks were available to review. Dictalume will keep any
          remaining speakers anonymous while it finishes transcription.
        </p>
      )}
      {evidence.some((speaker) => speaker.suggestedName === 'Others') && (
        <p className="speaker-review-tip">
          “Others” means the current provider returned one combined computer-audio track.
          Choose Deepgram as the meeting provider to separate multiple remote speakers.
        </p>
      )}
      {error && <p className="meeting-chat-error" role="alert">{error}</p>}
      <div className="speaker-review-actions">
        <button className="icon-text-button danger" onClick={onDiscard}>
          <Trash2 size={13} /> Discard recording
        </button>
        <button className="primary-button compact" onClick={onGenerate}>
          <Sparkles size={14} /> Generate notes
        </button>
      </div>
    </section>
  )
}

export class MeetingCapture {
  private audioContext: AudioContext | null = null
  private streams: MediaStream[] = []
  private recordingStreams: Array<{
    source: MeetingAudioSegment['source']
    stream: MediaStream
  }> = []
  private recorders: MediaRecorder[] = []
  private segmentFinalized: Promise<void> = Promise.resolve()
  private rotateTimer: number | null = null
  private active = false
  private paused = false
  private operation: Promise<void> = Promise.resolve()
  private captureStartedAt = 0
  private cancelled = false
  private captureEndNotified = false
  private segmentTasks = new Set<Promise<void>>()
  readonly segments: MeetingAudioSegment[] = []
  hasSystemAudio = false

  constructor(
    private readonly onSegment?: (segment: MeetingAudioSegment) => Promise<void>,
    private readonly onSystemCaptureEnded?: () => void
  ) {}

  async start(includeSystemAudio: boolean): Promise<void> {
    this.cancelled = false
    this.audioContext = new AudioContext()
    await this.audioContext.resume()
    const addRecordingStream = (
      source: MeetingAudioSegment['source'],
      stream: MediaStream
    ): void => {
      if (stream.getAudioTracks().length === 0 || !this.audioContext) return
      const destination = this.audioContext.createMediaStreamDestination()
      this.audioContext.createMediaStreamSource(stream).connect(destination)
      this.recordingStreams.push({ source, stream: destination.stream })
    }

    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      }
    })
    this.streams.push(microphone)
    addRecordingStream('microphone', microphone)

    if (includeSystemAudio) {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      for (const track of display.getTracks()) {
        track.addEventListener(
          'ended',
          () => {
            if (
              this.active &&
              !this.cancelled &&
              !this.captureEndNotified
            ) {
              this.captureEndNotified = true
              this.onSystemCaptureEnded?.()
            }
          },
          { once: true }
        )
      }
      this.streams.push(display)
      this.hasSystemAudio = display.getAudioTracks().length > 0
      addRecordingStream('system', display)
    }

    this.captureStartedAt = Date.now()
    this.active = true
    this.startSegment()
    // Thirty-second source-labelled chunks power the live transcript while
    // keeping long meetings below provider upload limits.
    this.rotateTimer = window.setInterval(() => void this.rotate(), 30 * 1000)
  }

  private mimeType(): string {
    const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    return options.find((type) => MediaRecorder.isTypeSupported(type)) || ''
  }

  private startSegment(): void {
    if (!this.active || this.recordingStreams.length === 0) return
    const mimeType = this.mimeType()
    const startedAt = Date.now()
    const startedAtMs = Math.max(0, startedAt - this.captureStartedAt)
    const finalized = this.recordingStreams.map(({ source, stream }) => {
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000
      })
      this.recorders.push(recorder)
      const chunks: Blob[] = []
      return new Promise<void>((resolve) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        }
        recorder.onstop = async () => {
          const blob = new Blob(chunks, {
            type: recorder.mimeType || mimeType || 'audio/webm'
          })
          try {
            if (blob.size > 0) {
              const buffer = await blob.arrayBuffer()
              const segment: MeetingAudioSegment = {
                id: crypto.randomUUID(),
                audio: new Uint8Array(buffer),
                mimeType: blob.type,
                durationMs: Math.max(1, Date.now() - startedAt),
                source,
                startedAtMs
              }
              this.segments.push(segment)
              if (this.onSegment && !this.cancelled) {
                const task = this.onSegment(segment)
                  .catch(() => undefined)
                  .finally(() => this.segmentTasks.delete(task))
                this.segmentTasks.add(task)
              }
            }
          } finally {
            resolve()
          }
        }
        recorder.start()
      })
    })
    this.segmentFinalized = Promise.all(finalized).then(() => undefined)
  }

  private async stopSegment(): Promise<void> {
    if (this.recorders.length === 0) return
    for (const recorder of this.recorders) {
      if (recorder.state !== 'inactive') recorder.stop()
    }
    await this.segmentFinalized
    this.recorders = []
  }

  private async rotate(): Promise<void> {
    this.operation = this.operation.then(async () => {
      if (!this.active || this.paused) return
      await this.stopSegment()
      if (this.active && !this.paused) this.startSegment()
    })
    await this.operation
  }

  async pause(): Promise<void> {
    if (!this.active || this.paused) return
    this.paused = true
    if (this.rotateTimer !== null) {
      window.clearInterval(this.rotateTimer)
      this.rotateTimer = null
    }
    this.operation = this.operation.then(() => this.stopSegment())
    await this.operation
  }

  resume(): void {
    if (!this.active || !this.paused) return
    this.paused = false
    this.startSegment()
    this.rotateTimer = window.setInterval(() => void this.rotate(), 30 * 1000)
  }

  async stop(): Promise<MeetingAudioSegment[]> {
    this.active = false
    this.paused = false
    if (this.rotateTimer !== null) window.clearInterval(this.rotateTimer)
    await this.operation
    await this.stopSegment()
    await Promise.allSettled([...this.segmentTasks])
    this.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
    this.recordingStreams.forEach(({ stream }) =>
      stream.getTracks().forEach((track) => track.stop())
    )
    await this.audioContext?.close()
    return [...this.segments].sort(
      (left, right) =>
        left.startedAtMs - right.startedAtMs ||
        (left.source === 'microphone' ? -1 : 1)
    )
  }

  cancel(): void {
    this.cancelled = true
    this.active = false
    this.paused = false
    if (this.rotateTimer !== null) window.clearInterval(this.rotateTimer)
    this.recorders.forEach((recorder) => {
      if (recorder.state !== 'inactive') recorder.stop()
    })
    this.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
    this.recordingStreams.forEach(({ stream }) =>
      stream.getTracks().forEach((track) => track.stop())
    )
    void this.audioContext?.close()
  }
}

export function MeetingPage({
  selectedCalendarEvent
}: {
  selectedCalendarEvent?: CalendarEvent | null
}): React.JSX.Element {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([])
  const [deletedMeetings, setDeletedMeetings] = useState<MeetingRecord[]>([])
  const [support, setSupport] = useState<MeetingCaptureSupport | null>(null)
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null)
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [calendarClientId, setCalendarClientId] = useState('')
  const [calendarWorking, setCalendarWorking] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [outlookStatus, setOutlookStatus] = useState<CalendarStatus | null>(null)
  const [outlookEvents, setOutlookEvents] = useState<CalendarEvent[]>([])
  const [outlookClientId, setOutlookClientId] = useState('')
  const [outlookWorking, setOutlookWorking] = useState(false)
  const [outlookError, setOutlookError] = useState('')
  const [briefWorkingId, setBriefWorkingId] = useState('')
  const [preMeetingBrief, setPreMeetingBrief] = useState<PreMeetingBrief | null>(null)
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [source, setSource] = useState<MeetingRequest['source']>('google-meet')
  const [attendees, setAttendees] = useState<CalendarAttendee[]>([])
  const [calendarSeriesId, setCalendarSeriesId] = useState('')
  const [templateId, setTemplateId] = useState<MeetingTemplateId>('general')
  const [userNotes, setUserNotes] = useState('')
  const [attachments, setAttachments] = useState<MeetingAttachment[]>([])
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [liveTranscriptions, setLiveTranscriptions] = useState<
    MeetingSegmentTranscription[]
  >([])
  const [livePending, setLivePending] = useState(0)
  const [liveError, setLiveError] = useState('')
  const [systemAudioActive, setSystemAudioActive] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [openMeetingId, setOpenMeetingId] = useState('')
  const [resumeMeetingId, setResumeMeetingId] = useState('')
  const [meetingSearch, setMeetingSearch] = useState('')
  const [spaceFilter, setSpaceFilter] = useState('all')
  const [scheduledEndAt, setScheduledEndAt] = useState(0)
  const [armedCalendarEvent, setArmedCalendarEvent] = useState<CalendarEvent | null>(
    null
  )
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({})
  const [speakerTagStatus, setSpeakerTagStatus] = useState<SpeakerTagStatus | null>(
    null
  )
  const captureRef = useRef<MeetingCapture | null>(null)
  const pendingMeetingRef = useRef<MeetingRequest | null>(null)
  const liveTranscriptionsRef = useRef<MeetingSegmentTranscription[]>([])
  const liveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const lastLiveSpeechAtRef = useRef(Date.now())
  const finishRef = useRef<() => Promise<void>>(async () => undefined)
  const beginRef = useRef<() => Promise<void>>(async () => undefined)
  const liveUserNotesRef = useRef<HTMLTextAreaElement>(null)
  const legacySpaceMigrationRef = useRef(false)
  const spaces = settings?.meetingSpaces || []
  const filteredSpaceIds =
    spaceFilter === 'all'
      ? null
      : descendantSpaceIds(spaceFilter, spaces)
  const visibleMeetings = meetings.filter(
    (meeting) =>
      (
        !filteredSpaceIds ||
        meetingSpaceIds(meeting, spaces).some((id) => filteredSpaceIds.has(id))
      ) &&
      `${meeting.title} ${meeting.notes} ${meeting.transcript} ${(meeting.attendees || []).map((attendee) => `${attendee.name} ${attendee.email || ''}`).join(' ')}`
        .toLocaleLowerCase()
        .includes(meetingSearch.trim().toLocaleLowerCase())
  )
  const preferredBriefProvider =
    settings?.cleanupProvider === 'same'
      ? settings.provider
      : settings?.cleanupProvider || 'grok'
  const briefProvider = settings
    ? (
        (preferredBriefProvider !== 'deepgram' &&
        (settings.providers[preferredBriefProvider].apiKey ||
          settings.providers[preferredBriefProvider].baseUrl.includes('localhost'))
          ? preferredBriefProvider
          : (Object.keys(settings.providers) as ProviderId[]).find(
              (id) =>
                id !== 'deepgram' &&
                Boolean(
                  settings.providers[id].apiKey ||
                  settings.providers[id].baseUrl.includes('localhost')
                )
            )) || null
      )
    : null
  const meetingTemplates =
    settings?.meetingTemplates?.length
      ? settings.meetingTemplates
      : [{ id: 'general', name: 'General meeting', guidance: '' }]
  const reviewEvidence = buildLiveSpeakerEvidence(liveTranscriptions, source)

  const refresh = (): void => {
    void window.desktop.getMeetings(true).then((items) => {
      setMeetings(items.filter((meeting) => !meeting.deletedAt))
      setDeletedMeetings(items.filter((meeting) => Boolean(meeting.deletedAt)))
    })
  }

  useEffect(() => {
    refresh()
    void window.desktop.getMeetingCaptureSupport().then(setSupport)
    void window.desktop.getSettings().then(setSettings)
    void window.desktop.getSpeakerTagStatus().then(setSpeakerTagStatus)
    void window.desktop.getCalendarStatus().then((next) => {
      setCalendarStatus(next)
      setCalendarClientId(next.clientId)
      if (next.connected) {
        void window.desktop
          .getCalendarEvents()
          .then(setCalendarEvents)
          .catch((reason) =>
            setCalendarError(reason instanceof Error ? reason.message : 'Could not load events.')
          )
      }
    })
    void window.desktop.getOutlookCalendarStatus().then((next) => {
      setOutlookStatus(next)
      setOutlookClientId(next.clientId)
      if (next.connected) {
        void window.desktop
          .getOutlookCalendarEvents()
          .then(setOutlookEvents)
          .catch((reason) =>
            setOutlookError(
              reason instanceof Error ? reason.message : 'Could not load Outlook events.'
            )
          )
      }
    })
    const unsubscribeMeetings = window.desktop.onMeetingsChanged(refresh)
    const unsubscribeSettings = window.desktop.onSettingsChanged(setSettings)
    const speakerTagTimer = window.setInterval(
      () => void window.desktop.getSpeakerTagStatus().then(setSpeakerTagStatus),
      3_000
    )
    return () => {
      unsubscribeMeetings()
      unsubscribeSettings()
      window.clearInterval(speakerTagTimer)
    }
  }, [])

  useEffect(() => {
    if (!settings || legacySpaceMigrationRef.current) return
    const legacyMeetings = meetings.filter(
      (meeting) => meeting.space?.trim() && !(meeting.spaceIds || []).length
    )
    if (legacyMeetings.length === 0) return
    legacySpaceMigrationRef.current = true
    void (async () => {
      const nextSpaces = [...settings.meetingSpaces]
      for (const meeting of legacyMeetings) {
        const label = meeting.space!.trim()
        if (
          !nextSpaces.some(
            (space) => normalizedSpaceTitle(space.name) === normalizedSpaceTitle(label)
          )
        ) {
          nextSpaces.push({
            id: crypto.randomUUID(),
            name: label,
            description: '',
            icon: '📁',
            autoAddTitles: []
          })
        }
      }
      const saved = await window.desktop.saveSettings({
        ...settings,
        meetingSpaces: nextSpaces
      })
      setSettings(saved)
      const migrated = new Map<string, MeetingRecord>()
      for (const meeting of legacyMeetings) {
        const space = saved.meetingSpaces.find(
          (item) =>
            normalizedSpaceTitle(item.name) === normalizedSpaceTitle(meeting.space || '')
        )
        if (!space) continue
        const updated = await window.desktop.updateMeeting({
          meetingId: meeting.id,
          spaceIds: [space.id]
        })
        migrated.set(updated.id, updated)
      }
      if (migrated.size > 0) {
        setMeetings((items) =>
          items.map((meeting) => migrated.get(meeting.id) || meeting)
        )
      }
    })().catch(() => {
      legacySpaceMigrationRef.current = false
    })
  }, [meetings, settings])

  useEffect(() => {
    if (!selectedCalendarEvent) return
    setTitle(selectedCalendarEvent.title)
    setAttendees(selectedCalendarEvent.attendees || [])
    setCalendarSeriesId(selectedCalendarEvent.seriesId || '')
    setScheduledEndAt(selectedCalendarEvent.endsAt)
    setArmedCalendarEvent(
      scheduledMeetingDelay(selectedCalendarEvent, Date.now()) !== null
        ? selectedCalendarEvent
        : null
    )
    if (selectedCalendarEvent.provider !== 'other') {
      setSource(selectedCalendarEvent.provider)
    }
  }, [selectedCalendarEvent])

  useEffect(() => {
    if (status !== 'recording') return
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 250)
    return () => window.clearInterval(timer)
  }, [startedAt, status])

  useEffect(
    () => () => {
      captureRef.current?.cancel()
      void window.desktop.updateMeetingIndicator({
        status: 'hidden',
        title: '',
        elapsedMs: 0,
        systemAudio: false,
        meetingSource: source
      })
    },
    []
  )

  useEffect(() => {
    const indicatorStatus =
      status === 'recording'
        ? isPaused ? 'paused' : 'recording'
        : status === 'reviewing'
          ? 'reviewing'
        : status === 'processing'
          ? 'processing'
          : 'hidden'
    void window.desktop.updateMeetingIndicator({
      status: indicatorStatus,
      title: title.trim() || 'Untitled meeting',
      elapsedMs: elapsed,
      systemAudio: systemAudioActive,
      meetingSource: source
    })
  }, [elapsed, isPaused, status, systemAudioActive, title])

  const begin = async (
    includeSystemAudio = true,
    meetingToResume?: MeetingRecord
  ): Promise<void> => {
    const captureSource = meetingToResume?.source || source
    if (meetingToResume) {
      setResumeMeetingId(meetingToResume.id)
      setTitle(meetingToResume.title)
      setSource(meetingToResume.source)
      setTemplateId(meetingToResume.templateId || 'general')
      setUserNotes(meetingToResume.userNotes || '')
      setAttachments(meetingToResume.attachments || [])
      setAttendees(meetingToResume.attendees || [])
      setCalendarSeriesId(meetingToResume.calendarSeriesId || '')
      setScheduledEndAt(0)
    }
    setStatus('requesting')
    setArmedCalendarEvent(null)
    setError('')
    setLiveError('')
    setLivePending(0)
    setLiveTranscriptions([])
    setSpeakerNames({})
    pendingMeetingRef.current = null
    liveTranscriptionsRef.current = []
    liveQueueRef.current = Promise.resolve()
    lastLiveSpeechAtRef.current = Date.now()
    const transcribeLiveSegment = async (
      segment: MeetingAudioSegment
    ): Promise<void> => {
      setLivePending((count) => count + 1)
      const task = liveQueueRef.current.then(async () => {
        try {
          const result = await window.desktop.transcribeMeetingSegment({
            segment,
            meetingSource: captureSource
          })
          if (result.chunks.length > 0) {
            lastLiveSpeechAtRef.current = Date.now()
            liveTranscriptionsRef.current = [
              ...liveTranscriptionsRef.current,
              result
            ]
            setLiveTranscriptions(liveTranscriptionsRef.current)
          }
        } catch (reason) {
          const message =
            reason instanceof Error ? reason.message : 'A live audio chunk could not be transcribed.'
          if (!message.toLocaleLowerCase().includes('empty transcript')) {
            setLiveError(message)
          }
        } finally {
          setLivePending((count) => Math.max(0, count - 1))
        }
      })
      liveQueueRef.current = task.catch(() => undefined)
      await task
    }
    const capture = new MeetingCapture(
      transcribeLiveSegment,
      () => void finishRef.current()
    )
    captureRef.current = capture
    try {
      await capture.start(includeSystemAudio)
      const now = Date.now()
      setStartedAt(now)
      setElapsed(0)
      setIsPaused(false)
      setSystemAudioActive(capture.hasSystemAudio)
      setStatus('recording')
    } catch (reason) {
      capture.cancel()
      captureRef.current = null
      setError(reason instanceof Error ? reason.message : 'Could not start recording.')
      setStatus('error')
    }
  }
  beginRef.current = () => begin(true)

  useEffect(() => {
    if (!armedCalendarEvent || status !== 'idle') return
    const delay = scheduledMeetingDelay(armedCalendarEvent, Date.now())
    if (delay === null) return
    const timer = window.setTimeout(() => void beginRef.current(), delay)
    return () => window.clearTimeout(timer)
  }, [armedCalendarEvent, status])

  const setMeetingPaused = async (paused: boolean): Promise<void> => {
    const capture = captureRef.current
    if (!capture || status !== 'recording' || paused === isPaused) return
    if (paused) await capture.pause()
    else capture.resume()
    setIsPaused(paused)
  }

  const finish = async (): Promise<void> => {
    const capture = captureRef.current
    if (!capture) return
    const durationMs = Date.now() - startedAt
    setStatus('processing')
    try {
      const segments = await capture.stop()
      pendingMeetingRef.current = {
        title,
        source,
        segments,
        durationMs,
        startedAt,
        userNotes,
        attachments,
        templateId,
        transcriptions: liveTranscriptionsRef.current,
        attendees,
        calendarSeriesId: calendarSeriesId || undefined,
        appendToMeetingId: resumeMeetingId || undefined
      }
      const tagEvents = await window.desktop.getSpeakerTagEvents(
        startedAt,
        Date.now() + 1_000
      )
      setSpeakerNames(
        speakerNamesFromTags(
          liveTranscriptionsRef.current,
          source,
          startedAt,
          tagEvents
        )
      )
      setStatus('reviewing')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The meeting could not be transcribed.')
      setStatus('error')
    } finally {
      captureRef.current = null
    }
  }
  finishRef.current = finish

  const generateMeetingNotes = async (): Promise<void> => {
    const pending = pendingMeetingRef.current
    if (!pending) return
    setStatus('processing')
    setError('')
    try {
      const confirmedNames = Object.fromEntries(
        Object.entries(speakerNames)
          .map(([key, name]) => [key, name.trim()])
          .filter((entry) => Boolean(entry[1]))
      )
      const meeting = await window.desktop.saveMeeting({
        ...pending,
        speakerNames: confirmedNames
      })
      setMeetings((items) => [meeting, ...items.filter((item) => item.id !== meeting.id)])
      setOpenMeetingId(meeting.id)
      setTitle('')
      setUserNotes('')
      setAttachments([])
      setAttendees([])
      setCalendarSeriesId('')
      setScheduledEndAt(0)
      setResumeMeetingId('')
      setElapsed(0)
      setIsPaused(false)
      setLiveTranscriptions([])
      liveTranscriptionsRef.current = []
      setLivePending(0)
      setLiveError('')
      setSpeakerNames({})
      pendingMeetingRef.current = null
      setStatus('idle')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The meeting could not be transcribed.')
      setStatus('reviewing')
    }
  }

  const discardPendingMeeting = (): void => {
    pendingMeetingRef.current = null
    setSpeakerNames({})
    setAttachments([])
    setElapsed(0)
    setIsPaused(false)
    setLiveTranscriptions([])
    liveTranscriptionsRef.current = []
    setLivePending(0)
    setLiveError('')
    setError('')
    setScheduledEndAt(0)
    setStatus('idle')
  }

  useEffect(
    () =>
      window.desktop.onMeetingControl((action) => {
        if (action === 'stop') void finishRef.current()
        else void setMeetingPaused(action === 'pause')
      }),
    [isPaused, status]
  )

  useEffect(() => {
    if (status !== 'recording') return
    const inactivityTimer = window.setInterval(() => {
      if (
        shouldAutoStopMeeting(
          Date.now(),
          lastLiveSpeechAtRef.current,
          scheduledEndAt
        )
      ) {
        void finishRef.current()
      }
    }, 30_000)
    return () => window.clearInterval(inactivityTimer)
  }, [scheduledEndAt, status])

  const createBrief = async (event: CalendarEvent): Promise<void> => {
    if (!briefProvider || briefWorkingId) return
    setBriefWorkingId(event.id)
    setCalendarError('')
    setOutlookError('')
    try {
      setPreMeetingBrief(
        await window.desktop.createPreMeetingBrief({
          event,
          provider: briefProvider as Exclude<ProviderId, 'deepgram'>
        })
      )
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : 'Could not create the pre-meeting brief.'
      if (event.id.startsWith('microsoft:')) setOutlookError(message)
      else setCalendarError(message)
    } finally {
      setBriefWorkingId('')
    }
  }

  const addLiveAttachments = async (files: File[]): Promise<void> => {
    try {
      const added = await Promise.all(files.map(meetingAttachmentFromFile))
      setAttachments((items) => [...items, ...added].slice(0, 20))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The image could not be attached.')
    }
  }

  return (
    <div className="page meeting-page">
      <header className="page-header meeting-header">
        <div>
          <h1>Meetings</h1>
          <p>Record both sides of Meet or Zoom, then get a transcript and focused notes.</p>
        </div>
        <span className="privacy-chip"><Headphones size={13} /> Audio only</span>
      </header>

      <section className={`meeting-capture-card ${status === 'recording' ? 'is-recording' : ''}`}>
        <div className="meeting-capture-top">
          <div className="meeting-orb">
            {status === 'recording' ? <Radio size={29} /> : <Users size={29} />}
          </div>
          <div className="meeting-capture-copy">
            <span className="eyebrow">
              {status === 'recording'
                ? isPaused ? 'Transcription paused' : 'Recording now'
                : status === 'reviewing'
                  ? 'Identity check'
                : status === 'processing'
                  ? 'Creating your notes'
                  : 'New meeting'}
            </span>
            <strong>
              {status === 'recording'
                ? isPaused ? 'Paused' : formatDuration(elapsed)
                : status === 'reviewing'
                  ? 'Confirm speakers before notes'
                : status === 'processing'
                  ? 'Transcribing each audio segment…'
                  : 'Capture the conversation, not the screen'}
            </strong>
            <small>
              {status === 'recording'
                ? systemAudioActive
                  ? 'Microphone + computer audio'
                  : 'Microphone only'
                : status === 'reviewing'
                  ? 'Confirmed names become authoritative labels for the AI'
                : support?.detail || 'Checking audio capture support…'}
            </small>
          </div>
          {status === 'recording' ? (
            <div className="meeting-recording-actions">
              <button
                className="secondary-button compact"
                onClick={() => void setMeetingPaused(!isPaused)}
              >
                {isPaused ? <Play size={15} /> : <Pause size={15} />}
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button className="stop-meeting-button" onClick={() => void finish()}>
                <CircleStop size={18} /> Stop
              </button>
            </div>
          ) : status !== 'reviewing' && status !== 'processing' ? (
            <button
              className="primary-button meeting-start"
              disabled={status === 'requesting'}
              onClick={() => {
                setResumeMeetingId('')
                void begin(true)
              }}
            >
              <Mic size={17} />
              {status === 'requesting' ? 'Opening audio…' : 'Start recording'}
            </button>
          ) : null}
        </div>

        {status !== 'recording' &&
          status !== 'reviewing' &&
          status !== 'processing' && (
          <div className="meeting-fields">
            <label>
              Meeting name
              <input
                value={title}
                placeholder="e.g. Product weekly"
                onChange={(event) => {
                  setTitle(event.target.value)
                  setCalendarSeriesId('')
                }}
              />
            </label>
            <label>
              Where
              <select
                value={source}
                onChange={(event) => setSource(event.target.value as MeetingRequest['source'])}
              >
                <option value="google-meet">Google Meet</option>
                <option value="zoom">Zoom</option>
                <option value="conversation">In-person conversation</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Notes template
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value as MeetingTemplateId)}
              >
                {meetingTemplates.map((template) => (
                  <option value={template.id} key={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {armedCalendarEvent && status === 'idle' && (
          <div className="armed-meeting">
            <CalendarDays size={14} />
            <div>
              <strong>Ready to start at the scheduled time</strong>
              <span>
                {armedCalendarEvent.title} ·{' '}
                {new Intl.DateTimeFormat(undefined, {
                  hour: 'numeric',
                  minute: '2-digit'
                }).format(armedCalendarEvent.startsAt)}
              </span>
            </div>
            <button
              className="icon-text-button"
              onClick={() => setArmedCalendarEvent(null)}
            >
              Cancel
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="meeting-error">
            <span>{error || 'Recording did not start.'}</span>
            <button onClick={() => void begin(false)}>Record microphone only</button>
          </div>
        )}

        {status === 'recording' && (
          <>
            <div className="capture-signals">
              <span><Check size={13} /> Microphone · Me</span>
              <span className={systemAudioActive ? '' : 'signal-muted'}>
                {systemAudioActive ? <Check size={13} /> : <MonitorUp size={13} />}
                {systemAudioActive ? 'Computer audio · Others' : 'Computer audio unavailable'}
              </span>
              <span><Sparkles size={13} /> Sources stay separate</span>
              <span><Check size={13} /> Auto-stop after 15 min silent</span>
            </div>
            <div className="live-meeting-notes">
              <span>Your notes <small>AI uses these as anchors, not as transcript.</small></span>
              <MarkdownToolbar
                textareaRef={liveUserNotesRef}
                value={userNotes}
                onChange={setUserNotes}
                onFiles={(files) => void addLiveAttachments(files)}
              />
              <textarea
                ref={liveUserNotesRef}
                rows={5}
                value={userNotes}
                aria-label="Your live meeting notes"
                placeholder="Write decisions, context, or questions while you talk…"
                onChange={(event) => setUserNotes(event.target.value)}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files).filter((file) =>
                    file.type.startsWith('image/')
                  )
                  if (files.length > 0) {
                    event.preventDefault()
                    void addLiveAttachments(files)
                  }
                }}
              />
              <MeetingAttachmentGallery
                attachments={attachments}
                onRemove={(id) =>
                  setAttachments((items) => items.filter((item) => item.id !== id))
                }
              />
            </div>
          </>
        )}
        {status === 'reviewing' && (
          <SpeakerReview
            evidence={reviewEvidence}
            attendees={attendees}
            names={speakerNames}
            error={error}
            onNames={setSpeakerNames}
            onGenerate={() => void generateMeetingNotes()}
            onDiscard={discardPendingMeeting}
          />
        )}
        {(status === 'recording' ||
          status === 'reviewing' ||
          status === 'processing') && (
          <LiveMeetingTranscript
            transcriptions={liveTranscriptions}
            meetingSource={source}
            pending={livePending}
            error={liveError}
            onDelete={(turnId) => {
              const separator = turnId.lastIndexOf(':')
              const segmentId = turnId.slice(0, separator)
              const chunkIndex = Number(turnId.slice(separator + 1))
              const next = liveTranscriptionsRef.current
                .map((transcription) =>
                  transcription.segmentId === segmentId
                    ? {
                        ...transcription,
                        chunks: transcription.chunks.filter(
                          (_chunk, index) => index !== chunkIndex
                        )
                      }
                    : transcription
                )
                .filter((transcription) => transcription.chunks.length > 0)
              liveTranscriptionsRef.current = next
              setLiveTranscriptions(next)
            }}
          />
        )}
      </section>

      <section className="calendar-panel">
        <div className="calendar-panel-heading">
          <span className="row-icon"><CalendarDays size={17} /></span>
          <div>
            <strong>Google Calendar</strong>
            <small>
              {calendarStatus?.connected
                ? calendarStatus.accountEmail || 'Connected'
                : 'Use upcoming event names and Meet or Zoom links.'}
            </small>
          </div>
          {calendarStatus?.connected && (
            <button
              className="icon-text-button"
              onClick={async () => {
                setCalendarStatus(await window.desktop.disconnectGoogleCalendar())
                setCalendarEvents([])
              }}
            >
              <LogOut size={14} /> Disconnect
            </button>
          )}
        </div>
        {!calendarStatus?.connected ? (
          <div className="calendar-connect">
            <label>
              OAuth desktop client ID
              <input
                value={calendarClientId}
                placeholder="1234…apps.googleusercontent.com"
                onChange={(event) => setCalendarClientId(event.target.value)}
              />
            </label>
            <button
              className="secondary-button"
              disabled={calendarWorking || !calendarClientId.trim()}
              onClick={async () => {
                setCalendarWorking(true)
                setCalendarError('')
                try {
                  const next = await window.desktop.connectGoogleCalendar(calendarClientId)
                  setCalendarStatus(next)
                  setCalendarEvents(await window.desktop.getCalendarEvents())
                } catch (reason) {
                  setCalendarError(
                    reason instanceof Error ? reason.message : 'Calendar connection failed.'
                  )
                } finally {
                  setCalendarWorking(false)
                }
              }}
            >
              <Link2 size={15} /> {calendarWorking ? 'Waiting for Google…' : 'Connect'}
            </button>
            <p>
              Create a Desktop OAuth client in Google Cloud with the Calendar API enabled.
              Dictalume requests read-only event access.
            </p>
          </div>
        ) : calendarEvents.length > 0 ? (
          <div className="calendar-events">
            {calendarEvents.slice(0, 5).map((event) => (
              <button
                key={event.id}
                onClick={() => {
                  setTitle(event.title)
                  setAttendees(event.attendees || [])
                  setCalendarSeriesId(event.seriesId || '')
                  setScheduledEndAt(event.endsAt)
                  setArmedCalendarEvent(
                    scheduledMeetingDelay(event, Date.now()) !== null ? event : null
                  )
                  if (event.provider !== 'other') setSource(event.provider)
                }}
              >
                <span className="calendar-time">
                  {new Intl.DateTimeFormat(undefined, {
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit'
                  }).format(event.startsAt)}
                </span>
                <span className="calendar-event-title">{event.title}</span>
                <span
                  className="brief-link"
                  role="button"
                  tabIndex={0}
                  onClick={(click) => {
                    click.stopPropagation()
                    void createBrief(event)
                  }}
                  onKeyDown={(key) => {
                    if (key.key === 'Enter' || key.key === ' ') {
                      key.preventDefault()
                      key.currentTarget.click()
                    }
                  }}
                >
                  {briefWorkingId === event.id ? 'Preparing…' : 'Brief'}
                </span>
                {event.joinUrl && (
                  <span
                    className="join-link"
                    role="button"
                    tabIndex={0}
                    onClick={(click) => {
                      click.stopPropagation()
                      void window.desktop.openExternal(event.joinUrl)
                    }}
                    onKeyDown={(key) => {
                      if (key.key === 'Enter' || key.key === ' ') {
                        key.stopPropagation()
                        void window.desktop.openExternal(event.joinUrl)
                      }
                    }}
                  >
                    Join
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="calendar-empty">No upcoming events in the next seven days.</p>
        )}
        {calendarError && <p className="calendar-error">{calendarError}</p>}
      </section>

      <section className="calendar-panel outlook-calendar-panel">
        <div className="calendar-panel-heading">
          <span className="row-icon"><CalendarDays size={17} /></span>
          <div>
            <strong>Outlook Calendar</strong>
            <small>
              {outlookStatus?.connected
                ? outlookStatus.accountEmail || 'Connected'
                : 'Use Microsoft 365 events, Teams, Meet, and Zoom links.'}
            </small>
          </div>
          {outlookStatus?.connected && (
            <button
              className="icon-text-button"
              onClick={async () => {
                setOutlookStatus(await window.desktop.disconnectOutlookCalendar())
                setOutlookEvents([])
              }}
            >
              <LogOut size={14} /> Disconnect
            </button>
          )}
        </div>
        {!outlookStatus?.connected ? (
          <div className="calendar-connect">
            <label>
              Microsoft application client ID
              <input
                value={outlookClientId}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(event) => setOutlookClientId(event.target.value)}
              />
            </label>
            <button
              className="secondary-button"
              disabled={outlookWorking || !outlookClientId.trim()}
              onClick={async () => {
                setOutlookWorking(true)
                setOutlookError('')
                try {
                  const next = await window.desktop.connectOutlookCalendar(outlookClientId)
                  setOutlookStatus(next)
                  setOutlookEvents(await window.desktop.getOutlookCalendarEvents())
                } catch (reason) {
                  setOutlookError(
                    reason instanceof Error
                      ? reason.message
                      : 'Outlook Calendar connection failed.'
                  )
                } finally {
                  setOutlookWorking(false)
                }
              }}
            >
              <Link2 size={15} /> {outlookWorking ? 'Waiting for Microsoft…' : 'Connect'}
            </button>
            <p>
              Register a public desktop application in Microsoft Entra with delegated
              User.Read and Calendars.Read permissions, and add
              http://localhost as a mobile/desktop redirect URI.
            </p>
          </div>
        ) : outlookEvents.length > 0 ? (
          <div className="calendar-events">
            {outlookEvents.slice(0, 5).map((event) => (
              <button
                key={event.id}
                onClick={() => {
                  setTitle(event.title)
                  setAttendees(event.attendees || [])
                  setCalendarSeriesId(event.seriesId || '')
                  setScheduledEndAt(event.endsAt)
                  setArmedCalendarEvent(
                    scheduledMeetingDelay(event, Date.now()) !== null ? event : null
                  )
                  if (event.provider !== 'other') setSource(event.provider)
                }}
              >
                <span className="calendar-time">
                  {new Intl.DateTimeFormat(undefined, {
                    weekday: 'short',
                    hour: 'numeric',
                    minute: '2-digit'
                  }).format(event.startsAt)}
                </span>
                <span className="calendar-event-title">{event.title}</span>
                <span
                  className="brief-link"
                  role="button"
                  tabIndex={0}
                  onClick={(click) => {
                    click.stopPropagation()
                    void createBrief(event)
                  }}
                  onKeyDown={(key) => {
                    if (key.key === 'Enter' || key.key === ' ') {
                      key.preventDefault()
                      key.currentTarget.click()
                    }
                  }}
                >
                  {briefWorkingId === event.id ? 'Preparing…' : 'Brief'}
                </span>
                {event.joinUrl && (
                  <span
                    className="join-link"
                    role="button"
                    tabIndex={0}
                    onClick={(click) => {
                      click.stopPropagation()
                      void window.desktop.openExternal(event.joinUrl)
                    }}
                    onKeyDown={(key) => {
                      if (key.key === 'Enter' || key.key === ' ') {
                        key.stopPropagation()
                        void window.desktop.openExternal(event.joinUrl)
                      }
                    }}
                  >
                    Join
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="calendar-empty">No upcoming Outlook events in the next seven days.</p>
        )}
        {outlookError && <p className="calendar-error">{outlookError}</p>}
      </section>

      {preMeetingBrief && (
        <section className="pre-meeting-brief standalone-brief">
          <div className="pre-meeting-brief-heading">
            <div>
              <strong><Sparkles size={14} /> Pre-meeting brief</strong>
              <small>Based on: {preMeetingBrief.meetingTitles.join(' · ')}</small>
            </div>
            <div>
              <button
                className="icon-text-button"
                onClick={() => void window.desktop.copyText(preMeetingBrief.content)}
              >
                <Copy size={13} /> Copy
              </button>
              <button
                className="icon-button"
                aria-label="Close pre-meeting brief"
                onClick={() => setPreMeetingBrief(null)}
              >
                ×
              </button>
            </div>
          </div>
          <pre>{preMeetingBrief.content}</pre>
        </section>
      )}

      <MeetingLibraryChat meetings={meetings} settings={settings} />
      <MeetingCustomization
        settings={settings}
        onSettings={setSettings}
        speakerTagStatus={speakerTagStatus}
      />
      <MeetingSpacesPanel
        settings={settings}
        onSettings={setSettings}
        calendarEvents={[...calendarEvents, ...outlookEvents]}
      />
      <MeetingPeopleDirectory
        meetings={meetings}
        onSelectPerson={(name) => {
          setMeetingSearch(name)
          setSpaceFilter('all')
        }}
      />

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Recent meetings</h2>
            <p>Notes and transcripts sync when a shared context folder is enabled.</p>
          </div>
          <div className="meeting-library-controls">
            <button
              className="icon-text-button"
              disabled={meetings.length === 0}
              onClick={() => void window.desktop.exportMeetingsCsv()}
            >
              <Download size={13} /> Export CSV
            </button>
            {spaces.length > 0 && (
              <select
                value={spaceFilter}
                aria-label="Filter meetings by space"
                onChange={(event) => setSpaceFilter(event.target.value)}
              >
                <option value="all">All spaces</option>
                {spaces.map((space) => (
                  <option value={space.id} key={space.id}>
                    {space.icon} {spacePath(space, spaces)}
                  </option>
                ))}
              </select>
            )}
            <div className="meeting-library-search">
              <Search size={13} />
              <input
                value={meetingSearch}
                placeholder="Search meetings"
                aria-label="Search meetings"
                onChange={(event) => setMeetingSearch(event.target.value)}
              />
            </div>
          </div>
        </div>
        {meetings.length === 0 ? (
          <div className="meeting-empty">
            <div className="empty-icon"><Mic size={21} /></div>
            <strong>No meetings yet</strong>
            <span>Your first transcript and notes will appear here.</span>
          </div>
        ) : (
          <div className="meeting-list">
            {visibleMeetings.map((meeting) => (
              <details
                className="meeting-record"
                key={meeting.id}
                open={openMeetingId === meeting.id}
                onToggle={(event) => {
                  if (event.currentTarget.open) setOpenMeetingId(meeting.id)
                  else if (openMeetingId === meeting.id) setOpenMeetingId('')
                }}
              >
                <summary>
                  <span className="meeting-source-dot" />
                  <span className="meeting-summary-copy">
                    <strong>{meeting.title}</strong>
                    <small>
                      {formatDate(meeting.createdAt)} · {formatDuration(meeting.durationMs)} ·{' '}
                      {meeting.source.replace('-', ' ')}
                    </small>
                    <span className="meeting-space-chip-row">
                      {meetingSpaceIds(meeting, spaces).map((spaceId) => {
                        const space = spaces.find((item) => item.id === spaceId)
                        return space ? (
                          <span className="meeting-space-chip" key={space.id}>
                            {space.icon} {space.name}
                          </span>
                        ) : null
                      })}
                      {meeting.space && meetingSpaceIds(meeting, spaces).length === 0 && (
                        <span className="meeting-space-chip">{meeting.space}</span>
                      )}
                    </span>
                  </span>
                  <span className="meeting-record-actions">
                    <button
                      className="icon-button"
                      aria-label="Copy complete meeting document"
                      onClick={(event) => {
                        event.preventDefault()
                        void window.desktop.copyText(
                          composeMeetingDocument(meeting.title, meeting.notes, meeting.transcript)
                        )
                      }}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label="Move meeting to trash"
                      onClick={(event) => {
                        event.preventDefault()
                        void window.desktop.deleteMeeting(meeting.id)
                        setMeetings((items) => items.filter((item) => item.id !== meeting.id))
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </summary>
                <div className="meeting-record-body">
                  <MeetingDocumentHeader
                    meeting={meeting}
                    onUpdate={(updated) =>
                      setMeetings((items) =>
                        items.map((item) => item.id === updated.id ? updated : item)
                      )
                    }
                  />
                  <MeetingOrganizationBar
                    meeting={meeting}
                    spaces={spaces}
                    onUpdate={(updated) =>
                      setMeetings((items) =>
                        items.map((item) => item.id === updated.id ? updated : item)
                      )
                    }
                    onResume={() =>
                      void begin(meeting.source !== 'conversation', meeting)
                    }
                    resumeDisabled={
                      status === 'requesting' ||
                      status === 'recording' ||
                      status === 'reviewing' ||
                      status === 'processing'
                    }
                  />
                  <MeetingNotesView
                    meeting={meeting}
                    onUpdate={(updated) =>
                      setMeetings((items) =>
                        items.map((item) => item.id === updated.id ? updated : item)
                      )
                    }
                  />
                  <MeetingChat
                    meeting={meeting}
                    settings={settings}
                    onUpdate={(updated) =>
                      setMeetings((items) =>
                        items.map((item) => item.id === updated.id ? updated : item)
                      )
                    }
                  />
                </div>
              </details>
            ))}
            {visibleMeetings.length === 0 && (
              <div className="meeting-search-empty">No meetings match “{meetingSearch}”.</div>
            )}
          </div>
        )}
      </section>
      {deletedMeetings.length > 0 && (
        <details className="meeting-trash">
          <summary>
            <Trash2 size={14} />
            Recently deleted
            <span>{deletedMeetings.length}</span>
          </summary>
          <div className="meeting-trash-list">
            {deletedMeetings.map((meeting) => (
              <div key={meeting.id}>
                <div>
                  <strong>{meeting.title}</strong>
                  <small>
                    Deleted {formatDate(meeting.deletedAt || meeting.updatedAt || meeting.createdAt)}
                  </small>
                </div>
                <button
                  className="icon-text-button"
                  onClick={async () => {
                    await window.desktop.restoreMeeting(meeting.id)
                    refresh()
                  }}
                >
                  <RotateCcw size={13} /> Restore
                </button>
                <button
                  className="icon-text-button danger"
                  onClick={async () => {
                    if (!window.confirm(`Permanently delete “${meeting.title}”?`)) return
                    await window.desktop.permanentlyDeleteMeeting(meeting.id)
                    refresh()
                  }}
                >
                  Delete forever
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
