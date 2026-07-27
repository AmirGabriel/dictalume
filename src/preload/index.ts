import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  DesktopAPI,
  SyncStatus,
  TranscriptionRequest
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
  getMeetings: () => ipcRenderer.invoke('meetings:get'),
  saveMeeting: (request) => ipcRenderer.invoke('meetings:save', request),
  deleteMeeting: (id: string) => ipcRenderer.invoke('meetings:delete', id),
  getMeetingCaptureSupport: () => ipcRenderer.invoke('meetings:capture-support'),
  getCalendarStatus: () => ipcRenderer.invoke('calendar:status'),
  connectGoogleCalendar: (clientId: string) =>
    ipcRenderer.invoke('calendar:connect', clientId),
  disconnectGoogleCalendar: () => ipcRenderer.invoke('calendar:disconnect'),
  getCalendarEvents: () => ipcRenderer.invoke('calendar:events'),
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
  onSyncStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: SyncStatus): void =>
      callback(status)
    ipcRenderer.on('sync:status-changed', listener)
    return () => ipcRenderer.removeListener('sync:status-changed', listener)
  }
}

contextBridge.exposeInMainWorld('desktop', api)
