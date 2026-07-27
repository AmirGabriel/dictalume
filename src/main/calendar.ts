import { app, safeStorage, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CalendarEvent, CalendarStatus } from '../shared/types'
import {
  normalizeCalendarEvent,
  type GoogleCalendarEvent
} from './calendarEvents'

interface CalendarCredentials {
  clientId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountEmail: string
}

const scope = 'https://www.googleapis.com/auth/calendar.events.readonly'

function base64url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class CalendarManager {
  private path = join(app.getPath('userData'), 'calendar.json')
  private credentials: CalendarCredentials | null = null
  private lastError = ''

  async start(): Promise<void> {
    this.credentials = await this.read()
  }

  status(): CalendarStatus {
    return {
      connected: Boolean(this.credentials?.refreshToken || this.credentials?.accessToken),
      clientId: this.credentials?.clientId || '',
      accountEmail: this.credentials?.accountEmail || '',
      error: this.lastError
    }
  }

  async connect(clientId: string): Promise<CalendarStatus> {
    if (!clientId.trim()) throw new Error('Paste a Google OAuth desktop client ID.')
    this.lastError = ''
    const verifier = base64url(randomBytes(48))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(24))

    const result = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = createServer((request, response) => {
        const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`
        const url = new URL(request.url || '/', redirectUri)
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          '<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:16px -apple-system;padding:48px;color:#1d1d1f}main{max-width:520px;margin:auto}h1{font-size:28px}</style><main><h1>Calendar connected</h1><p>You can close this window and return to Dictalume.</p></main>'
        )
        server.close()
        if (!code || returnedState !== state) {
          reject(new Error('Google did not return a valid authorization code.'))
        } else {
          resolve({ code, redirectUri })
        }
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`
        const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authorize.search = new URLSearchParams({
          client_id: clientId.trim(),
          redirect_uri: redirectUri,
          response_type: 'code',
          scope,
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256'
        }).toString()
        void shell.openExternal(authorize.toString())
      })
      setTimeout(() => {
        server.close()
        reject(new Error('Google Calendar authorization timed out.'))
      }, 180_000)
    })

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId.trim(),
        code: result.code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: result.redirectUri
      })
    })
    if (!response.ok) throw new Error('Google rejected the calendar connection.')
    const token = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }
    const email = await this.fetchAccountEmail(token.access_token)
    this.credentials = {
      clientId: clientId.trim(),
      accessToken: token.access_token,
      refreshToken: token.refresh_token || '',
      expiresAt: Date.now() + token.expires_in * 1000,
      accountEmail: email
    }
    await this.write()
    return this.status()
  }

  async disconnect(): Promise<CalendarStatus> {
    this.credentials = null
    this.lastError = ''
    await this.write()
    return this.status()
  }

  async events(): Promise<CalendarEvent[]> {
    const accessToken = await this.accessToken()
    const query = new URLSearchParams({
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '20'
    })
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!response.ok) throw new Error('Could not load upcoming Google Calendar events.')
    const data = (await response.json()) as { items?: GoogleCalendarEvent[] }
    return (data.items || [])
      .map(normalizeCalendarEvent)
      .filter((event): event is CalendarEvent => Boolean(event))
  }

  private async accessToken(): Promise<string> {
    if (!this.credentials) throw new Error('Connect Google Calendar first.')
    if (this.credentials.accessToken && this.credentials.expiresAt > Date.now() + 60_000) {
      return this.credentials.accessToken
    }
    if (!this.credentials.refreshToken) throw new Error('Reconnect Google Calendar.')
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token'
      })
    })
    if (!response.ok) throw new Error('Google Calendar access expired. Reconnect it.')
    const token = (await response.json()) as { access_token: string; expires_in: number }
    this.credentials.accessToken = token.access_token
    this.credentials.expiresAt = Date.now() + token.expires_in * 1000
    await this.write()
    return token.access_token
  }

  private async fetchAccountEmail(accessToken: string): Promise<string> {
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!response.ok) return 'Google Calendar'
    const result = (await response.json()) as { summary?: string; id?: string }
    return result.summary || result.id || 'Google Calendar'
  }

  private async read(): Promise<CalendarCredentials | null> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as {
        encrypted: boolean
        value: string
      }
      const json =
        value.encrypted && safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(value.value, 'base64'))
          : value.value
      return JSON.parse(json) as CalendarCredentials
    } catch {
      return null
    }
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const json = JSON.stringify(this.credentials)
    const encrypted = safeStorage.isEncryptionAvailable()
    await writeFile(
      this.path,
      JSON.stringify({
        encrypted,
        value: encrypted ? safeStorage.encryptString(json).toString('base64') : json
      }),
      'utf8'
    )
  }
}
