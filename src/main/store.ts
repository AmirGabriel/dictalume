import { app, safeStorage } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  defaultSettings,
  migrateBuiltInModePrompt,
  migrateGrokCleanupModel
} from './defaults'
import { automaticHistoryTitle } from './historyTitle'
import { sanitizeMeetingSpaces } from '../shared/meetingSpaces'
import type {
  ApiUsageEvent,
  ApiUsageSummary,
  AppSettings,
  HistoryItem,
  MeetingRecord,
  ProviderId
} from '../shared/types'

type StoredProvider = Omit<AppSettings['providers'][ProviderId], 'apiKey'> & {
  apiKey: string
  encrypted?: boolean
}

type StoredSettings = Omit<AppSettings, 'providers'> & {
  providers: Record<ProviderId, StoredProvider>
}

export class AppStore {
  private settingsPath = join(app.getPath('userData'), 'settings.json')
  private historyPath = join(app.getPath('userData'), 'history.json')
  private meetingsPath = join(app.getPath('userData'), 'meetings.json')
  private usagePath = join(app.getPath('userData'), 'api-usage.json')
  private changeListener: (() => void) | null = null

  setChangeListener(listener: () => void): void {
    this.changeListener = listener
  }

  async getSettings(): Promise<AppSettings> {
    try {
      const stored = JSON.parse(await readFile(this.settingsPath, 'utf8')) as StoredSettings
      const providers = structuredClone(defaultSettings.providers)

      for (const id of Object.keys(providers) as ProviderId[]) {
        const saved = stored.providers?.[id]
        if (!saved) continue
        providers[id] = {
          ...providers[id],
          ...saved,
          apiKey: this.decrypt(saved.apiKey, saved.encrypted),
          ...(id === 'grok'
            ? { cleanupModel: migrateGrokCleanupModel(saved.cleanupModel) }
            : {})
        }
      }

      const savedModes = stored.modes || {}
      const modes = { ...structuredClone(defaultSettings.modes) }
      for (const [id, savedMode] of Object.entries(savedModes)) {
        const fallback = modes[id] || {
          id,
          name: 'Custom mode',
          description: '',
          prompt: '',
          cleanup: true,
          context: { application: false, clipboard: false, selectedText: false },
          activateFor: []
        }
        modes[id] = {
          ...fallback,
          ...savedMode,
          prompt: migrateBuiltInModePrompt(id, savedMode.prompt || fallback.prompt),
          context: { ...fallback.context, ...savedMode.context },
          activateFor: savedMode.activateFor || []
        }
      }

      return {
        ...structuredClone(defaultSettings),
        ...stored,
        providers,
        modes,
        meetingSpaces: sanitizeMeetingSpaces(stored.meetingSpaces || [])
      }
    } catch {
      return structuredClone(defaultSettings)
    }
  }

  async saveSettings(settings: AppSettings, notify = true): Promise<AppSettings> {
    const providers = {} as Record<ProviderId, StoredProvider>
    for (const id of Object.keys(settings.providers) as ProviderId[]) {
      const provider = settings.providers[id]
      const encrypted = safeStorage.isEncryptionAvailable() && Boolean(provider.apiKey)
      providers[id] = {
        ...provider,
        apiKey: encrypted
          ? safeStorage.encryptString(provider.apiKey).toString('base64')
          : provider.apiKey,
        encrypted
      }
    }

    await this.writeJson(this.settingsPath, { ...settings, providers })
    if (notify) this.changeListener?.()
    return settings
  }

  async getHistory(): Promise<HistoryItem[]> {
    try {
      const history = JSON.parse(
        await readFile(this.historyPath, 'utf8')
      ) as HistoryItem[]
      return history.map((item) => ({
        ...item,
        title:
          item.title?.trim() ||
          automaticHistoryTitle(item.text || item.rawText || '')
      }))
    } catch {
      return []
    }
  }

  async addHistory(item: HistoryItem): Promise<void> {
    const history = await this.getHistory()
    history.unshift(item)
    await this.writeJson(this.historyPath, history.slice(0, 250))
    this.changeListener?.()
  }

  async deleteHistory(id: string): Promise<void> {
    const history = await this.getHistory()
    await this.writeJson(
      this.historyPath,
      history.filter((item) => item.id !== id)
    )
    this.changeListener?.()
  }

  async clearHistory(): Promise<void> {
    await this.writeJson(this.historyPath, [])
    this.changeListener?.()
  }

  async getMeetings(): Promise<MeetingRecord[]> {
    try {
      return JSON.parse(await readFile(this.meetingsPath, 'utf8')) as MeetingRecord[]
    } catch {
      return []
    }
  }

  async addMeeting(item: MeetingRecord): Promise<void> {
    const meetings = await this.getMeetings()
    meetings.unshift(item)
    await this.writeJson(this.meetingsPath, meetings.slice(0, 100))
    this.changeListener?.()
  }

  async deleteMeeting(id: string): Promise<void> {
    const meetings = await this.getMeetings()
    await this.writeJson(
      this.meetingsPath,
      meetings.filter((item) => item.id !== id)
    )
    this.changeListener?.()
  }

  async updateMeeting(item: MeetingRecord): Promise<void> {
    const meetings = await this.getMeetings()
    const index = meetings.findIndex((meeting) => meeting.id === item.id)
    if (index === -1) throw new Error('Meeting not found.')
    meetings[index] = item
    await this.writeJson(this.meetingsPath, meetings.slice(0, 100))
    this.changeListener?.()
  }

  async getUsageEvents(): Promise<ApiUsageEvent[]> {
    try {
      return JSON.parse(await readFile(this.usagePath, 'utf8')) as ApiUsageEvent[]
    } catch {
      return []
    }
  }

  async addUsage(event: ApiUsageEvent): Promise<ApiUsageSummary> {
    const events = await this.getUsageEvents()
    events.unshift(event)
    await this.writeJson(this.usagePath, events.slice(0, 2_000))
    this.changeListener?.()
    return this.getUsageSummary(events)
  }

  async replaceUsage(events: ApiUsageEvent[], notify = false): Promise<void> {
    await this.writeJson(this.usagePath, events.slice(0, 2_000))
    if (notify) this.changeListener?.()
  }

  async getUsageSummary(existing?: ApiUsageEvent[]): Promise<ApiUsageSummary> {
    const events = existing || await this.getUsageEvents()
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const priced = events.filter(
      (event): event is ApiUsageEvent & { costUsd: number } => event.costUsd !== null
    )
    return {
      totalUsd: priced.reduce((sum, event) => sum + event.costUsd, 0),
      monthUsd: priced
        .filter((event) => event.createdAt >= monthStart.getTime())
        .reduce((sum, event) => sum + event.costUsd, 0),
      exactUsd: priced
        .filter((event) => event.exact)
        .reduce((sum, event) => sum + event.costUsd, 0),
      estimatedUsd: priced
        .filter((event) => !event.exact)
        .reduce((sum, event) => sum + event.costUsd, 0),
      unpricedRequests: events.filter((event) => event.costUsd === null).length,
      events: events.slice(0, 20)
    }
  }

  async replaceMeetings(meetings: MeetingRecord[], notify = false): Promise<void> {
    await this.writeJson(this.meetingsPath, meetings.slice(0, 100))
    if (notify) this.changeListener?.()
  }

  async replaceHistory(history: HistoryItem[], notify = false): Promise<void> {
    await this.writeJson(this.historyPath, history.slice(0, 250))
    if (notify) this.changeListener?.()
  }

  async getLocalUpdatedAt(): Promise<number> {
    const timestamps = await Promise.all(
      [this.settingsPath, this.historyPath, this.meetingsPath, this.usagePath].map(async (path) => {
        try {
          return (await stat(path)).mtimeMs
        } catch {
          return 0
        }
      })
    )
    return Math.max(...timestamps)
  }

  private decrypt(value: string, encrypted?: boolean): string {
    if (!value || !encrypted) return value || ''
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return ''
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
  }
}
