export type ProviderId = 'openai' | 'grok' | 'groq' | 'deepgram' | 'custom'
export type ModeId = string

export interface ProviderConfig {
  id: ProviderId
  name: string
  baseUrl: string
  model: string
  cleanupModel: string
  apiKey: string
}

export interface ModeConfig {
  id: ModeId
  name: string
  description: string
  prompt: string
  cleanup: boolean
  context: {
    application: boolean
    clipboard: boolean
    selectedText: boolean
  }
  activateFor: string[]
}

export interface AppSettings {
  provider: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  shortcut: string
  changeModeShortcut: string
  languageShortcuts: {
    en: string
    pt: string
  }
  language: string
  mode: ModeId
  modes: Record<ModeId, ModeConfig>
  autoPaste: boolean
  copyToClipboard: boolean
  launchAtLogin: boolean
  soundEffects: boolean
  cleanupProvider: 'same' | Exclude<ProviderId, 'deepgram'>
  automaticMemory: boolean
  vocabulary: string
}

export interface HistoryItem {
  id: string
  text: string
  rawText: string
  createdAt: number
  durationMs: number
  provider: ProviderId
  mode: ModeId
  language: string
}

export type RecorderState =
  | { status: 'idle' }
  | { status: 'recording'; startedAt: number }
  | { status: 'processing'; message: string }
  | { status: 'success'; text: string }
  | { status: 'error'; message: string }

export interface TranscriptionRequest {
  audio: Uint8Array
  mimeType: string
  durationMs: number
  languageOverride?: string
  context?: ContextSnapshot
}

export interface ContextSnapshot {
  application?: string
  clipboard?: string
  selectedText?: string
}

export interface TranscriptionResult {
  text: string
  rawText: string
  historyItem: HistoryItem
  pasted: boolean
  learnedVocabulary: string[]
}

export interface PermissionState {
  microphone: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
  accessibility: boolean
}

export interface SyncStatus {
  enabled: boolean
  folderPath: string
  state: 'off' | 'syncing' | 'synced' | 'error'
  lastSyncedAt: number
  lastError: string
}

export interface MeetingAudioSegment {
  audio: Uint8Array
  mimeType: string
  durationMs: number
}

export interface MeetingRequest {
  title: string
  source: 'google-meet' | 'zoom' | 'conversation' | 'other'
  segments: MeetingAudioSegment[]
  durationMs: number
  startedAt: number
}

export interface MeetingRecord {
  id: string
  title: string
  source: MeetingRequest['source']
  createdAt: number
  durationMs: number
  transcript: string
  notes: string
  provider: ProviderId
}

export interface MeetingCaptureSupport {
  platform: 'mac' | 'windows' | 'other'
  systemAudio: 'supported' | 'system-picker' | 'unavailable'
  detail: string
}

export interface CalendarEvent {
  id: string
  title: string
  startsAt: number
  endsAt: number
  joinUrl: string
  provider: 'google-meet' | 'zoom' | 'other'
}

export interface CalendarStatus {
  connected: boolean
  clientId: string
  accountEmail: string
  error: string
}

export interface DesktopAPI {
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
  getHistory(): Promise<HistoryItem[]>
  clearHistory(): Promise<void>
  deleteHistory(id: string): Promise<void>
  copyText(text: string): Promise<void>
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>
  transcribeFile(): Promise<TranscriptionResult | null>
  captureContext(): Promise<ContextSnapshot>
  cancelRecording(): Promise<void>
  setShortcutCaptureActive(active: boolean): Promise<void>
  getPermissions(): Promise<PermissionState>
  requestMicrophonePermission(): Promise<boolean>
  openAccessibilitySettings(): Promise<void>
  showMainWindow(): Promise<void>
  getSyncStatus(): Promise<SyncStatus>
  chooseSyncFolder(): Promise<SyncStatus>
  syncNow(): Promise<SyncStatus>
  disableSync(): Promise<SyncStatus>
  getMeetings(): Promise<MeetingRecord[]>
  saveMeeting(request: MeetingRequest): Promise<MeetingRecord>
  deleteMeeting(id: string): Promise<void>
  getMeetingCaptureSupport(): Promise<MeetingCaptureSupport>
  getCalendarStatus(): Promise<CalendarStatus>
  connectGoogleCalendar(clientId: string): Promise<CalendarStatus>
  disconnectGoogleCalendar(): Promise<CalendarStatus>
  getCalendarEvents(): Promise<CalendarEvent[]>
  openExternal(url: string): Promise<void>
  onRecordingToggle(callback: (languageOverride?: string) => void): () => void
  onRecordingCancel(callback: () => void): () => void
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void
  onHistoryChanged(callback: () => void): () => void
  onMeetingsChanged(callback: () => void): () => void
  onSyncStatus(callback: (status: SyncStatus) => void): () => void
}
