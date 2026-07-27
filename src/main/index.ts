import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  type OpenDialogOptions
} from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppStore } from './store'
import { SyncManager } from './sync'
import { copyText, pasteFromClipboard } from './paste'
import { createMeetingNotes, transcribeAudio } from './providers'
import { mergeVocabulary } from './memory'
import { captureContext, getFrontmostApplicationName } from './context'
import { CalendarManager } from './calendar'
import { migrateLegacyUserData } from './migration'
import type {
  AppSettings,
  HistoryItem,
  MeetingRecord,
  MeetingRequest,
  TranscriptionRequest,
  TranscriptionResult
} from '../shared/types'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: AppStore
let syncManager: SyncManager
let calendarManager: CalendarManager
let activeTranscription: AbortController | null = null
let isQuitting = false
let pendingDeepLink: string | null = null
let lastDeepLink = { url: '', receivedAt: 0 }
const DEFAULT_RECORD_SHORTCUT = 'CommandOrControl+Shift+Space'
const DEFAULT_MODE_SHORTCUT = 'CommandOrControl+Option+Space'

function rendererUrl(query = ''): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}${query}`
  }
  return `file://${join(__dirname, '../renderer/index.html')}${query}`
}

async function loadRenderer(window: BrowserWindow, query = ''): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(rendererUrl(query))
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: query ? { overlay: '1' } : undefined
    })
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 820,
    minHeight: 580,
    title: 'Dictalume',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#f5f5f7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin'
      ? {
          trafficLightPosition: { x: 16, y: 16 },
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const
        }
      : { backgroundMaterial: 'mica' as const }),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', () => {
    mainWindow = null
  })
  window.once('ready-to-show', () => window.show())
  void loadRenderer(window)
  return window
}

function positionOverlay(): void {
  if (!overlayWindow) return
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const [width, height] = overlayWindow.getSize()
  overlayWindow.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    Math.round(display.workArea.y + display.workArea.height - height - 42),
    false
  )
}

function createOverlayWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 388,
    height: 100,
    minWidth: 388,
    minHeight: 100,
    maxWidth: 460,
    maxHeight: 180,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.on('closed', () => {
    overlayWindow = null
  })
  void loadRenderer(window, '?overlay=1')
  return window
}

function toggleRecording(languageOverride?: string): void {
  if (!overlayWindow) overlayWindow = createOverlayWindow()
  const trigger = (): void => {
    positionOverlay()
    overlayWindow?.showInactive()
    overlayWindow?.webContents.send('recording:toggle', languageOverride)
  }
  if (overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.once('did-finish-load', trigger)
  } else {
    trigger()
  }
}

function tryRegisterShortcut(shortcut: string, callback: () => void): {
  registered: boolean
  invalid: boolean
} {
  try {
    return {
      registered: Boolean(shortcut) && globalShortcut.register(shortcut, callback),
      invalid: false
    }
  } catch {
    return { registered: false, invalid: true }
  }
}

async function cycleMode(): Promise<void> {
  const settings = await store.getSettings()
  const ids = Object.keys(settings.modes) as Array<keyof typeof settings.modes>
  const next = ids[(ids.indexOf(settings.mode) + 1) % ids.length]
  settings.mode = next
  await store.saveSettings(settings)
  mainWindow?.webContents.send('settings:changed', settings)
  overlayWindow?.webContents.send('settings:changed', settings)
}

function registerShortcuts(settings: AppSettings): {
  recordRegistered: boolean
  repaired: boolean
} {
  globalShortcut.unregisterAll()
  let repaired = false
  let record = tryRegisterShortcut(settings.shortcut, () => toggleRecording())
  if (record.invalid) {
    settings.shortcut = DEFAULT_RECORD_SHORTCUT
    repaired = true
    record = tryRegisterShortcut(settings.shortcut, () => toggleRecording())
  }
  const recordRegistered = record.registered
  if (!recordRegistered) {
    tryRegisterShortcut(DEFAULT_RECORD_SHORTCUT, () => toggleRecording())
  }
  if (settings.changeModeShortcut) {
    const mode = tryRegisterShortcut(settings.changeModeShortcut, () => void cycleMode())
    if (mode.invalid) {
      settings.changeModeShortcut = DEFAULT_MODE_SHORTCUT
      repaired = true
      tryRegisterShortcut(settings.changeModeShortcut, () => void cycleMode())
    }
  }
  if (settings.languageShortcuts.en) {
    const english = tryRegisterShortcut(
      settings.languageShortcuts.en,
      () => toggleRecording('en')
    )
    if (english.invalid) {
      settings.languageShortcuts.en = ''
      repaired = true
    }
  }
  if (settings.languageShortcuts.pt) {
    const portuguese = tryRegisterShortcut(
      settings.languageShortcuts.pt,
      () => toggleRecording('pt')
    )
    if (portuguese.invalid) {
      settings.languageShortcuts.pt = ''
      repaired = true
    }
  }
  return { recordRegistered, repaired }
}

function updateTrayMenu(settings: AppSettings): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Start dictation', accelerator: settings.shortcut, click: () => toggleRecording() },
      {
        label: 'Mode',
        submenu: Object.values(settings.modes).map((mode) => ({
          type: 'radio' as const,
          label: mode.name,
          checked: settings.mode === mode.id,
          click: async () => {
            const next = await store.getSettings()
            next.mode = mode.id
            await store.saveSettings(next)
            updateTrayMenu(next)
            mainWindow?.webContents.send('settings:changed', next)
            overlayWindow?.webContents.send('settings:changed', next)
          }
        }))
      },
      { type: 'separator' },
      { label: 'Open Dictalume', click: () => showMainWindow() },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(settings: AppSettings): void {
  const trayColor = process.platform === 'darwin' ? 'black' : '#f35412'
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="${trayColor}" d="M9 2a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Zm-5 7a1 1 0 1 1 2 0 3 3 0 0 0 6 0 1 1 0 1 1 2 0 5 5 0 0 1-4 4.9V16h2a1 1 0 1 1 0 2H6a1 1 0 1 1 0-2h2v-2.1A5 5 0 0 1 4 9Z"/></svg>`
  )
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml,${svg}`)
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Dictalume')
  updateTrayMenu(settings)
  tray.on('click', () => showMainWindow())
}

function showMainWindow(): void {
  if (!mainWindow) mainWindow = createMainWindow()
  mainWindow.show()
  mainWindow.focus()
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => {
    const previous = await store.getSettings()
    let saved = await store.saveSettings(settings)
    if (
      previous.shortcut !== saved.shortcut ||
      previous.changeModeShortcut !== saved.changeModeShortcut ||
      previous.languageShortcuts.en !== saved.languageShortcuts.en ||
      previous.languageShortcuts.pt !== saved.languageShortcuts.pt
    ) {
      const registration = registerShortcuts(saved)
      if (registration.repaired) saved = await store.saveSettings(saved)
    }
    app.setLoginItemSettings({ openAtLogin: saved.launchAtLogin })
    updateTrayMenu(saved)
    mainWindow?.webContents.send('settings:changed', saved)
    overlayWindow?.webContents.send('settings:changed', saved)
    return saved
  })
  ipcMain.handle('history:get', () => store.getHistory())
  ipcMain.handle('history:clear', () => store.clearHistory())
  ipcMain.handle('history:delete', (_event, id: string) => store.deleteHistory(id))
  ipcMain.handle('clipboard:copy', (_event, text: string) => copyText(text))
  ipcMain.handle('recording:cancel', () => {
    activeTranscription?.abort()
    activeTranscription = null
    overlayWindow?.hide()
  })
  ipcMain.handle('shortcuts:capture-active', async (_event, active: boolean) => {
    if (active) {
      globalShortcut.unregisterAll()
      return
    }
    const settings = await store.getSettings()
    const registration = registerShortcuts(settings)
    if (registration.repaired) await store.saveSettings(settings)
  })
  ipcMain.handle('window:show-main', () => showMainWindow())
  ipcMain.handle('sync:status', () => syncManager.getStatus())
  ipcMain.handle('sync:choose-folder', async () => {
    const options: OpenDialogOptions = {
      title: 'Choose a shared sync folder',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const selected = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (selected.canceled || !selected.filePaths[0]) return syncManager.getStatus()
    return syncManager.setFolder(selected.filePaths[0])
  })
  ipcMain.handle('sync:now', () => syncManager.syncNow())
  ipcMain.handle('sync:disable', () => syncManager.disable())
  ipcMain.handle('meetings:get', () => store.getMeetings())
  ipcMain.handle('meetings:delete', async (_event, id: string) => {
    await store.deleteMeeting(id)
    mainWindow?.webContents.send('meetings:changed')
  })
  ipcMain.handle('meetings:capture-support', () => {
    if (process.platform === 'win32') {
      return {
        platform: 'windows',
        systemAudio: 'supported',
        detail: 'Microphone and computer audio are recorded together.'
      }
    }
    if (process.platform === 'darwin') {
      return {
        platform: 'mac',
        systemAudio: 'system-picker',
        detail:
          'Choose the meeting window in the macOS share picker and enable audio. macOS 15 or later is recommended.'
      }
    }
    return {
      platform: 'other',
      systemAudio: 'unavailable',
      detail: 'Microphone recording works, but computer audio is not available on this platform.'
    }
  })
  ipcMain.handle('calendar:status', () => calendarManager.status())
  ipcMain.handle('calendar:connect', (_event, clientId: string) =>
    calendarManager.connect(clientId)
  )
  ipcMain.handle('calendar:disconnect', () => calendarManager.disconnect())
  ipcMain.handle('calendar:events', () => calendarManager.events())
  ipcMain.handle('external:open', (_event, url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') throw new Error('Only secure links can be opened.')
    return shell.openExternal(parsed.toString())
  })
  ipcMain.handle(
    'meetings:save',
    async (_event, request: MeetingRequest): Promise<MeetingRecord> => {
      if (request.segments.length === 0) throw new Error('No meeting audio was recorded.')
      const settings = await store.getSettings()
      activeTranscription?.abort()
      activeTranscription = new AbortController()
      try {
        const transcriptParts: string[] = []
        const learnedVocabulary: string[] = []
        for (const segment of request.segments) {
          const result = await transcribeAudio(
            new Uint8Array(segment.audio),
            segment.mimeType,
            { ...settings, mode: 'raw' },
            undefined,
            activeTranscription.signal
          )
          transcriptParts.push(result.rawText)
          learnedVocabulary.push(...result.learnedVocabulary)
        }
        const transcript = transcriptParts.join('\n\n').trim()
        const notes = await createMeetingNotes(
          transcript,
          settings,
          request.title,
          activeTranscription.signal
        )
        if (learnedVocabulary.length > 0) {
          settings.vocabulary = mergeVocabulary(settings.vocabulary, learnedVocabulary)
          await store.saveSettings(settings)
          mainWindow?.webContents.send('settings:changed', settings)
          overlayWindow?.webContents.send('settings:changed', settings)
        }
        const meeting: MeetingRecord = {
          id: crypto.randomUUID(),
          title: request.title.trim() || 'Untitled meeting',
          source: request.source,
          createdAt: request.startedAt,
          durationMs: request.durationMs,
          transcript,
          notes,
          provider: settings.provider
        }
        await store.addMeeting(meeting)
        mainWindow?.webContents.send('meetings:changed')
        return meeting
      } finally {
        activeTranscription = null
      }
    }
  )
  ipcMain.handle('context:capture', async () => {
    const settings = await store.getSettings()
    const frontmost = await getFrontmostApplicationName()
    if (frontmost) {
      const automatic = Object.values(settings.modes).find((mode) =>
        mode.activateFor.some((appName) =>
          frontmost.toLocaleLowerCase().includes(appName.toLocaleLowerCase())
        )
      )
      if (automatic && automatic.id !== settings.mode) {
        settings.mode = automatic.id
        await store.saveSettings(settings)
        updateTrayMenu(settings)
        mainWindow?.webContents.send('settings:changed', settings)
        overlayWindow?.webContents.send('settings:changed', settings)
      }
    }
    return captureContext(settings)
  })
  ipcMain.handle('permissions:get', () => ({
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    accessibility:
      process.platform === 'darwin'
        ? systemPreferences.isTrustedAccessibilityClient(false)
        : true
  }))
  ipcMain.handle('permissions:microphone', async () => {
    if (process.platform === 'darwin') {
      return systemPreferences.askForMediaAccess('microphone')
    }
    await shell.openExternal('ms-settings:privacy-microphone')
    return systemPreferences.getMediaAccessStatus('microphone') === 'granted'
  })
  ipcMain.handle('permissions:accessibility', () => {
    if (process.platform === 'darwin') {
      systemPreferences.isTrustedAccessibilityClient(true)
    }
  })
  ipcMain.handle(
    'transcription:run',
    async (_event, request: TranscriptionRequest): Promise<TranscriptionResult> => {
      const settings = await store.getSettings()
      const effectiveSettings = request.languageOverride
        ? { ...settings, language: request.languageOverride }
        : settings
      activeTranscription?.abort()
      activeTranscription = new AbortController()

      try {
        const result = await transcribeAudio(
          new Uint8Array(request.audio),
          request.mimeType,
          effectiveSettings,
          request.context,
          activeTranscription.signal
        )
        const historyItem: HistoryItem = {
          id: crypto.randomUUID(),
          text: result.text,
          rawText: result.rawText,
          createdAt: Date.now(),
          durationMs: request.durationMs,
          provider: effectiveSettings.provider,
          mode: effectiveSettings.mode,
          language: effectiveSettings.language
        }
        await store.addHistory(historyItem)
        if (result.learnedVocabulary.length > 0) {
          const updated = await store.getSettings()
          updated.vocabulary = mergeVocabulary(
            updated.vocabulary,
            result.learnedVocabulary
          )
          await store.saveSettings(updated)
          mainWindow?.webContents.send('settings:changed', updated)
          overlayWindow?.webContents.send('settings:changed', updated)
        }

        if (settings.copyToClipboard || settings.autoPaste) copyText(result.text)
        let pasted = false
        if (settings.autoPaste) {
          try {
            await pasteFromClipboard()
            pasted = true
          } catch {
            pasted = false
          }
        }

        mainWindow?.webContents.send('history:changed')
        return { ...result, historyItem, pasted }
      } finally {
        activeTranscription = null
      }
    }
  )
  ipcMain.handle(
    'transcription:file',
    async (): Promise<TranscriptionResult | null> => {
      const options: OpenDialogOptions = {
        title: 'Transcribe an audio or video file',
        properties: ['openFile'],
        filters: [
          {
            name: 'Audio and video',
            extensions: ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'ogg', 'mpeg', 'mov']
          }
        ]
      }
      const selected = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (selected.canceled || !selected.filePaths[0]) return null
      const path = selected.filePaths[0]
      const extension = path.split('.').pop()?.toLowerCase()
      const mimeTypes: Record<string, string> = {
        mp3: 'audio/mpeg',
        mpeg: 'audio/mpeg',
        mp4: 'audio/mp4',
        m4a: 'audio/mp4',
        wav: 'audio/wav',
        webm: 'audio/webm',
        ogg: 'audio/ogg',
        mov: 'video/quicktime'
      }
      const settings = await store.getSettings()
      const audio = await readFile(path)
      const result = await transcribeAudio(
        new Uint8Array(audio),
        mimeTypes[extension || ''] || 'application/octet-stream',
        settings
      )
      if (result.learnedVocabulary.length > 0) {
        settings.vocabulary = mergeVocabulary(settings.vocabulary, result.learnedVocabulary)
        await store.saveSettings(settings)
        mainWindow?.webContents.send('settings:changed', settings)
        overlayWindow?.webContents.send('settings:changed', settings)
      }
      const historyItem: HistoryItem = {
        id: crypto.randomUUID(),
        text: result.text,
        rawText: result.rawText,
        createdAt: Date.now(),
        durationMs: 0,
        provider: settings.provider,
        mode: settings.mode,
        language: settings.language
      }
      await store.addHistory(historyItem)
      copyText(result.text)
      mainWindow?.webContents.send('history:changed')
      return { ...result, historyItem, pasted: false }
    }
  )
}

function handleDeepLink(url: string): void {
  const now = Date.now()
  if (lastDeepLink.url === url && now - lastDeepLink.receivedAt < 1000) return
  lastDeepLink = { url, receivedAt: now }
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'record') {
      toggleRecording()
      return
    }
    if (parsed.hostname === 'mode') {
      const mode = parsed.searchParams.get('id')
      void store.getSettings().then(async (settings) => {
        if (mode && mode in settings.modes) {
          settings.mode = mode
          await store.saveSettings(settings)
          updateTrayMenu(settings)
          mainWindow?.webContents.send('settings:changed', settings)
          overlayWindow?.webContents.send('settings:changed', settings)
        }
      })
    }
  } catch {
    // Ignore malformed external links.
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (store) handleDeepLink(url)
  else pendingDeepLink = url
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = commandLine.find(
      (value) => value.startsWith('dictalume://') || value.startsWith('whispertype://')
    )
    if (deepLink) handleDeepLink(deepLink)
    else showMainWindow()
  })
}

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') {
    app.setName('Dictalume')
  }
  await migrateLegacyUserData(app.getPath('userData'), [
    join(app.getPath('appData'), 'WhisperType'),
    join(app.getPath('appData'), 'whispertype')
  ])
  store = new AppStore()
  calendarManager = new CalendarManager()
  await calendarManager.start()
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media'
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
  if (process.platform === 'win32') {
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      callback({ video: sources[0], audio: 'loopback' })
    })
  } else if (process.platform === 'darwin') {
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] })
        callback({ video: sources[0] })
      },
      { useSystemPicker: true }
    )
  }
  syncManager = new SyncManager(
    store,
    (status) => mainWindow?.webContents.send('sync:status-changed', status),
    (settings) => {
      const registration = registerShortcuts(settings)
      if (registration.repaired) void store.saveSettings(settings)
      updateTrayMenu(settings)
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
      mainWindow?.webContents.send('settings:changed', settings)
      overlayWindow?.webContents.send('settings:changed', settings)
      mainWindow?.webContents.send('history:changed')
    }
  )
  store.setChangeListener(() => syncManager.schedule())
  registerIpc()
  await syncManager.start()
  const settings = await store.getSettings()
  const registration = registerShortcuts(settings)
  if (registration.repaired) await store.saveSettings(settings)
  createTray(settings)
  app.setAsDefaultProtocolClient('dictalume')
  app.setAsDefaultProtocolClient('whispertype')
  mainWindow = createMainWindow()
  overlayWindow = createOverlayWindow()
  if (pendingDeepLink) {
    handleDeepLink(pendingDeepLink)
    pendingDeepLink = null
  }

  app.on('activate', showMainWindow)
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  syncManager?.stop()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // Keep the menu-bar utility alive after its windows are hidden.
})
