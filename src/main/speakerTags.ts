import { WebSocketServer, type RawData } from 'ws'
import type { SpeakerTagEvent, SpeakerTagStatus } from '../shared/types'
import { speakerTagNameForInterval } from '../shared/meeting'

export const SPEAKER_TAG_PORT = 43_127
const MAX_EVENT_AGE_MS = 2 * 60 * 60 * 1000
const MATCH_WINDOW_MS = 2_500

function cleanSpeakerName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function allowedExtensionOrigin(origin = ''): boolean {
  return (
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://')
  )
}

export class SpeakerTagManager {
  private server: WebSocketServer | null = null
  private events: SpeakerTagEvent[] = []
  private clients = 0
  private lastSpeaker = ''
  private lastSeenAt = 0
  private lastSource: SpeakerTagEvent['source'] | '' = ''
  private error = ''

  async start(): Promise<SpeakerTagStatus> {
    if (this.server) return this.status()
    await new Promise<void>((resolve) => {
      const server = new WebSocketServer({
        host: '127.0.0.1',
        port: SPEAKER_TAG_PORT,
        maxPayload: 4_096
      })
      this.server = server
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      server.once('listening', () => {
        this.error = ''
        finish()
      })
      server.once('error', (reason) => {
        this.error =
          reason instanceof Error
            ? reason.message
            : 'The local speaker-tag bridge could not start.'
        this.server = null
        finish()
      })
      server.on('connection', (socket, request) => {
        if (!allowedExtensionOrigin(request.headers.origin)) {
          socket.close(1008, 'Browser extension origin required.')
          return
        }
        this.clients += 1
        socket.on('message', (data) => this.receive(data))
        socket.once('close', () => {
          this.clients = Math.max(0, this.clients - 1)
        })
      })
    })
    return this.status()
  }

  status(): SpeakerTagStatus {
    return {
      connected: this.clients > 0,
      clients: this.clients,
      port: SPEAKER_TAG_PORT,
      lastSpeaker: this.lastSpeaker,
      lastSeenAt: this.lastSeenAt,
      lastSource: this.lastSource,
      zoomSupported: process.platform === 'darwin',
      error: this.error
    }
  }

  eventsBetween(startedAt: number, endedAt: number): SpeakerTagEvent[] {
    const start = Math.max(0, Number(startedAt) || 0)
    const end = Math.max(start, Number(endedAt) || Date.now())
    return this.events.filter(
      (event) => event.capturedAt >= start && event.capturedAt <= end
    )
  }

  speakerAt(
    timestamp: number,
    source?: SpeakerTagEvent['source']
  ): string | undefined {
    let best: SpeakerTagEvent | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index]
      if (source && event.source !== source) continue
      const distance = Math.abs(event.capturedAt - timestamp)
      if (distance < bestDistance) {
        best = event
        bestDistance = distance
      }
      if (event.capturedAt < timestamp - MATCH_WINDOW_MS) break
    }
    return best && bestDistance <= MATCH_WINDOW_MS ? best.name : undefined
  }

  speakerForInterval(
    startedAt: number,
    endedAt: number,
    source: SpeakerTagEvent['source']
  ): string | undefined {
    return speakerTagNameForInterval(
      this.events.filter((event) => event.source === source),
      startedAt,
      endedAt
    )
  }

  recordTrustedSpeaker(
    nameValue: string,
    source: SpeakerTagEvent['source'],
    capturedAt = Date.now(),
    meetingUrl = source === 'zoom' ? 'zoom://active-speaker' : ''
  ): void {
    const name = cleanSpeakerName(nameValue)
    if (!name) return
    const now = Date.now()
    this.events.push({ name, capturedAt, meetingUrl, source })
    this.events = this.events.filter(
      (event) => event.capturedAt >= now - MAX_EVENT_AGE_MS
    )
    this.lastSpeaker = name
    this.lastSeenAt = capturedAt
    this.lastSource = source
  }

  stop(): void {
    this.server?.clients.forEach((client) => client.close(1001, 'Dictalume quit.'))
    this.server?.close()
    this.server = null
    this.clients = 0
  }

  private receive(data: RawData): void {
    try {
      const payload = JSON.parse(data.toString()) as {
        type?: string
        name?: unknown
        capturedAt?: unknown
        meetingUrl?: unknown
      }
      if (payload.type !== 'speaker-active') return
      const name = cleanSpeakerName(payload.name)
      const capturedAt = Number(payload.capturedAt)
      const meetingUrl =
        typeof payload.meetingUrl === 'string'
          ? payload.meetingUrl.slice(0, 500)
          : ''
      const now = Date.now()
      if (
        !name ||
        !Number.isFinite(capturedAt) ||
        Math.abs(capturedAt - now) > 60_000 ||
        !meetingUrl.startsWith('https://meet.google.com/')
      ) {
        return
      }
      this.recordTrustedSpeaker(
        name,
        'google-meet',
        capturedAt,
        meetingUrl
      )
    } catch {
      // Ignore malformed extension messages without affecting transcription.
    }
  }
}
