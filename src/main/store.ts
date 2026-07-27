import { app, safeStorage } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defaultSettings } from './defaults'
import type { AppSettings, HistoryItem, MeetingRecord, ProviderId } from '../shared/types'

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
          apiKey: this.decrypt(saved.apiKey, saved.encrypted)
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
          context: { ...fallback.context, ...savedMode.context },
          activateFor: savedMode.activateFor || []
        }
      }

      return {
        ...structuredClone(defaultSettings),
        ...stored,
        providers,
        modes
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
      return JSON.parse(await readFile(this.historyPath, 'utf8')) as HistoryItem[]
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
      [this.settingsPath, this.historyPath, this.meetingsPath].map(async (path) => {
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
