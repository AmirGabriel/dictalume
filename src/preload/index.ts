import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ApiUsageSummary,
  CalendarEvent,
  DesktopAPI,
  MeetingIndicatorAction,
  MeetingIndicatorState,
  SyncStatus,
  TranscriptionRequest,
  UpdateStatus
} from '../shared/types'

const api: DesktopAPI = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  deleteHistory: (id: string) => ipcRenderer.invoke('history:delete', id),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  transcribe: (request: TranscriptionRequest) =>
    ipcRenderer.invoke('transcription:run', request),
  transcribeFile: () => ipcRenderer.invoke('transcription:file'),
  captureContext: () => ipcRenderer.invoke('context:capture'),
  cancelRecording: () => ipcRenderer.invoke('recording:cancel'),
  setShortcutCaptureActive: (active: boolean) =>
    ipcRenderer.invoke('shortcuts:capture-active', active),
  getPermissions: () => ipcRenderer.invoke('permissions:get'),
  requestMicrophonePermission: () => ipcRenderer.invoke('permissions:microphone'),
  openAccessibilitySettings: () => ipcRenderer.invoke('permissions:accessibility'),
  showMainWindow: () => ipcRenderer.invoke('window:show-main'),
  getSyncStatus: () => ipcRenderer.invoke('sync:status'),
  chooseSyncFolder: () => ipcRenderer.invoke('sync:choose-folder'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  disableSync: () => ipcRenderer.invoke('sync:disable'),
  getMeetings: (includeDeleted = false) =>
    ipcRenderer.invoke('meetings:get', includeDeleted),
  saveMeeting: (request) => ipcRenderer.invoke('meetings:save', request),
  transcribeMeetingSegment: (request) =>
    ipcRenderer.invoke('meetings:transcribe-segment', request),
  updateMeeting: (request) => ipcRenderer.invoke('meetings:update', request),
  askMeeting: (request) => ipcRenderer.invoke('meetings:ask', request),
  askMeetings: (request) => ipcRenderer.invoke('meetings:ask-all', request),
  deleteMeeting: (id: string) => ipcRenderer.invoke('meetings:delete', id),
  restoreMeeting: (id: string) => ipcRenderer.invoke('meetings:restore', id),
  permanentlyDeleteMeeting: (id: string) =>
    ipcRenderer.invoke('meetings:delete-permanently', id),
  exportMeeting: (request) => ipcRenderer.invoke('meetings:export', request),
  exportMeetingsCsv: () => ipcRenderer.invoke('meetings:export-csv'),
  getMeetingCaptureSupport: () => ipcRenderer.invoke('meetings:capture-support'),
  getMeetingIndicatorState: () => ipcRenderer.invoke('meeting-indicator:get'),
  updateMeetingIndicator: (state) =>
    ipcRenderer.invoke('meeting-indicator:update', state),
  controlMeeting: (action) => ipcRenderer.invoke('meeting-indicator:control', action),
  getSpeakerTagStatus: () => ipcRenderer.invoke('speaker-tags:status'),
  getSpeakerTagEvents: (startedAt, endedAt) =>
    ipcRenderer.invoke('speaker-tags:events', startedAt, endedAt),
  openSpeakerTagExtensionFolder: () =>
    ipcRenderer.invoke('speaker-tags:open-extension-folder'),
  getPlatform: () => ipcRenderer.invoke('platform:get'),
  getApiUsage: () => ipcRenderer.invoke('usage:get'),
  getUpdateStatus: () => ipcRenderer.invoke('updates:get'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openUpdateDownload: () => ipcRenderer.invoke('updates:open-download'),
  getCalendarStatus: () => ipcRenderer.invoke('calendar:status'),
  connectGoogleCalendar: (clientId: string) =>
    ipcRenderer.invoke('calendar:connect', clientId),
  disconnectGoogleCalendar: () => ipcRenderer.invoke('calendar:disconnect'),
  getCalendarEvents: () => ipcRenderer.invoke('calendar:events'),
  getOutlookCalendarStatus: () => ipcRenderer.invoke('outlook-calendar:status'),
  connectOutlookCalendar: (clientId: string) =>
    ipcRenderer.invoke('outlook-calendar:connect', clientId),
  disconnectOutlookCalendar: () => ipcRenderer.invoke('outlook-calendar:disconnect'),
  getOutlookCalendarEvents: () => ipcRenderer.invoke('outlook-calendar:events'),
  createPreMeetingBrief: (request) => ipcRenderer.invoke('calendar:brief', request),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  onRecordingToggle: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, languageOverride?: string): void =>
      callback(languageOverride)
    ipcRenderer.on('recording:toggle', listener)
    return () => ipcRenderer.removeListener('recording:toggle', listener)
  },
  onRecordingCancel: (callback) => {
    ipcRenderer.on('recording:cancel-renderer', callback)
    return () => ipcRenderer.removeListener('recording:cancel-renderer', callback)
  },
  onSettingsChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings): void =>
      callback(settings)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  onHistoryChanged: (callback) => {
    ipcRenderer.on('history:changed', callback)
    return () => ipcRenderer.removeListener('history:changed', callback)
  },
  onMeetingsChanged: (callback) => {
    ipcRenderer.on('meetings:changed', callback)
    return () => ipcRenderer.removeListener('meetings:changed', callback)
  },
  onMeetingIndicatorState: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: MeetingIndicatorState
    ): void => callback(state)
    ipcRenderer.on('meeting-indicator:state', listener)
    return () => ipcRenderer.removeListener('meeting-indicator:state', listener)
  },
  onMeetingControl: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      action: MeetingIndicatorAction
    ): void => callback(action)
    ipcRenderer.on('meeting-indicator:control', listener)
    return () => ipcRenderer.removeListener('meeting-indicator:control', listener)
  },
  onCalendarEventSelected: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, calendarEvent: CalendarEvent) =>
      callback(calendarEvent)
    ipcRenderer.on('calendar:event-selected', listener)
    return () => ipcRenderer.removeListener('calendar:event-selected', listener)
  },
  onApiUsageChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, summary: ApiUsageSummary): void =>
      callback(summary)
    ipcRenderer.on('usage:changed', listener)
    return () => ipcRenderer.removeListener('usage:changed', listener)
  },
  onUpdateStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void =>
      callback(status)
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  },
  onSyncStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: SyncStatus): void =>
      callback(status)
    ipcRenderer.on('sync:status-changed', listener)
    return () => ipcRenderer.removeListener('sync:status-changed', listener)
  }
}

contextBridge.exposeInMainWorld('desktop', api)
