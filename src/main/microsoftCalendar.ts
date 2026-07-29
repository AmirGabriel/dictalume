import { app, safeStorage, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CalendarEvent, CalendarStatus } from '../shared/types'
import {
  normalizeMicrosoftCalendarEvent,
  type MicrosoftCalendarEvent
} from './microsoftCalendarEvents'

interface MicrosoftCalendarCredentials {
  clientId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountEmail: string
}

const scope = 'offline_access User.Read Calendars.Read'
const authorizeEndpoint =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const tokenEndpoint =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token'

function base64url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class MicrosoftCalendarManager {
  private path = join(app.getPath('userData'), 'outlook-calendar.json')
  private credentials: MicrosoftCalendarCredentials | null = null
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
    if (!clientId.trim()) throw new Error('Paste a Microsoft OAuth application client ID.')
    this.lastError = ''
    const verifier = base64url(randomBytes(48))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(24))

    const result = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = createServer((request, response) => {
        const redirectUri = `http://localhost:${(server.address() as { port: number }).port}`
        const url = new URL(request.url || '/', redirectUri)
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          '<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:16px -apple-system;padding:48px;color:#1d1d1f}main{max-width:520px;margin:auto}h1{font-size:28px}</style><main><h1>Outlook Calendar connected</h1><p>You can close this window and return to Dictalume.</p></main>'
        )
        server.close()
        if (!code || returnedState !== state) {
          reject(new Error('Microsoft did not return a valid authorization code.'))
        } else {
          resolve({ code, redirectUri })
        }
      })
      server.on('error', reject)
      server.listen(0, 'localhost', () => {
        const redirectUri = `http://localhost:${(server.address() as { port: number }).port}`
        const authorize = new URL(authorizeEndpoint)
        authorize.search = new URLSearchParams({
          client_id: clientId.trim(),
          redirect_uri: redirectUri,
          response_type: 'code',
          response_mode: 'query',
          scope,
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256'
        }).toString()
        void shell.openExternal(authorize.toString())
      })
      setTimeout(() => {
        server.close()
        reject(new Error('Microsoft Calendar authorization timed out.'))
      }, 180_000)
    })

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId.trim(),
        code: result.code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: result.redirectUri,
        scope
      })
    })
    if (!response.ok) throw new Error('Microsoft rejected the calendar connection.')
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
    const startDateTime = new Date().toISOString()
    const endDateTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const query = new URLSearchParams({
      startDateTime,
      endDateTime,
      '$top': '20',
      '$orderby': 'start/dateTime',
      '$select':
        'id,seriesMasterId,subject,bodyPreview,start,end,onlineMeeting,onlineMeetingUrl,location,attendees'
    })
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?${query}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"'
        }
      }
    )
    if (!response.ok) throw new Error('Could not load upcoming Outlook Calendar events.')
    const data = (await response.json()) as { value?: MicrosoftCalendarEvent[] }
    return (data.value || [])
      .map(normalizeMicrosoftCalendarEvent)
      .filter((event): event is CalendarEvent => Boolean(event))
  }

  private async accessToken(): Promise<string> {
    if (!this.credentials) throw new Error('Connect Outlook Calendar first.')
    if (this.credentials.accessToken && this.credentials.expiresAt > Date.now() + 60_000) {
      return this.credentials.accessToken
    }
    if (!this.credentials.refreshToken) throw new Error('Reconnect Outlook Calendar.')
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token',
        scope
      })
    })
    if (!response.ok) throw new Error('Microsoft Calendar access expired. Reconnect it.')
    const token = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }
    this.credentials.accessToken = token.access_token
    this.credentials.refreshToken =
      token.refresh_token || this.credentials.refreshToken
    this.credentials.expiresAt = Date.now() + token.expires_in * 1000
    await this.write()
    return token.access_token
  }

  private async fetchAccountEmail(accessToken: string): Promise<string> {
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!response.ok) return 'Outlook Calendar'
    const result = (await response.json()) as {
      displayName?: string
      mail?: string
      userPrincipalName?: string
    }
    return result.mail || result.userPrincipalName || result.displayName || 'Outlook Calendar'
  }

  private async read(): Promise<MicrosoftCalendarCredentials | null> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as {
        encrypted: boolean
        value: string
      }
      const json =
        value.encrypted && safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(value.value, 'base64'))
          : value.value
      return JSON.parse(json) as MicrosoftCalendarCredentials
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
