import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  type OpenDialogOptions
} from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppStore } from './store'
import { SyncManager } from './sync'
import { copyText, pasteFromClipboard } from './paste'
import {
  answerAcrossMeetings,
  answerMeetingQuestion,
  createMeetingNotesWithEvidence,
  transcribeAudio,
  transcribeMeetingAudio
} from './providers'
import type { UsageMeasurement } from './apiUsage'
import { mergeVocabulary } from './memory'
import { captureContext, getFrontmostApplicationName } from './context'
import { CalendarManager } from './calendar'
import { MicrosoftCalendarManager } from './microsoftCalendar'
import { UpdateManager } from './updater'
import { SpeakerTagManager } from './speakerTags'
import { ZoomSpeakerTagPoller } from './zoomSpeakerTags'
import { migrateLegacyUserData } from './migration'
import {
  applyMeetingTranscriptRetention,
  buildMeetingsCsv,
  relevantMeetings,
  renderMeetingTranscript
} from './meetingTranscript'
import {
  confirmedMeetingSpeakerName,
  meetingSpeakerEvidenceKey,
  meetingSpeakerName
} from '../shared/meeting'
import {
  automaticallyAssignedSpaceIds,
  sanitizeMeetingSpaces
} from '../shared/meetingSpaces'
import { sanitizeMeetingAttachments } from '../shared/meetingAttachments'
import { automaticMeetingTitle } from './meetingTitle'
import { automaticHistoryTitle } from './historyTitle'
import type {
  AppSettings,
  CalendarEvent,
  DesktopPlatform,
  HistoryItem,
  MeetingChatRequest,
  MeetingExportRequest,
  MeetingIndicatorAction,
  MeetingIndicatorState,
  MeetingLibraryChatAnswer,
  MeetingLibraryChatRequest,
  MeetingLiveTranscriptionRequest,
  MeetingRecord,
  MeetingRequest,
  MeetingSegmentTranscription,
  MeetingSpeaker,
  MeetingTranscriptTurn,
  MeetingUpdateRequest,
  PreMeetingBrief,
  PreMeetingBriefRequest,
  TranscriptionRequest,
  TranscriptionResult
} from '../shared/types'

function meetingEvidencePassages(
  turns: MeetingTranscriptTurn[],
  speakers: MeetingSpeaker[]
): Array<{ turnId: string; text: string }> {
  const speakerById = new Map(speakers.map((speaker) => [speaker.id, speaker.name]))
  return turns.map((turn) => ({
    turnId: turn.id,
    text: `${speakerById.get(turn.speakerId) || 'Unknown speaker'}: ${turn.text}`
  }))
}

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let meetingIndicatorWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: AppStore
let syncManager: SyncManager
let calendarManager: CalendarManager
let microsoftCalendarManager: MicrosoftCalendarManager
let updateManager: UpdateManager
let speakerTagManager: SpeakerTagManager
let zoomSpeakerTagPoller: ZoomSpeakerTagPoller
let activeTranscription: AbortController | null = null
let isQuitting = false
let pendingDeepLink: string | null = null
let calendarNotificationTimer: NodeJS.Timeout | null = null
let meetingIndicatorState: MeetingIndicatorState = {
  status: 'hidden',
  title: '',
  elapsedMs: 0,
  systemAudio: false
}
const notifiedCalendarEvents = new Set<string>()
let lastDeepLink = { url: '', receivedAt: 0 }
const DEFAULT_RECORD_SHORTCUT = 'CommandOrControl+Shift+Space'
const DEFAULT_MODE_SHORTCUT = 'CommandOrControl+Option+Space'

function desktopPlatform(): DesktopPlatform {
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

async function checkCalendarNotifications(): Promise<void> {
  if (!Notification.isSupported()) return
  const eventGroups = await Promise.allSettled([
    calendarManager.status().connected ? calendarManager.events() : Promise.resolve([]),
    microsoftCalendarManager.status().connected
      ? microsoftCalendarManager.events()
      : Promise.resolve([])
  ])
  const now = Date.now()
  const events = eventGroups.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  )
  for (const event of events) {
    const startsIn = event.startsAt - now
    if (
      startsIn < 0 ||
      startsIn > 10 * 60 * 1000 ||
      notifiedCalendarEvents.has(event.id)
    ) {
      continue
    }
    notifiedCalendarEvents.add(event.id)
    const minutes = Math.max(1, Math.round(startsIn / 60_000))
    const notification = new Notification({
      title: `${event.title} in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`,
      body: 'Open Dictalume to review context or start meeting notes.'
    })
    notification.on('click', () => {
      showMainWindow()
      mainWindow?.webContents.send('calendar:event-selected', event)
    })
    notification.show()
  }
}

function startCalendarNotificationPolling(): void {
  if (calendarNotificationTimer) clearInterval(calendarNotificationTimer)
  void checkCalendarNotifications()
  calendarNotificationTimer = setInterval(
    () => void checkCalendarNotifications(),
    5 * 60 * 1000
  )
}

async function recordUsage(usage: UsageMeasurement): Promise<void> {
  const summary = await store.addUsage({
    ...usage,
    id: crypto.randomUUID(),
    createdAt: Date.now()
  })
  mainWindow?.webContents.send('usage:changed', summary)
}

function meetingTranscriptionSettings(settings: AppSettings): AppSettings {
  const provider =
    settings.meetingTranscriptionProvider === 'same'
      ? settings.provider
      : settings.meetingTranscriptionProvider
  return provider === settings.provider ? settings : { ...settings, provider }
}

function speakerTagExtensionPath(): string {
  return app.isPackaged
    ? join(
        process.resourcesPath,
        'app.asar.unpacked',
        'extension',
        'dictalume-speaker-tags'
      )
    : join(app.getAppPath(), 'extension', 'dictalume-speaker-tags')
}

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
    const params = Object.fromEntries(
      new URLSearchParams(query.replace(/^\?/, '')).entries()
    )
    await window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: Object.keys(params).length > 0 ? params : undefined
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
    width: 304,
    height: 76,
    minWidth: 304,
    minHeight: 76,
    maxWidth: 360,
    maxHeight: 128,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: process.platform !== 'darwin',
    show: false,
    focusable: false,
    ...(process.platform === 'darwin' ? { roundedCorners: false } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setSkipTaskbar(true)
  window.on('show', () => {
    window.setAlwaysOnTop(true, 'screen-saver')
    window.moveTop()
  })
  window.on('closed', () => {
    overlayWindow = null
  })
  void loadRenderer(window, '?overlay=1')
  return window
}

function positionMeetingIndicator(): void {
  if (!meetingIndicatorWindow) return
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const [width] = meetingIndicatorWindow.getSize()
  meetingIndicatorWindow.setPosition(
    Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    Math.round(display.workArea.y + 14),
    false
  )
}

function createMeetingIndicatorWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 312,
    height: 58,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    ...(process.platform === 'darwin' ? { roundedCorners: false } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setSkipTaskbar(true)
  window.on('closed', () => {
    meetingIndicatorWindow = null
  })
  void loadRenderer(window, '?meetingIndicator=1')
  return window
}

function publishMeetingIndicator(state: MeetingIndicatorState): void {
  meetingIndicatorState = state
  zoomSpeakerTagPoller?.setActive(
    state.status === 'recording' && state.meetingSource === 'zoom'
  )
  if (state.status === 'hidden') {
    meetingIndicatorWindow?.hide()
    return
  }
  if (!meetingIndicatorWindow) {
    meetingIndicatorWindow = createMeetingIndicatorWindow()
  }
  const show = (): void => {
    positionMeetingIndicator()
    meetingIndicatorWindow?.webContents.send('meeting-indicator:state', state)
    meetingIndicatorWindow?.showInactive()
    meetingIndicatorWindow?.moveTop()
  }
  if (meetingIndicatorWindow.webContents.isLoading()) {
    meetingIndicatorWindow.webContents.once('did-finish-load', show)
  } else {
    show()
  }
}

function toggleRecording(languageOverride?: string): void {
  if (!overlayWindow) overlayWindow = createOverlayWindow()
  const trigger = (): void => {
    positionOverlay()
    overlayWindow?.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow?.showInactive()
    overlayWindow?.moveTop()
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
  const isMac = process.platform === 'darwin'
  const svg = encodeURIComponent(
    isMac
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><g fill="#000"><rect x="2" y="7" width="2" height="4" rx="1"/><rect x="5" y="4" width="2" height="10" rx="1"/><rect x="8" y="2" width="2" height="14" rx="1"/><rect x="11" y="5" width="2" height="8" rx="1"/><rect x="14" y="7" width="2" height="4" rx="1"/></g></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" rx="5" fill="#0A84FF"/><g fill="#fff"><rect x="3" y="8" width="2" height="4" rx="1"/><rect x="6" y="5" width="2" height="10" rx="1"/><rect x="9" y="3" width="2" height="14" rx="1"/><rect x="12" y="6" width="2" height="8" rx="1"/><rect x="15" y="8" width="2" height="4" rx="1"/></g></svg>`
  )
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml,${svg}`)
  if (isMac) icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Dictalume')
  updateTrayMenu(settings)
  if (!isMac) {
    tray.on('click', () => tray?.popUpContextMenu())
    tray.on('double-click', () => showMainWindow())
  }
}

function showMainWindow(): void {
  if (!mainWindow) mainWindow = createMainWindow()
  mainWindow.show()
  mainWindow.focus()
}

function registerIpc(): void {
  ipcMain.handle('platform:get', () => desktopPlatform())
  ipcMain.handle('usage:get', () => store.getUsageSummary())
  ipcMain.handle('updates:get', () => updateManager.getStatus())
  ipcMain.handle('updates:check', () => updateManager.check())
  ipcMain.handle('updates:download', () => updateManager.download())
  ipcMain.handle('updates:install', () => updateManager.install())
  ipcMain.handle('updates:open-download', () => updateManager.openDownload())
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => {
    const previous = await store.getSettings()
    settings.meetingSpaces = sanitizeMeetingSpaces(settings.meetingSpaces || [])
    settings.meetingConsentMessageEnabled = Boolean(
      settings.meetingConsentMessageEnabled
    )
    settings.meetingConsentMessage = (settings.meetingConsentMessage || '')
      .trim()
      .slice(0, 500)
    let saved = await store.saveSettings(settings)
    zoomSpeakerTagPoller?.configureConsent(
      saved.meetingConsentMessageEnabled,
      saved.meetingConsentMessage
    )
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
    if (
      previous.meetingTranscriptRetentionDays !==
      saved.meetingTranscriptRetentionDays
    ) {
      const result = applyMeetingTranscriptRetention(
        await store.getMeetings(),
        saved.meetingTranscriptRetentionDays
      )
      if (result.changed) {
        await store.replaceMeetings(result.meetings, true)
        mainWindow?.webContents.send('meetings:changed')
      }
    }
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
  ipcMain.handle('meetings:get', async (_event, includeDeleted = false) => {
    const settings = await store.getSettings()
    const result = applyMeetingTranscriptRetention(
      await store.getMeetings(),
      settings.meetingTranscriptRetentionDays
    )
    if (result.changed) await store.replaceMeetings(result.meetings, true)
    return includeDeleted
      ? result.meetings
      : result.meetings.filter((meeting) => !meeting.deletedAt)
  })
  ipcMain.handle('meetings:delete', async (_event, id: string) => {
    const meeting = (await store.getMeetings()).find((item) => item.id === id)
    if (!meeting) throw new Error('Meeting not found.')
    await store.updateMeeting({
      ...meeting,
      deletedAt: Date.now(),
      updatedAt: Date.now()
    })
    mainWindow?.webContents.send('meetings:changed')
  })
  ipcMain.handle('meetings:restore', async (_event, id: string): Promise<MeetingRecord> => {
    const meeting = (await store.getMeetings()).find((item) => item.id === id)
    if (!meeting) throw new Error('Meeting not found.')
    const restored: MeetingRecord = {
      ...meeting,
      deletedAt: undefined,
      updatedAt: Date.now()
    }
    await store.updateMeeting(restored)
    mainWindow?.webContents.send('meetings:changed')
    return restored
  })
  ipcMain.handle('meetings:delete-permanently', async (_event, id: string) => {
    const meeting = (await store.getMeetings()).find((item) => item.id === id)
    if (!meeting?.deletedAt) throw new Error('Move the meeting to trash first.')
    await store.deleteMeeting(id)
    mainWindow?.webContents.send('meetings:changed')
  })
  ipcMain.handle(
    'meetings:export',
    async (_event, request: MeetingExportRequest): Promise<boolean> => {
      const meeting = (await store.getMeetings()).find(
        (item) => item.id === request.meetingId
      )
      if (!meeting) throw new Error('Meeting not found.')
      const safeTitle =
        meeting.title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim() || 'Meeting'
      const isJson = request.format === 'json'
      const selected = mainWindow
        ? await dialog.showSaveDialog(mainWindow, {
            title: 'Export meeting',
            defaultPath: `${safeTitle}.${isJson ? 'json' : 'md'}`,
            filters: isJson
              ? [{ name: 'JSON', extensions: ['json'] }]
              : [{ name: 'Markdown', extensions: ['md'] }]
          })
        : await dialog.showSaveDialog({
            title: 'Export meeting',
            defaultPath: `${safeTitle}.${isJson ? 'json' : 'md'}`
          })
      if (selected.canceled || !selected.filePath) return false
      const content = isJson
        ? JSON.stringify(meeting, null, 2)
        : [
            `# ${meeting.title}`,
            meeting.notes.trim(),
            meeting.userNotes?.trim()
              ? `## Your notes\n\n${meeting.userNotes.trim()}`
              : '',
            (meeting.attachments || []).length > 0
              ? [
                  '## Attachments',
                  ...(meeting.attachments || []).map(
                    (attachment) =>
                      `![${attachment.name.replace(/[\[\]]/g, '')}](${attachment.dataUrl})`
                  )
                ].join('\n\n')
              : '',
            '## Full transcript',
            meeting.transcript.trim()
          ].filter(Boolean).join('\n\n')
      await writeFile(selected.filePath, `${content}\n`, 'utf8')
      return true
    }
  )
  ipcMain.handle('meetings:export-csv', async (): Promise<boolean> => {
    const meetings = (await store.getMeetings()).filter((meeting) => !meeting.deletedAt)
    const selected = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: 'Export all meetings',
          defaultPath: 'Dictalume meetings.csv',
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        })
      : await dialog.showSaveDialog({
          title: 'Export all meetings',
          defaultPath: 'Dictalume meetings.csv'
        })
    if (selected.canceled || !selected.filePath) return false
    await writeFile(selected.filePath, buildMeetingsCsv(meetings), 'utf8')
    return true
  })
  ipcMain.handle(
    'meetings:update',
    async (_event, request: MeetingUpdateRequest): Promise<MeetingRecord> => {
      const meetings = (await store.getMeetings()).filter((meeting) => !meeting.deletedAt)
      const meeting = meetings.find((item) => item.id === request.meetingId)
      if (!meeting) throw new Error('Meeting not found.')

      const currentSpeakers = meeting.speakers || []
      const currentSpeakerIds = new Set(currentSpeakers.map((speaker) => speaker.id))
      const speakers = request.speakers
        ? request.speakers.map((speaker) => {
            if (!currentSpeakerIds.has(speaker.id)) {
              throw new Error('A speaker in this update does not belong to the meeting.')
            }
            const original = currentSpeakers.find((item) => item.id === speaker.id)!
            return {
              ...original,
              name: speaker.name.trim().slice(0, 80) || original.name
            }
          })
        : currentSpeakers
      const currentTurns = meeting.transcriptTurns || []
      const currentTurnIds = new Set(currentTurns.map((turn) => turn.id))
      const turns = request.transcriptTurns
        ? request.transcriptTurns.map((turn) => {
            if (!currentTurnIds.has(turn.id)) {
              throw new Error('A transcript turn in this update does not belong to the meeting.')
            }
            const original = currentTurns.find((item) => item.id === turn.id)!
            if (!currentSpeakerIds.has(turn.speakerId)) {
              throw new Error('Choose a speaker that belongs to this meeting.')
            }
            return {
              ...original,
              speakerId: turn.speakerId,
              text: turn.text.trim().slice(0, 20_000)
            }
          }).filter((turn) => turn.text)
        : currentTurns
      const transcript =
        meeting.transcriptTurns && speakers.length > 0
          ? renderMeetingTranscript(turns, speakers)
          : meeting.transcript
      const updatedTurnIds = new Set(turns.map((turn) => turn.id))
      const currentSettings = await store.getSettings()
      const validSpaceIds = new Set(
        currentSettings.meetingSpaces.map((space) => space.id)
      )
      const updated: MeetingRecord = {
        ...meeting,
        title: request.title?.trim().slice(0, 160) || meeting.title,
        speakers,
        transcriptTurns: turns,
        transcript,
        notes:
          request.notes !== undefined
            ? request.notes.trim().slice(0, 100_000)
            : meeting.notes,
        noteEvidence:
          request.notes !== undefined
            ? []
            : (meeting.noteEvidence ?? []).filter((entry) =>
                entry.turnIds.some((turnId) => updatedTurnIds.has(turnId))
              ),
        userNotes:
          request.userNotes !== undefined
            ? request.userNotes.slice(0, 100_000)
            : meeting.userNotes ?? '',
        attachments:
          request.attachments !== undefined
            ? sanitizeMeetingAttachments(request.attachments)
            : meeting.attachments ?? [],
        completedTodos:
          request.completedTodos !== undefined
            ? Array.from(
                new Set(
                  request.completedTodos
                    .map((item) => item.trim().slice(0, 2_000))
                    .filter(Boolean)
                )
              ).slice(0, 500)
            : meeting.completedTodos ?? [],
        templateId: request.templateId ?? meeting.templateId ?? 'general',
        spaceIds:
          request.spaceIds !== undefined
            ? Array.from(
                new Set(request.spaceIds.filter((id) => validSpaceIds.has(id)))
              ).slice(0, 20)
            : meeting.spaceIds,
        space:
          request.space !== undefined
            ? request.space.trim().slice(0, 80) || undefined
            : request.spaceIds !== undefined
              ? undefined
              : meeting.space,
        updatedAt: Date.now()
      }

      if (request.regenerateNotes) {
        const settings = currentSettings
        activeTranscription?.abort()
        activeTranscription = new AbortController()
        try {
          const generated = await createMeetingNotesWithEvidence(
            updated.transcript,
            settings,
            updated.title,
            activeTranscription.signal,
            recordUsage,
            {
              userNotes: updated.userNotes,
              templateId: updated.templateId,
              evidencePassages: meetingEvidencePassages(turns, speakers)
            }
          )
          updated.notes = generated.notes
          updated.noteEvidence = generated.evidence
        } finally {
          activeTranscription = null
        }
      }
      await store.updateMeeting(updated)
      mainWindow?.webContents.send('meetings:changed')
      return updated
    }
  )
  ipcMain.handle(
    'meetings:ask-all',
    async (
      _event,
      request: MeetingLibraryChatRequest
    ): Promise<MeetingLibraryChatAnswer> => {
      const question = request.question.trim()
      if (!question) throw new Error('Write a question first.')
      const meetings = (await store.getMeetings()).filter((meeting) => !meeting.deletedAt)
      if (meetings.length === 0) throw new Error('Record a meeting first.')
      const selected = relevantMeetings(meetings, question)
      const settings = await store.getSettings()
      activeTranscription?.abort()
      activeTranscription = new AbortController()
      try {
        const answer = await answerAcrossMeetings(
          selected,
          question,
          settings,
          request.provider,
          activeTranscription.signal,
          recordUsage
        )
        return {
          answer,
          meetingIds: selected.map((meeting) => meeting.id),
          meetingTitles: selected.map((meeting) => meeting.title)
        }
      } finally {
        activeTranscription = null
      }
    }
  )
  ipcMain.handle(
    'meetings:ask',
    async (_event, request: MeetingChatRequest): Promise<MeetingRecord> => {
      const question = request.question.trim()
      if (!question) throw new Error('Write a question first.')
      const meetings = (await store.getMeetings()).filter((meeting) => !meeting.deletedAt)
      const meeting = meetings.find((item) => item.id === request.meetingId)
      if (!meeting) throw new Error('Meeting not found.')
      const settings = await store.getSettings()
      activeTranscription?.abort()
      activeTranscription = new AbortController()
      try {
        const previous = meeting.chat || []
        const answer = await answerMeetingQuestion(
          meeting.transcript,
          meeting.notes,
          previous.map(({ role, content }) => ({ role, content })),
          question,
          settings,
          request.provider,
          activeTranscription.signal,
          recordUsage
        )
        const now = Date.now()
        const updated: MeetingRecord = {
          ...meeting,
          updatedAt: Date.now(),
          chat: [
            ...previous,
            {
              id: crypto.randomUUID(),
              role: 'user',
              content: question,
              createdAt: now,
              provider: request.provider
            },
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: answer,
              createdAt: Date.now(),
              provider: request.provider
            }
          ]
        }
        await store.updateMeeting(updated)
        mainWindow?.webContents.send('meetings:changed')
        return updated
      } finally {
        activeTranscription = null
      }
    }
  )
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
  ipcMain.handle('meeting-indicator:get', () => meetingIndicatorState)
  ipcMain.handle(
    'meeting-indicator:update',
    (_event, state: MeetingIndicatorState) => {
      if (
        !state ||
        !['hidden', 'recording', 'paused', 'reviewing', 'processing'].includes(
          state.status
        )
      ) {
        throw new Error('Invalid meeting indicator state.')
      }
      publishMeetingIndicator({
        status: state.status,
        title: String(state.title || '').trim().slice(0, 160),
        elapsedMs: Math.max(0, Number(state.elapsedMs) || 0),
        systemAudio: Boolean(state.systemAudio),
        meetingSource: [
          'google-meet',
          'zoom',
          'conversation',
          'other'
        ].includes(state.meetingSource || '')
          ? state.meetingSource
          : undefined
      })
    }
  )
  ipcMain.handle(
    'meeting-indicator:control',
    (_event, action: MeetingIndicatorAction) => {
      if (!['pause', 'resume', 'stop'].includes(action)) {
        throw new Error('Invalid meeting control.')
      }
      mainWindow?.webContents.send('meeting-indicator:control', action)
    }
  )
  ipcMain.handle('speaker-tags:status', () => speakerTagManager.status())
  ipcMain.handle(
    'speaker-tags:events',
    (_event, startedAt: number, endedAt: number) =>
      speakerTagManager.eventsBetween(startedAt, endedAt)
  )
  ipcMain.handle('speaker-tags:open-extension-folder', () => {
    shell.showItemInFolder(join(speakerTagExtensionPath(), 'manifest.json'))
  })
  ipcMain.handle(
    'meetings:transcribe-segment',
    async (
      _event,
      request: MeetingLiveTranscriptionRequest
    ): Promise<MeetingSegmentTranscription> => {
      const segment = request.segment
      if (!segment?.id || !segment.audio?.byteLength) {
        throw new Error('The live meeting segment did not contain audio.')
      }
      const settings = await store.getSettings()
      const transcriptionSettings = meetingTranscriptionSettings(settings)
      const shouldDiarize =
        transcriptionSettings.provider === 'deepgram' &&
        (segment.source === 'system' || request.meetingSource === 'conversation')
      const result = await transcribeMeetingAudio(
        new Uint8Array(segment.audio),
        segment.mimeType,
        transcriptionSettings,
        segment.source,
        shouldDiarize,
        undefined,
        segment.durationMs,
        recordUsage
      )
      return {
        segmentId: segment.id,
        source: segment.source,
        startedAtMs: segment.startedAtMs,
        durationMs: segment.durationMs,
        chunks: result.chunks,
        learnedVocabulary: result.learnedVocabulary
      }
    }
  )
  ipcMain.handle('calendar:status', () => calendarManager.status())
  ipcMain.handle('calendar:connect', (_event, clientId: string) =>
    calendarManager.connect(clientId)
  )
  ipcMain.handle('calendar:disconnect', () => calendarManager.disconnect())
  ipcMain.handle('calendar:events', () => calendarManager.events())
  ipcMain.handle('outlook-calendar:status', () => microsoftCalendarManager.status())
  ipcMain.handle('outlook-calendar:connect', (_event, clientId: string) =>
    microsoftCalendarManager.connect(clientId)
  )
  ipcMain.handle('outlook-calendar:disconnect', () =>
    microsoftCalendarManager.disconnect()
  )
  ipcMain.handle('outlook-calendar:events', () => microsoftCalendarManager.events())
  ipcMain.handle(
    'calendar:brief',
    async (_event, request: PreMeetingBriefRequest): Promise<PreMeetingBrief> => {
      const event = request.event
      if (!event?.id || !event.title?.trim() || !Number.isFinite(event.startsAt)) {
        throw new Error('The calendar event is invalid.')
      }
      const meetings = (await store.getMeetings()).filter(
        (meeting) => !meeting.deletedAt && meeting.createdAt < event.startsAt
      )
      if (meetings.length === 0) {
        throw new Error('There are no earlier meetings to build this brief from yet.')
      }
      const selected = relevantMeetings(meetings, event.title)
      const settings = await store.getSettings()
      activeTranscription?.abort()
      activeTranscription = new AbortController()
      try {
        const content = await answerAcrossMeetings(
          selected,
          [
            `Prepare a pre-meeting brief for the upcoming meeting “${event.title.trim().slice(0, 200)}”`,
            `scheduled for ${new Date(event.startsAt).toISOString()}.`,
            'Use concise Markdown with these sections when evidence exists:',
            '## Context, ## Last decisions, ## Open action items, ## Open questions, and ## Suggested agenda.',
            'Only include facts from the supplied past meetings. Preserve unresolved uncertainty.',
            'Never infer the identity of an anonymous speaker.'
          ].join(' '),
          settings,
          request.provider,
          activeTranscription.signal,
          recordUsage
        )
        return {
          eventId: event.id,
          content,
          meetingIds: selected.map((meeting) => meeting.id),
          meetingTitles: selected.map((meeting) => meeting.title)
        }
      } finally {
        activeTranscription = null
      }
    }
  )
  ipcMain.handle('external:open', (_event, url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') throw new Error('Only secure links can be opened.')
    return shell.openExternal(parsed.toString())
  })
  ipcMain.handle(
    'meetings:save',
    async (_event, request: MeetingRequest): Promise<MeetingRecord> => {
      if (request.segments.length === 0) throw new Error('No meeting audio was recorded.')
      const existingMeeting = request.appendToMeetingId
        ? (await store.getMeetings()).find(
            (meeting) => meeting.id === request.appendToMeetingId && !meeting.deletedAt
          )
        : undefined
      if (request.appendToMeetingId && !existingMeeting) {
        throw new Error('The meeting to resume was not found.')
      }
      const settings = await store.getSettings()
      const transcriptionSettings = meetingTranscriptionSettings(settings)
      activeTranscription?.abort()
      activeTranscription = new AbortController()
      try {
        const speakers: MeetingSpeaker[] = [...(existingMeeting?.speakers || [])]
        const turns: MeetingTranscriptTurn[] = [...(existingMeeting?.transcriptTurns || [])]
        if (
          existingMeeting &&
          turns.length === 0 &&
          existingMeeting.transcript.trim()
        ) {
          const legacySpeaker: MeetingSpeaker = {
            id: crypto.randomUUID(),
            name: 'Earlier transcript',
            source: 'system',
            diarizationLabel: 'legacy'
          }
          speakers.push(legacySpeaker)
          turns.push({
            id: crypto.randomUUID(),
            speakerId: legacySpeaker.id,
            source: 'system',
            startMs: 0,
            endMs: existingMeeting.durationMs,
            text: existingMeeting.transcript.trim()
          })
        }
        const baselineTurnCount = turns.length
        const speakerByEvidence = new Map<string, MeetingSpeaker>()
        for (const speaker of speakers) {
          const evidenceKey =
            speaker.evidenceKey ||
            meetingSpeakerEvidenceKey(
              speaker.source,
              existingMeeting?.source || request.source,
              speaker.diarizationLabel,
              speaker.diarizationScope
            )
          if (!speakerByEvidence.has(evidenceKey)) {
            speakerByEvidence.set(evidenceKey, speaker)
          }
        }
        const appendOffsetMs = existingMeeting?.durationMs || 0
        const learnedVocabulary: string[] = []
        const liveTranscriptions = new Map(
          (request.transcriptions || []).map((item) => [item.segmentId, item])
        )
        const sortedSegments = [...request.segments].sort(
          (left, right) =>
            left.startedAtMs - right.startedAtMs ||
            (left.source === 'microphone' ? -1 : 1)
        )
        for (const segment of sortedSegments) {
          const shouldDiarize =
            transcriptionSettings.provider === 'deepgram' &&
            (segment.source === 'system' || request.source === 'conversation')
          let result: Awaited<ReturnType<typeof transcribeMeetingAudio>>
          const live = liveTranscriptions.get(segment.id)
          if (
            live &&
            live.source === segment.source &&
            live.startedAtMs === segment.startedAtMs &&
            live.durationMs === segment.durationMs
          ) {
            result = {
              chunks: live.chunks,
              learnedVocabulary: live.learnedVocabulary
            }
          } else {
            try {
              result = await transcribeMeetingAudio(
                new Uint8Array(segment.audio),
                segment.mimeType,
                transcriptionSettings,
                segment.source,
                shouldDiarize,
                activeTranscription.signal,
                segment.durationMs,
                recordUsage
              )
            } catch (error) {
              const message = error instanceof Error ? error.message.toLocaleLowerCase() : ''
              if (message.includes('empty transcript')) continue
              throw error
            }
          }
          learnedVocabulary.push(...result.learnedVocabulary)
          for (const chunk of result.chunks) {
            const baseEvidenceKey = meetingSpeakerEvidenceKey(
              segment.source,
              request.source,
              chunk.diarizationLabel,
              segment.id
            )
            const userConfirmedName = confirmedMeetingSpeakerName(
              request.speakerNames,
              baseEvidenceKey
            )
            const chunkStartedAt =
              request.startedAt + segment.startedAtMs + chunk.startMs
            const chunkEndedAt =
              request.startedAt + segment.startedAtMs + chunk.endMs
            const displayName =
              (request.source === 'google-meet' || request.source === 'zoom') &&
              segment.source === 'system'
                ? speakerTagManager.speakerForInterval(
                    chunkStartedAt,
                    chunkEndedAt,
                    request.source
                  )
                : undefined
            const authoritativeName = userConfirmedName || displayName
            const normalizedName = authoritativeName
              ?.toLocaleLowerCase()
              .replace(/\s+/g, ' ')
            const evidenceKey = authoritativeName
              ? `${segment.source}:${
                  userConfirmedName ? 'confirmed' : 'display'
                }:${normalizedName}`
              : baseEvidenceKey
            let speaker = speakerByEvidence.get(evidenceKey)
            if (!speaker) {
              speaker = {
                id: crypto.randomUUID(),
                name:
                  authoritativeName ||
                  meetingSpeakerName(
                    evidenceKey,
                    [...speakerByEvidence.keys()].filter(
                      (key) =>
                        key !== 'microphone:me' &&
                        key !== 'system:others' &&
                        key !== 'microphone:conversation'
                    ).length
                  ),
                source: segment.source,
                evidenceKey,
                ...(chunk.diarizationLabel
                  ? {
                      diarizationLabel: chunk.diarizationLabel,
                      diarizationScope: segment.id
                    }
                  : {})
              }
              speakerByEvidence.set(evidenceKey, speaker)
              speakers.push(speaker)
            }
            turns.push({
              id: crypto.randomUUID(),
              speakerId: speaker.id,
              source: segment.source,
              startMs: appendOffsetMs + segment.startedAtMs + chunk.startMs,
              endMs:
                appendOffsetMs +
                segment.startedAtMs +
                Math.max(chunk.startMs, chunk.endMs),
              text: chunk.text
            })
          }
        }
        turns.sort((left, right) => left.startMs - right.startMs)
        if (turns.length === baselineTurnCount) {
          throw new Error('No speech was detected in the meeting audio.')
        }
        const transcript = renderMeetingTranscript(turns, speakers)
        const provisionalMeetingTitle =
          request.title.trim() || existingMeeting?.title || 'Untitled meeting'
        const generatedNotes = await createMeetingNotesWithEvidence(
          transcript,
          settings,
          provisionalMeetingTitle,
          activeTranscription.signal,
          recordUsage,
          {
            userNotes: request.userNotes,
            templateId: request.templateId,
            evidencePassages: meetingEvidencePassages(turns, speakers)
          }
        )
        const meetingTitle = automaticMeetingTitle(
          request.title,
          existingMeeting?.title,
          generatedNotes.notes,
          transcript
        )
        if (learnedVocabulary.length > 0) {
          settings.vocabulary = mergeVocabulary(settings.vocabulary, learnedVocabulary)
          await store.saveSettings(settings)
          mainWindow?.webContents.send('settings:changed', settings)
          overlayWindow?.webContents.send('settings:changed', settings)
        }
        const attendees = [
          ...(existingMeeting?.attendees || []),
          ...(request.attendees || [])
        ].filter(
          (attendee, index, items) =>
            items.findIndex(
              (candidate) =>
                (candidate.email && candidate.email === attendee.email) ||
                (!candidate.email &&
                  !attendee.email &&
                  candidate.name.toLocaleLowerCase() === attendee.name.toLocaleLowerCase())
            ) === index
        )
        const meeting: MeetingRecord = {
          ...existingMeeting,
          id: existingMeeting?.id || crypto.randomUUID(),
          title: meetingTitle,
          source: existingMeeting?.source || request.source,
          createdAt: existingMeeting?.createdAt || request.startedAt,
          durationMs: appendOffsetMs + request.durationMs,
          transcript,
          notes: generatedNotes.notes,
          noteEvidence: generatedNotes.evidence,
          provider: transcriptionSettings.provider,
          speakers,
          transcriptTurns: turns,
          transcriptDeletedAt: undefined,
          transcriptUpdatedAt: Date.now(),
          userNotes: request.userNotes,
          attachments: sanitizeMeetingAttachments([
            ...(existingMeeting?.attachments || []),
            ...(request.attachments || [])
          ]),
          templateId: request.templateId,
          attendees,
          calendarSeriesId:
            request.calendarSeriesId || existingMeeting?.calendarSeriesId,
          spaceIds:
            existingMeeting?.spaceIds ||
            automaticallyAssignedSpaceIds(
              meetingTitle,
              request.calendarSeriesId,
              settings.meetingSpaces
            ),
          updatedAt: Date.now()
        }
        if (existingMeeting) await store.updateMeeting(meeting)
        else await store.addMeeting(meeting)
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
          activeTranscription.signal,
          request.durationMs,
          recordUsage
        )
        const historyItem: HistoryItem = {
          id: crypto.randomUUID(),
          title: automaticHistoryTitle(result.text),
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
        settings,
        undefined,
        undefined,
        0,
        recordUsage
      )
      if (result.learnedVocabulary.length > 0) {
        settings.vocabulary = mergeVocabulary(settings.vocabulary, result.learnedVocabulary)
        await store.saveSettings(settings)
        mainWindow?.webContents.send('settings:changed', settings)
        overlayWindow?.webContents.send('settings:changed', settings)
      }
      const historyItem: HistoryItem = {
        id: crypto.randomUUID(),
        title: automaticHistoryTitle(result.text),
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
  updateManager = new UpdateManager((status) => {
    mainWindow?.webContents.send('updates:status', status)
  })
  calendarManager = new CalendarManager()
  await calendarManager.start()
  microsoftCalendarManager = new MicrosoftCalendarManager()
  await microsoftCalendarManager.start()
  speakerTagManager = new SpeakerTagManager()
  await speakerTagManager.start()
  zoomSpeakerTagPoller = new ZoomSpeakerTagPoller((name) =>
    speakerTagManager.recordTrustedSpeaker(name, 'zoom')
  )
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
      zoomSpeakerTagPoller.configureConsent(
        settings.meetingConsentMessageEnabled,
        settings.meetingConsentMessage
      )
      mainWindow?.webContents.send('settings:changed', settings)
      overlayWindow?.webContents.send('settings:changed', settings)
      mainWindow?.webContents.send('history:changed')
      mainWindow?.webContents.send('meetings:changed')
      void store.getUsageSummary().then((summary) => {
        mainWindow?.webContents.send('usage:changed', summary)
      })
    }
  )
  store.setChangeListener(() => syncManager.schedule())
  registerIpc()
  await syncManager.start()
  const settings = await store.getSettings()
  zoomSpeakerTagPoller.configureConsent(
    settings.meetingConsentMessageEnabled,
    settings.meetingConsentMessage
  )
  const registration = registerShortcuts(settings)
  if (registration.repaired) await store.saveSettings(settings)
  createTray(settings)
  app.setAsDefaultProtocolClient('dictalume')
  app.setAsDefaultProtocolClient('whispertype')
  mainWindow = createMainWindow()
  overlayWindow = createOverlayWindow()
  updateManager.start()
  startCalendarNotificationPolling()
  powerMonitor.on('suspend', () => {
    mainWindow?.webContents.send('meeting-indicator:control', 'stop')
  })
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
  if (calendarNotificationTimer) clearInterval(calendarNotificationTimer)
  updateManager?.stop()
  syncManager?.stop()
  globalShortcut.unregisterAll()
  speakerTagManager?.stop()
  zoomSpeakerTagPoller?.stop()
  meetingIndicatorWindow?.destroy()
})

app.on('window-all-closed', () => {
  // Keep the menu-bar utility alive after its windows are hidden.
})
