import { app } from 'electron'
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AppSettings,
  HistoryItem,
  MeetingRecord,
  ProviderConfig,
  ProviderId,
  SyncStatus
} from '../shared/types'

type SyncedProvider = Omit<ProviderConfig, 'apiKey'>
type SyncedSettings = Omit<AppSettings, 'providers'> & {
  providers: Record<ProviderId, SyncedProvider>
}

export interface SharedContext {
  version: 1
  revision: string
  updatedAt: number
  deviceId: string
  settings: SyncedSettings
  history: HistoryItem[]
  meetings: MeetingRecord[]
}

interface SyncPreferences {
  enabled: boolean
  folderPath: string
  deviceId: string
  lastSyncedAt: number
  lastRevision: string
}

export interface SyncStore {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings, notify?: boolean): Promise<AppSettings>
  getHistory(): Promise<HistoryItem[]>
  replaceHistory(history: HistoryItem[], notify?: boolean): Promise<void>
  getMeetings(): Promise<MeetingRecord[]>
  replaceMeetings(meetings: MeetingRecord[], notify?: boolean): Promise<void>
  getLocalUpdatedAt(): Promise<number>
}

const defaultPreferences: SyncPreferences = {
  enabled: false,
  folderPath: '',
  deviceId: '',
  lastSyncedAt: 0,
  lastRevision: ''
}

export function stripSecrets(settings: AppSettings): SyncedSettings {
  const providers = {} as Record<ProviderId, SyncedProvider>
  for (const id of Object.keys(settings.providers) as ProviderId[]) {
    const { apiKey: _apiKey, ...provider } = settings.providers[id]
    providers[id] = provider
  }
  return { ...settings, providers }
}

export function restoreSecrets(
  settings: SyncedSettings,
  local: AppSettings
): AppSettings {
  const providers = {} as AppSettings['providers']
  for (const id of Object.keys(local.providers) as ProviderId[]) {
    providers[id] = {
      ...local.providers[id],
      ...settings.providers[id],
      apiKey: local.providers[id].apiKey
    }
  }
  return { ...settings, providers }
}

function mergeVocabulary(local: string, remote: string): string {
  const lines = [...remote.split('\n'), ...local.split('\n')]
    .map((line) => line.trim())
    .filter(Boolean)
  const unique = new Map<string, string>()
  for (const line of lines) {
    const key = line.split('—')[0].trim().toLocaleUpperCase()
    unique.set(key, line)
  }
  return [...unique.values()].slice(-200).join('\n')
}

export function mergeSharedContexts(
  local: SharedContext,
  remote: SharedContext
): SharedContext {
  const localWins = local.updatedAt >= remote.updatedAt
  const winner = localWins ? local : remote
  const loser = localWins ? remote : local
  const settings: SyncedSettings = {
    ...loser.settings,
    ...winner.settings,
    providers: {
      ...loser.settings.providers,
      ...winner.settings.providers
    },
    modes: {
      ...loser.settings.modes,
      ...winner.settings.modes
    },
    vocabulary: mergeVocabulary(
      local.settings.vocabulary,
      remote.settings.vocabulary
    )
  }
  const history = new Map<string, HistoryItem>()
  for (const item of [...remote.history, ...local.history]) history.set(item.id, item)
  const meetings = new Map<string, MeetingRecord>()
  for (const item of [...(remote.meetings || []), ...(local.meetings || [])]) {
    meetings.set(item.id, item)
  }

  return {
    version: 1,
    revision: crypto.randomUUID(),
    updatedAt: Date.now(),
    deviceId: local.deviceId,
    settings,
    history: [...history.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 250),
    meetings: [...meetings.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
  }
}

export class SyncManager {
  private preferencesPath: string
  private preferences: SyncPreferences = { ...defaultPreferences }
  private state: SyncStatus['state'] = 'off'
  private lastError = ''
  private timer: NodeJS.Timeout | null = null
  private scheduled: NodeJS.Timeout | null = null
  private inFlight: Promise<SyncStatus> | null = null

  constructor(
    private readonly store: SyncStore,
    private readonly onStatus: (status: SyncStatus) => void,
    private readonly onContextApplied: (settings: AppSettings) => void,
    preferencesPath?: string
  ) {
    this.preferencesPath =
      preferencesPath || join(app.getPath('userData'), 'sync.json')
  }

  async start(): Promise<void> {
    this.preferences = await this.readPreferences()
    if (!this.preferences.deviceId) {
      this.preferences.deviceId = crypto.randomUUID()
      await this.writePreferences()
    }
    if (!this.preferences.enabled || !this.preferences.folderPath) return
    this.startPolling()
    await this.syncNow()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.scheduled) clearTimeout(this.scheduled)
    this.timer = null
    this.scheduled = null
  }

  getStatus(): SyncStatus {
    return {
      enabled: this.preferences.enabled,
      folderPath: this.preferences.folderPath,
      state: this.preferences.enabled ? this.state : 'off',
      lastSyncedAt: this.preferences.lastSyncedAt,
      lastError: this.lastError
    }
  }

  async setFolder(folderPath: string): Promise<SyncStatus> {
    this.preferences = {
      ...this.preferences,
      enabled: true,
      folderPath,
      lastSyncedAt: 0,
      lastRevision: ''
    }
    this.lastError = ''
    await this.writePreferences()
    this.startPolling()
    return this.syncNow()
  }

  async disable(): Promise<SyncStatus> {
    this.stop()
    this.preferences.enabled = false
    this.state = 'off'
    this.lastError = ''
    await this.writePreferences()
    this.emit()
    return this.getStatus()
  }

  schedule(): void {
    if (!this.preferences.enabled) return
    if (this.scheduled) clearTimeout(this.scheduled)
    this.scheduled = setTimeout(() => {
      this.scheduled = null
      void this.syncNow()
    }, 750)
  }

  syncNow(): Promise<SyncStatus> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async performSync(): Promise<SyncStatus> {
    if (!this.preferences.enabled || !this.preferences.folderPath) {
      return this.getStatus()
    }
    this.state = 'syncing'
    this.lastError = ''
    this.emit()

    try {
      const localSettings = await this.store.getSettings()
      const localHistory = await this.store.getHistory()
      const localMeetings = await this.store.getMeetings()
      const localUpdatedAt = await this.store.getLocalUpdatedAt()
      const remote = await this.readSharedContext()
      const local: SharedContext = {
        version: 1,
        revision: crypto.randomUUID(),
        updatedAt: localUpdatedAt || Date.now(),
        deviceId: this.preferences.deviceId,
        settings: stripSecrets(localSettings),
        history: localHistory,
        meetings: localMeetings
      }
      const localChanged = localUpdatedAt > this.preferences.lastSyncedAt
      const remoteChanged = Boolean(
        remote && remote.revision !== this.preferences.lastRevision
      )

      let context = local
      if (remote && remoteChanged && !localChanged) {
        context = remote
        const restored = restoreSecrets(remote.settings, localSettings)
        await this.store.saveSettings(restored, false)
        await this.store.replaceHistory(remote.history)
        await this.store.replaceMeetings(remote.meetings || [])
        this.onContextApplied(restored)
      } else if (remote && remoteChanged && localChanged) {
        context = mergeSharedContexts(local, remote)
        const restored = restoreSecrets(context.settings, localSettings)
        await this.store.saveSettings(restored, false)
        await this.store.replaceHistory(context.history)
        await this.store.replaceMeetings(context.meetings || [])
        await this.writeSharedContext(context)
        this.onContextApplied(restored)
      } else if (!remote || localChanged) {
        context = {
          ...local,
          revision: crypto.randomUUID(),
          updatedAt: Date.now()
        }
        await this.writeSharedContext(context)
      } else {
        context = remote
      }

      this.preferences.lastSyncedAt = Date.now()
      this.preferences.lastRevision = context.revision
      await this.writePreferences()
      this.state = 'synced'
    } catch (error) {
      this.state = 'error'
      this.lastError =
        error instanceof Error ? error.message : 'Could not synchronize context.'
    }
    this.emit()
    return this.getStatus()
  }

  private startPolling(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.syncNow(), 10_000)
  }

  private sharedPath(): string {
    return join(this.preferences.folderPath, 'Dictalume', 'context.json')
  }

  private legacySharedPath(): string {
    return join(this.preferences.folderPath, 'WhisperType', 'context.json')
  }

  private async readSharedContext(): Promise<SharedContext | null> {
    try {
      const parsed = JSON.parse(
        await readFile(this.sharedPath(), 'utf8')
      ) as SharedContext
      return parsed.version === 1 ? { ...parsed, meetings: parsed.meetings || [] } : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          const legacy = JSON.parse(
            await readFile(this.legacySharedPath(), 'utf8')
          ) as SharedContext
          return legacy.version === 1
            ? { ...legacy, meetings: legacy.meetings || [] }
            : null
        } catch (legacyError) {
          if ((legacyError as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw legacyError
        }
      }
      throw error
    }
  }

  private async writeSharedContext(context: SharedContext): Promise<void> {
    const target = this.sharedPath()
    const temp = `${target}.${this.preferences.deviceId}.tmp`
    await mkdir(join(this.preferences.folderPath, 'Dictalume'), {
      recursive: true
    })
    await writeFile(temp, JSON.stringify(context, null, 2), 'utf8')
    await copyFile(temp, target)
    await unlink(temp).catch(() => undefined)
  }

  private async readPreferences(): Promise<SyncPreferences> {
    try {
      return {
        ...defaultPreferences,
        ...(JSON.parse(
          await readFile(this.preferencesPath, 'utf8')
        ) as Partial<SyncPreferences>)
      }
    } catch {
      return { ...defaultPreferences }
    }
  }

  private async writePreferences(): Promise<void> {
    await mkdir(dirname(this.preferencesPath), { recursive: true })
    await writeFile(
      this.preferencesPath,
      JSON.stringify(this.preferences, null, 2),
      'utf8'
    )
  }

  private emit(): void {
    this.onStatus(this.getStatus())
  }
}
