import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  Check,
  CircleStop,
  Copy,
  Headphones,
  Link2,
  LogOut,
  Mic,
  MonitorUp,
  Radio,
  Sparkles,
  Trash2,
  Users
} from 'lucide-react'
import type {
  CalendarEvent,
  CalendarStatus,
  MeetingAudioSegment,
  MeetingCaptureSupport,
  MeetingRecord,
  MeetingRequest
} from '../../shared/types'
import { composeMeetingDocument, parseMeetingNotes } from './meetingNotes'

type CaptureStatus = 'idle' | 'requesting' | 'recording' | 'processing' | 'error'

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

function MeetingNotesView({
  notes,
  transcript
}: {
  notes: string
  transcript: string
}): React.JSX.Element {
  const sections = parseMeetingNotes(notes)
  return (
    <div className="meeting-document">
      <section className="meeting-note-section">
        <h3><Sparkles size={15} /> Summary</h3>
        <ul className="meeting-summary-list">
          {sections.summary.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ul>
      </section>
      {sections.todos.length > 0 && (
        <section className="meeting-note-section">
          <h3><Check size={15} /> To-do list</h3>
          <ul className="meeting-todo-list">
            {sections.todos.map((item, index) => (
              <li key={`${item}-${index}`}>
                <span className="meeting-checkbox" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="meeting-note-section meeting-transcript-section">
        <h3><Mic size={15} /> Full transcript</h3>
        <p>{transcript}</p>
      </section>
    </div>
  )
}

export class MeetingCapture {
  private audioContext: AudioContext | null = null
  private streams: MediaStream[] = []
  private mixedStream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private segmentFinalized: Promise<void> = Promise.resolve()
  private rotateTimer: number | null = null
  private active = false
  private operation: Promise<void> = Promise.resolve()
  readonly segments: MeetingAudioSegment[] = []
  hasSystemAudio = false

  async start(includeSystemAudio: boolean): Promise<void> {
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      }
    })
    this.streams.push(microphone)

    if (includeSystemAudio) {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      this.streams.push(display)
      this.hasSystemAudio = display.getAudioTracks().length > 0
    }

    this.audioContext = new AudioContext()
    await this.audioContext.resume()
    const destination = this.audioContext.createMediaStreamDestination()
    for (const stream of this.streams) {
      if (stream.getAudioTracks().length > 0) {
        this.audioContext.createMediaStreamSource(stream).connect(destination)
      }
    }
    this.mixedStream = destination.stream
    this.active = true
    this.startSegment()
    // Independent files keep long meetings below common provider upload limits.
    this.rotateTimer = window.setInterval(() => void this.rotate(), 4 * 60 * 1000)
  }

  private mimeType(): string {
    const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    return options.find((type) => MediaRecorder.isTypeSupported(type)) || ''
  }

  private startSegment(): void {
    if (!this.mixedStream || !this.active) return
    const mimeType = this.mimeType()
    this.recorder = new MediaRecorder(this.mixedStream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 64_000
    })
    const chunks: Blob[] = []
    const startedAt = Date.now()
    let resolveFinalized = (): void => undefined
    this.segmentFinalized = new Promise<void>((resolve) => {
      resolveFinalized = resolve
    })
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    const recorder = this.recorder
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
      try {
        if (blob.size > 0) {
          const buffer = await blob.arrayBuffer()
          this.segments.push({
            audio: new Uint8Array(buffer),
            mimeType: blob.type,
            durationMs: Math.max(1, Date.now() - startedAt)
          })
        }
      } finally {
        resolveFinalized()
      }
    }
    this.recorder.start()
  }

  private async stopSegment(): Promise<void> {
    const recorder = this.recorder
    if (!recorder) return
    if (recorder.state !== 'inactive') recorder.stop()
    await this.segmentFinalized
  }

  private async rotate(): Promise<void> {
    this.operation = this.operation.then(async () => {
      if (!this.active) return
      await this.stopSegment()
      if (this.active) this.startSegment()
    })
    await this.operation
  }

  async stop(): Promise<MeetingAudioSegment[]> {
    this.active = false
    if (this.rotateTimer !== null) window.clearInterval(this.rotateTimer)
    await this.operation
    await this.stopSegment()
    this.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
    this.mixedStream?.getTracks().forEach((track) => track.stop())
    await this.audioContext?.close()
    return this.segments
  }

  cancel(): void {
    this.active = false
    if (this.rotateTimer !== null) window.clearInterval(this.rotateTimer)
    if (this.recorder?.state !== 'inactive') this.recorder?.stop()
    this.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
    this.mixedStream?.getTracks().forEach((track) => track.stop())
    void this.audioContext?.close()
  }
}

export function MeetingPage(): React.JSX.Element {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([])
  const [support, setSupport] = useState<MeetingCaptureSupport | null>(null)
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null)
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [calendarClientId, setCalendarClientId] = useState('')
  const [calendarWorking, setCalendarWorking] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [source, setSource] = useState<MeetingRequest['source']>('google-meet')
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [systemAudioActive, setSystemAudioActive] = useState(false)
  const captureRef = useRef<MeetingCapture | null>(null)

  const refresh = (): void => {
    void window.desktop.getMeetings().then(setMeetings)
  }

  useEffect(() => {
    refresh()
    void window.desktop.getMeetingCaptureSupport().then(setSupport)
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
    return window.desktop.onMeetingsChanged(refresh)
  }, [])

  useEffect(() => {
    if (status !== 'recording') return
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 250)
    return () => window.clearInterval(timer)
  }, [startedAt, status])

  useEffect(
    () => () => {
      captureRef.current?.cancel()
    },
    []
  )

  const begin = async (includeSystemAudio = true): Promise<void> => {
    setStatus('requesting')
    setError('')
    const capture = new MeetingCapture()
    captureRef.current = capture
    try {
      await capture.start(includeSystemAudio)
      const now = Date.now()
      setStartedAt(now)
      setElapsed(0)
      setSystemAudioActive(capture.hasSystemAudio)
      setStatus('recording')
    } catch (reason) {
      capture.cancel()
      captureRef.current = null
      setError(reason instanceof Error ? reason.message : 'Could not start recording.')
      setStatus('error')
    }
  }

  const finish = async (): Promise<void> => {
    const capture = captureRef.current
    if (!capture) return
    const durationMs = Date.now() - startedAt
    setStatus('processing')
    try {
      const segments = await capture.stop()
      const meeting = await window.desktop.saveMeeting({
        title,
        source,
        segments,
        durationMs,
        startedAt
      })
      setMeetings((items) => [meeting, ...items.filter((item) => item.id !== meeting.id)])
      setTitle('')
      setElapsed(0)
      setStatus('idle')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The meeting could not be transcribed.')
      setStatus('error')
    } finally {
      captureRef.current = null
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
                ? 'Recording now'
                : status === 'processing'
                  ? 'Creating your notes'
                  : 'New meeting'}
            </span>
            <strong>
              {status === 'recording'
                ? formatDuration(elapsed)
                : status === 'processing'
                  ? 'Transcribing each audio segment…'
                  : 'Capture the conversation, not the screen'}
            </strong>
            <small>
              {status === 'recording'
                ? systemAudioActive
                  ? 'Microphone + computer audio'
                  : 'Microphone only'
                : support?.detail || 'Checking audio capture support…'}
            </small>
          </div>
          {status === 'recording' ? (
            <button className="stop-meeting-button" onClick={() => void finish()}>
              <CircleStop size={18} /> Stop
            </button>
          ) : (
            <button
              className="primary-button meeting-start"
              disabled={status === 'requesting' || status === 'processing'}
              onClick={() => void begin(true)}
            >
              <Mic size={17} />
              {status === 'requesting' ? 'Opening audio…' : 'Start recording'}
            </button>
          )}
        </div>

        {status !== 'recording' && status !== 'processing' && (
          <div className="meeting-fields">
            <label>
              Meeting name
              <input
                value={title}
                placeholder="e.g. Product weekly"
                onChange={(event) => setTitle(event.target.value)}
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
          </div>
        )}

        {status === 'error' && (
          <div className="meeting-error">
            <span>{error || 'Recording did not start.'}</span>
            <button onClick={() => void begin(false)}>Record microphone only</button>
          </div>
        )}

        {status === 'recording' && (
          <div className="capture-signals">
            <span><Check size={13} /> Microphone</span>
            <span className={systemAudioActive ? '' : 'signal-muted'}>
              {systemAudioActive ? <Check size={13} /> : <MonitorUp size={13} />}
              {systemAudioActive ? 'Computer audio' : 'Computer audio unavailable'}
            </span>
            <span><Sparkles size={13} /> AI notes after stopping</span>
          </div>
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

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Recent meetings</h2>
            <p>Notes and transcripts sync when a shared context folder is enabled.</p>
          </div>
          <span className="row-value">{meetings.length} saved</span>
        </div>
        {meetings.length === 0 ? (
          <div className="meeting-empty">
            <div className="empty-icon"><Mic size={21} /></div>
            <strong>No meetings yet</strong>
            <span>Your first transcript and notes will appear here.</span>
          </div>
        ) : (
          <div className="meeting-list">
            {meetings.map((meeting) => (
              <details className="meeting-record" key={meeting.id}>
                <summary>
                  <span className="meeting-source-dot" />
                  <span className="meeting-summary-copy">
                    <strong>{meeting.title}</strong>
                    <small>
                      {formatDate(meeting.createdAt)} · {formatDuration(meeting.durationMs)} ·{' '}
                      {meeting.source.replace('-', ' ')}
                    </small>
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
                      aria-label="Delete meeting"
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
                  <MeetingNotesView notes={meeting.notes} transcript={meeting.transcript} />
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
