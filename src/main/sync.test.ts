import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import {
  mergeSharedContexts,
  restoreSecrets,
  SyncManager,
  stripSecrets,
  type SharedContext,
  type SyncStore
} from './sync'
import type { AppSettings, HistoryItem, MeetingRecord } from '../shared/types'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  )
})

class MemoryStore implements SyncStore {
  updatedAt = Date.now()

  constructor(
    public settings: AppSettings,
    public history: HistoryItem[],
    public meetings: MeetingRecord[] = []
  ) {}

  async getSettings(): Promise<AppSettings> {
    return structuredClone(this.settings)
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    this.settings = structuredClone(settings)
    this.updatedAt = Date.now()
    return settings
  }

  async getHistory(): Promise<HistoryItem[]> {
    return structuredClone(this.history)
  }

  async replaceHistory(history: HistoryItem[]): Promise<void> {
    this.history = structuredClone(history)
    this.updatedAt = Date.now()
  }

  async getMeetings(): Promise<MeetingRecord[]> {
    return structuredClone(this.meetings)
  }

  async replaceMeetings(meetings: MeetingRecord[]): Promise<void> {
    this.meetings = structuredClone(meetings)
    this.updatedAt = Date.now()
  }

  async getLocalUpdatedAt(): Promise<number> {
    return this.updatedAt
  }
}

function context(
  deviceId: string,
  updatedAt: number,
  vocabulary: string,
  historyId: string
): SharedContext {
  const settings = structuredClone(defaultSettings)
  settings.vocabulary = vocabulary
  return {
    version: 1,
    revision: `${deviceId}-revision`,
    updatedAt,
    deviceId,
    settings: stripSecrets(settings),
    history: [
      {
        id: historyId,
        text: historyId,
        rawText: historyId,
        createdAt: updatedAt,
        durationMs: 1000,
        provider: 'openai',
        mode: 'dictation',
        language: 'auto'
      }
    ],
    meetings: []
  }
}

describe('cross-device context sync', () => {
  it('never includes API keys in shared settings and restores the local key', () => {
    const local = structuredClone(defaultSettings)
    local.providers.openai.apiKey = 'device-secret'
    const shared = stripSecrets(local)

    expect(shared.providers.openai).not.toHaveProperty('apiKey')
    const restored = restoreSecrets(shared, local)
    expect(restored.providers.openai.apiKey).toBe('device-secret')
  })

  it('merges writing memory and history from both computers', () => {
    const mac = context('mac', 200, 'NIX — learned on Mac', 'mac-history')
    const windows = context(
      'windows',
      100,
      'KLABIN — learned on Windows',
      'windows-history'
    )
    const merged = mergeSharedContexts(mac, windows)

    expect(merged.settings.vocabulary).toContain('NIX')
    expect(merged.settings.vocabulary).toContain('KLABIN')
    expect(merged.history.map((item) => item.id)).toEqual([
      'mac-history',
      'windows-history'
    ])
  })

  it('keeps meeting notes available on both computers', () => {
    const mac = context('mac', 200, '', 'mac-history')
    const windows = context('windows', 100, '', 'windows-history')
    mac.meetings = [
      {
        id: 'meeting-1',
        title: 'Product weekly',
        source: 'google-meet',
        createdAt: 200,
        durationMs: 3_600_000,
        transcript: 'Full transcript',
        notes: 'Decisions and actions',
        provider: 'openai'
      }
    ]

    expect(mergeSharedContexts(windows, mac).meetings[0]?.id).toBe('meeting-1')
  })

  it('uses the latest scalar preferences while preserving unique modes', () => {
    const mac = context('mac', 200, '', 'mac-history')
    const windows = context('windows', 100, '', 'windows-history')
    mac.settings.language = 'pt'
    windows.settings.language = 'en'
    windows.settings.modes.windowsOnly = {
      ...windows.settings.modes.dictation,
      id: 'windowsOnly',
      name: 'Windows only'
    }

    const merged = mergeSharedContexts(mac, windows)
    expect(merged.settings.language).toBe('pt')
    expect(merged.settings.modes.windowsOnly.name).toBe('Windows only')
  })

  it('round-trips context between two device stores through one shared folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dictalume-sync-'))
    temporaryDirectories.push(root)
    const macSettings = structuredClone(defaultSettings)
    macSettings.vocabulary = 'NIX — learned on Mac'
    const windowsSettings = structuredClone(defaultSettings)
    windowsSettings.vocabulary = 'KLABIN — learned on Windows'
    const macStore = new MemoryStore(macSettings, context('mac', 200, '', 'mac').history)
    const windowsStore = new MemoryStore(
      windowsSettings,
      context('windows', 100, '', 'windows').history
    )
    const macSync = new SyncManager(
      macStore,
      () => undefined,
      () => undefined,
      join(root, 'mac-preferences.json')
    )
    const windowsSync = new SyncManager(
      windowsStore,
      () => undefined,
      () => undefined,
      join(root, 'windows-preferences.json')
    )

    await macSync.start()
    await macSync.setFolder(root)
    await windowsSync.start()
    await windowsSync.setFolder(root)
    await macSync.syncNow()
    macSync.stop()
    windowsSync.stop()

    expect(macStore.settings.vocabulary).toContain('NIX')
    expect(macStore.settings.vocabulary).toContain('KLABIN')
    expect(windowsStore.settings.vocabulary).toBe(macStore.settings.vocabulary)
    expect(macStore.history.map((item) => item.id).sort()).toEqual([
      'mac',
      'windows'
    ])
  })

  it('imports the legacy shared context into the renamed folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dictalume-legacy-sync-'))
    temporaryDirectories.push(root)
    const preferencesPath = join(root, 'preferences.json')
    const legacy = context('legacy-device', 200, 'NIX — legacy memory', 'legacy-history')
    await mkdir(join(root, 'WhisperType'))
    await writeFile(
      join(root, 'WhisperType', 'context.json'),
      JSON.stringify(legacy)
    )
    await writeFile(
      preferencesPath,
      JSON.stringify({
        enabled: true,
        folderPath: root,
        deviceId: 'dictalume-device',
        lastSyncedAt: 0,
        lastRevision: ''
      })
    )
    const store = new MemoryStore(structuredClone(defaultSettings), [])
    const sync = new SyncManager(
      store,
      () => undefined,
      () => undefined,
      preferencesPath
    )

    await sync.start()
    sync.stop()

    expect(store.settings.vocabulary).toContain('NIX')
    await expect(access(join(root, 'Dictalume', 'context.json'))).resolves.toBeUndefined()
  })
})
