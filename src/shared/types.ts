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
  meetingTemplates: MeetingTemplate[]
  meetingRecipes: MeetingRecipe[]
  meetingSpaces: MeetingSpace[]
  meetingConsentMessageEnabled: boolean
  meetingConsentMessage: string
  meetingTranscriptionProvider: 'same' | ProviderId
  meetingTranscriptRetentionDays: 0 | 7 | 30 | 90
}

export interface HistoryItem {
  id: string
  title?: string
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
  id: string
  audio: Uint8Array
  mimeType: string
  durationMs: number
  source: 'microphone' | 'system'
  startedAtMs: number
}

export interface MeetingTranscriptChunk {
  text: string
  startMs: number
  endMs: number
  diarizationLabel?: string
}

export interface MeetingSegmentTranscription {
  segmentId: string
  source: MeetingAudioSegment['source']
  startedAtMs: number
  durationMs: number
  chunks: MeetingTranscriptChunk[]
  learnedVocabulary: string[]
}

export interface MeetingLiveTranscriptionRequest {
  segment: MeetingAudioSegment
  meetingSource: MeetingRequest['source']
}

export type MeetingTemplateId = string

export interface MeetingTemplate {
  id: MeetingTemplateId
  name: string
  guidance: string
  builtIn?: boolean
}

export interface MeetingRecipe {
  id: string
  name: string
  prompt: string
  builtIn?: boolean
}

export interface MeetingSpace {
  id: string
  name: string
  description: string
  icon: string
  parentId?: string
  autoAddTitles: string[]
}

export interface MeetingRequest {
  title: string
  source: 'google-meet' | 'zoom' | 'conversation' | 'other'
  segments: MeetingAudioSegment[]
  durationMs: number
  startedAt: number
  userNotes: string
  attachments?: MeetingAttachment[]
  templateId: MeetingTemplateId
  transcriptions?: MeetingSegmentTranscription[]
  speakerNames?: Record<string, string>
  attendees?: CalendarAttendee[]
  calendarSeriesId?: string
  appendToMeetingId?: string
}

export interface MeetingSpeaker {
  id: string
  name: string
  source: MeetingAudioSegment['source']
  evidenceKey?: string
  diarizationLabel?: string
  diarizationScope?: string
}

export interface MeetingTranscriptTurn {
  id: string
  speakerId: string
  source: MeetingAudioSegment['source']
  startMs: number
  endMs: number
  text: string
}

export interface MeetingNoteEvidence {
  noteText: string
  turnIds: string[]
}

export interface MeetingAttachment {
  id: string
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  dataUrl: string
  createdAt: number
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
  speakers?: MeetingSpeaker[]
  transcriptTurns?: MeetingTranscriptTurn[]
  userNotes?: string
  attachments?: MeetingAttachment[]
  templateId?: MeetingTemplateId
  updatedAt?: number
  spaceIds?: string[]
  /** Legacy flat-space label retained for migration from versions before 0.5. */
  space?: string
  calendarSeriesId?: string
  deletedAt?: number
  transcriptDeletedAt?: number
  transcriptUpdatedAt?: number
  completedTodos?: string[]
  attendees?: CalendarAttendee[]
  chat?: MeetingChatMessage[]
  noteEvidence?: MeetingNoteEvidence[]
}

export interface MeetingUpdateRequest {
  meetingId: string
  title?: string
  speakers?: MeetingSpeaker[]
  transcriptTurns?: MeetingTranscriptTurn[]
  notes?: string
  userNotes?: string
  attachments?: MeetingAttachment[]
  completedTodos?: string[]
  templateId?: MeetingTemplateId
  spaceIds?: string[]
  space?: string
  regenerateNotes?: boolean
}

export interface MeetingExportRequest {
  meetingId: string
  format: 'markdown' | 'json'
}

export interface MeetingChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  provider?: Exclude<ProviderId, 'deepgram'>
}

export interface MeetingChatRequest {
  meetingId: string
  question: string
  provider: Exclude<ProviderId, 'deepgram'>
}

export interface MeetingLibraryChatRequest {
  question: string
  provider: Exclude<ProviderId, 'deepgram'>
}

export interface MeetingLibraryChatAnswer {
  answer: string
  meetingIds: string[]
  meetingTitles: string[]
}

export interface ApiUsageEvent {
  id: string
  createdAt: number
  provider: ProviderId
  model: string
  operation: 'transcription' | 'cleanup' | 'meeting-notes' | 'meeting-chat'
  costUsd: number | null
  exact: boolean
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  audioSeconds?: number
  detail: string
}

export interface ApiUsageSummary {
  totalUsd: number
  monthUsd: number
  exactUsd: number
  estimatedUsd: number
  unpricedRequests: number
  events: ApiUsageEvent[]
}

export type DesktopPlatform = 'mac' | 'windows' | 'linux'

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'manual'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  availableVersion: string
  progress: number
  message: string
  canAutoInstall: boolean
  releaseUrl: string
}

export interface MeetingCaptureSupport {
  platform: 'mac' | 'windows' | 'other'
  systemAudio: 'supported' | 'system-picker' | 'unavailable'
  detail: string
}

export interface MeetingIndicatorState {
  status: 'hidden' | 'recording' | 'paused' | 'reviewing' | 'processing'
  title: string
  elapsedMs: number
  systemAudio: boolean
  meetingSource?: MeetingRequest['source']
}

export type MeetingIndicatorAction = 'pause' | 'resume' | 'stop'

export interface SpeakerTagEvent {
  name: string
  capturedAt: number
  meetingUrl: string
  source: 'google-meet' | 'zoom'
}

export interface SpeakerTagStatus {
  connected: boolean
  clients: number
  port: number
  lastSpeaker: string
  lastSeenAt: number
  lastSource: SpeakerTagEvent['source'] | ''
  zoomSupported: boolean
  error: string
}

export interface CalendarEvent {
  id: string
  title: string
  startsAt: number
  endsAt: number
  joinUrl: string
  provider: 'google-meet' | 'zoom' | 'other'
  seriesId?: string
  attendees?: CalendarAttendee[]
}

export interface CalendarAttendee {
  name: string
  email?: string
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction'
}

export interface PreMeetingBriefRequest {
  event: CalendarEvent
  provider: Exclude<ProviderId, 'deepgram'>
}

export interface PreMeetingBrief {
  eventId: string
  content: string
  meetingIds: string[]
  meetingTitles: string[]
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
  getMeetings(includeDeleted?: boolean): Promise<MeetingRecord[]>
  saveMeeting(request: MeetingRequest): Promise<MeetingRecord>
  transcribeMeetingSegment(
    request: MeetingLiveTranscriptionRequest
  ): Promise<MeetingSegmentTranscription>
  updateMeeting(request: MeetingUpdateRequest): Promise<MeetingRecord>
  askMeeting(request: MeetingChatRequest): Promise<MeetingRecord>
  askMeetings(request: MeetingLibraryChatRequest): Promise<MeetingLibraryChatAnswer>
  deleteMeeting(id: string): Promise<void>
  restoreMeeting(id: string): Promise<MeetingRecord>
  permanentlyDeleteMeeting(id: string): Promise<void>
  exportMeeting(request: MeetingExportRequest): Promise<boolean>
  exportMeetingsCsv(): Promise<boolean>
  getMeetingCaptureSupport(): Promise<MeetingCaptureSupport>
  getMeetingIndicatorState(): Promise<MeetingIndicatorState>
  updateMeetingIndicator(state: MeetingIndicatorState): Promise<void>
  controlMeeting(action: MeetingIndicatorAction): Promise<void>
  getSpeakerTagStatus(): Promise<SpeakerTagStatus>
  getSpeakerTagEvents(startedAt: number, endedAt: number): Promise<SpeakerTagEvent[]>
  openSpeakerTagExtensionFolder(): Promise<void>
  getPlatform(): Promise<DesktopPlatform>
  getApiUsage(): Promise<ApiUsageSummary>
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  downloadUpdate(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  openUpdateDownload(): Promise<void>
  getCalendarStatus(): Promise<CalendarStatus>
  connectGoogleCalendar(clientId: string): Promise<CalendarStatus>
  disconnectGoogleCalendar(): Promise<CalendarStatus>
  getCalendarEvents(): Promise<CalendarEvent[]>
  getOutlookCalendarStatus(): Promise<CalendarStatus>
  connectOutlookCalendar(clientId: string): Promise<CalendarStatus>
  disconnectOutlookCalendar(): Promise<CalendarStatus>
  getOutlookCalendarEvents(): Promise<CalendarEvent[]>
  createPreMeetingBrief(request: PreMeetingBriefRequest): Promise<PreMeetingBrief>
  openExternal(url: string): Promise<void>
  onRecordingToggle(callback: (languageOverride?: string) => void): () => void
  onRecordingCancel(callback: () => void): () => void
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void
  onHistoryChanged(callback: () => void): () => void
  onMeetingsChanged(callback: () => void): () => void
  onMeetingIndicatorState(callback: (state: MeetingIndicatorState) => void): () => void
  onMeetingControl(callback: (action: MeetingIndicatorAction) => void): () => void
  onCalendarEventSelected(callback: (event: CalendarEvent) => void): () => void
  onApiUsageChanged(callback: (summary: ApiUsageSummary) => void): () => void
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  onSyncStatus(callback: (status: SyncStatus) => void): () => void
}
