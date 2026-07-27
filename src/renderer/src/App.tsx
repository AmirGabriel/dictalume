import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  AudioLines,
  Brain,
  Check,
  ChevronRight,
  Clipboard,
  Cloud,
  Clock3,
  Code2,
  Command,
  Copy,
  ExternalLink,
  FileAudio,
  FileText,
  FolderSync,
  KeyRound,
  Languages,
  MessageSquareText,
  Mic,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Users,
  WandSparkles
} from 'lucide-react'
import { siDeepgram, siOpenai } from 'simple-icons'
import type {
  AppSettings,
  HistoryItem,
  ModeId,
  PermissionState,
  ProviderId,
  SyncStatus
} from '../../shared/types'
import { MeetingPage } from './MeetingPage'
import { captureShortcut, formatShortcut } from './shortcuts'

type Page = 'home' | 'meetings' | 'history' | 'modes' | 'providers' | 'sync' | 'general'
const isMacOS = navigator.userAgent.includes('Mac')

const navigation: Array<{ id: Page; label: string; icon: typeof Mic }> = [
  { id: 'home', label: 'Dictation', icon: AudioLines },
  { id: 'meetings', label: 'Meetings', icon: Users },
  { id: 'history', label: 'History', icon: Clock3 },
  { id: 'modes', label: 'Modes', icon: WandSparkles },
  { id: 'providers', label: 'Providers', icon: Radio },
  { id: 'sync', label: 'Sync', icon: Cloud },
  { id: 'general', label: 'General', icon: Settings2 }
]

const modeIcons: Record<string, typeof Mic> = {
  dictation: FileText,
  code: Code2,
  message: MessageSquareText,
  raw: Mic
}

const providerDescriptions: Record<ProviderId, string> = {
  openai: 'Fast, high-quality transcription and cleanup',
  grok: 'xAI speech-to-text with optional Grok cleanup',
  groq: 'Groq Cloud’s fast Whisper transcription',
  deepgram: 'Streaming-grade speech recognition',
  custom: 'Any OpenAI-compatible transcription server'
}

function ProviderIcon({ id }: { id: ProviderId }): React.JSX.Element {
  if (id === 'openai' || id === 'deepgram') {
    const icon = id === 'openai' ? siOpenai : siDeepgram
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={icon.path} fill="currentColor" />
      </svg>
    )
  }
  if (id === 'grok') {
    return <span className="provider-wordmark provider-wordmark-xai" aria-hidden="true">xAI</span>
  }
  if (id === 'groq') {
    return <span className="provider-wordmark provider-wordmark-groq" aria-hidden="true">groq</span>
  }
  return <span className="provider-wordmark provider-wordmark-custom" aria-hidden="true">&lt;/&gt;</span>
}

function ProviderMark({
  id,
  compact = false
}: {
  id: ProviderId
  compact?: boolean
}): React.JSX.Element {
  return (
    <span
      className={`provider-glyph provider-${id} ${compact ? 'provider-glyph-compact' : ''}`}
      aria-hidden="true"
    >
      <ProviderIcon id={id} />
    </span>
  )
}

function Shortcut({ value }: { value: string }): React.JSX.Element {
  const keys = value
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .split('+')
  return (
    <span className="shortcut">
      {keys.map((key) => (
        <kbd key={key}>{key === 'Space' ? 'Space' : key}</kbd>
      ))}
    </span>
  )
}

function ShortcutRecorder({
  label,
  value,
  optional = false,
  onChange
}: {
  label: string
  value: string
  optional?: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const [capturing, setCapturing] = useState(false)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')

  const beginCapture = (): void => {
    if (capturing) return
    setCapturing(true)
    setPreview('')
    setError('')
    void window.desktop.setShortcutCaptureActive(true)
  }

  const endCapture = (): void => {
    if (!capturing) return
    setCapturing(false)
    setPreview('')
    void window.desktop.setShortcutCaptureActive(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      setError('')
      event.currentTarget.blur()
      return
    }

    if (
      optional &&
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      onChange('')
      event.currentTarget.blur()
      return
    }

    const result = captureShortcut(event, isMacOS)
    if (result.kind === 'invalid') {
      setError(result.message)
      return
    }

    setError('')
    setPreview(formatShortcut(result.accelerator, isMacOS))
    if (result.kind === 'complete') {
      onChange(result.accelerator)
      event.currentTarget.blur()
    }
  }

  const visibleValue = capturing
    ? preview || 'Press your shortcut…'
    : value
      ? formatShortcut(value, isMacOS)
      : 'Not set'

  return (
    <div className={`shortcut-field ${capturing ? 'shortcut-field-listening' : ''}`}>
      <span className="label-line">
        <span>{label}</span>
        {optional && <small>Optional</small>}
      </span>
      <button
        type="button"
        className="shortcut-recorder"
        aria-label={`${label}. ${capturing ? 'Listening for a shortcut' : visibleValue}`}
        onFocus={beginCapture}
        onBlur={endCapture}
        onKeyDown={handleKeyDown}
      >
        <KeyRound size={15} aria-hidden="true" />
        <span className={value || capturing ? '' : 'shortcut-empty'}>{visibleValue}</span>
        {capturing && <kbd>esc</kbd>}
      </button>
      {error && <span className="shortcut-error" role="alert">{error}</span>}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'toggle-on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(timestamp)
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('home')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [savedSettings, setSavedSettings] = useState<AppSettings | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [permissions, setPermissions] = useState<PermissionState | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const refresh = async (): Promise<void> => {
    const [nextSettings, nextHistory, nextPermissions, nextSyncStatus] = await Promise.all([
      window.desktop.getSettings(),
      window.desktop.getHistory(),
      window.desktop.getPermissions(),
      window.desktop.getSyncStatus()
    ])
    setSettings(nextSettings)
    setSavedSettings(structuredClone(nextSettings))
    setHistory(nextHistory)
    setPermissions(nextPermissions)
    setSyncStatus(nextSyncStatus)
  }

  useEffect(() => {
    void refresh()
    return window.desktop.onSyncStatus(setSyncStatus)
  }, [])

  useEffect(() => {
    if (page === 'history') {
      void window.desktop.getHistory().then(setHistory)
    }
  }, [page])

  useEffect(
    () =>
      window.desktop.onHistoryChanged(() => {
        void window.desktop.getHistory().then(setHistory)
      }),
    []
  )

  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [settings, savedSettings]
  )

  const patchSettings = (patch: Partial<AppSettings>): void => {
    setSettings((current) => (current ? { ...current, ...patch } : current))
    setSaved(false)
  }

  const save = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    try {
      const result = await window.desktop.saveSettings(settings)
      setSettings(result)
      setSavedSettings(structuredClone(result))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <main className="app-loading">
        <div className="brand-mark"><AudioLines size={20} /></div>
        <span>Opening Dictalume…</span>
      </main>
    )
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="drag-region" />
        <div className="brand">
          <div className="brand-mark"><AudioLines size={18} /></div>
          <span>Dictalume</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={page === item.id ? 'nav-active' : ''}
                onClick={() => setPage(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-status">
          <span className="status-dot" />
          <div>
            <strong>Ready anywhere</strong>
            <Shortcut value={settings.shortcut} />
          </div>
        </div>
      </aside>

      <main className="content">
        {page === 'home' && (
          <HomePage
            settings={settings}
            permissions={permissions}
            patchSettings={patchSettings}
            openPage={setPage}
            refreshPermissions={async () => {
              setPermissions(await window.desktop.getPermissions())
            }}
          />
        )}
        {page === 'history' && (
          <HistoryPage
            history={history}
            onDelete={async (id) => {
              await window.desktop.deleteHistory(id)
              setHistory((items) => items.filter((item) => item.id !== id))
            }}
            onClear={async () => {
              await window.desktop.clearHistory()
              setHistory([])
            }}
          />
        )}
        {page === 'meetings' && <MeetingPage />}
        {page === 'modes' && (
          <ModesPage settings={settings} patchSettings={patchSettings} />
        )}
        {page === 'providers' && (
          <ProvidersPage settings={settings} patchSettings={patchSettings} />
        )}
        {page === 'sync' && (
          <SyncPage status={syncStatus} setStatus={setSyncStatus} />
        )}
        {page === 'general' && (
          <GeneralPage settings={settings} patchSettings={patchSettings} />
        )}
      </main>

      {(dirty || saved) && (
        <div className="save-bar" role="status">
          <span>{saved ? 'Changes saved' : 'You have unsaved changes'}</span>
          <button className="primary-button compact" onClick={() => void save()} disabled={saving || saved}>
            {saved ? <Check size={15} /> : <Save size={15} />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

function PageHeader({
  title,
  description
}: {
  title: string
  description: string
}): React.JSX.Element {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}

function HomePage({
  settings,
  permissions,
  patchSettings,
  openPage,
  refreshPermissions
}: {
  settings: AppSettings
  permissions: PermissionState | null
  patchSettings: (patch: Partial<AppSettings>) => void
  openPage: (page: Page) => void
  refreshPermissions: () => Promise<void>
}): React.JSX.Element {
  const mode = settings.modes[settings.mode]
  const ModeIcon = modeIcons[settings.mode] || WandSparkles
  const provider = settings.providers[settings.provider]
  const [fileStatus, setFileStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')

  return (
    <div className="page">
      <PageHeader
        title="Dictation"
        description="Speak into any app. Dictalume transcribes and pastes at your cursor."
      />

      <button
        className="file-action"
        disabled={fileStatus === 'working'}
        onClick={async () => {
          setFileStatus('working')
          try {
            const result = await window.desktop.transcribeFile()
            setFileStatus(result ? 'done' : 'idle')
            if (result) window.setTimeout(() => setFileStatus('idle'), 2200)
          } catch {
            setFileStatus('error')
          }
        }}
      >
        <FileAudio size={16} />
        {fileStatus === 'working'
          ? 'Transcribing file…'
          : fileStatus === 'done'
            ? 'Transcript copied'
            : fileStatus === 'error'
              ? 'File failed — check provider'
              : 'Transcribe audio or video'}
      </button>

      <section className="command-surface">
        <div className="command-orbit" aria-hidden="true">
          <Mic size={28} />
        </div>
        <div>
          <h2>Press your shortcut and speak</h2>
          <p>Press it again when you’re finished. Escape cancels.</p>
        </div>
        <Shortcut value={settings.shortcut} />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Current setup</h2>
            <p>What happens after your recording ends.</p>
          </div>
        </div>
        <div className="settings-list">
          <button className="settings-row" onClick={() => openPage('modes')}>
            <span className="row-icon"><ModeIcon size={17} /></span>
            <span className="row-main">
              <strong>{mode.name}</strong>
              <small>{mode.description}</small>
            </span>
            <span className="row-value">Mode</span>
            <ChevronRight size={16} />
          </button>
          <button className="settings-row" onClick={() => openPage('providers')}>
            <ProviderMark id={settings.provider} />
            <span className="row-main">
              <strong>{provider.name}</strong>
              <small>{provider.apiKey ? `${provider.model} · key configured` : 'API key needed'}</small>
            </span>
            <span className={`row-value ${provider.apiKey ? '' : 'warning-text'}`}>
              {provider.apiKey ? 'Connected' : 'Set up'}
            </span>
            <ChevronRight size={16} />
          </button>
          <div className="settings-row">
            <span className="row-icon"><Clipboard size={17} /></span>
            <span className="row-main">
              <strong>Paste automatically</strong>
              <small>Insert the transcript in the app you were using.</small>
            </span>
            <Toggle
              label="Paste automatically"
              checked={settings.autoPaste}
              onChange={(autoPaste) => patchSettings({ autoPaste })}
            />
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>{isMacOS ? 'Mac permissions' : 'System permissions'}</h2>
            <p>Required only for listening and automatic paste.</p>
          </div>
        </div>
        <div className="permission-grid">
          <div className="permission-item">
            <span className={`permission-state ${permissions?.microphone === 'granted' ? 'ok' : ''}`}>
              {permissions?.microphone === 'granted' ? <Check size={15} /> : <Mic size={15} />}
            </span>
            <div>
              <strong>Microphone</strong>
              <small>{permissions?.microphone === 'granted' ? 'Allowed' : 'Permission needed'}</small>
            </div>
            {permissions?.microphone !== 'granted' && (
              <button
                className="text-button"
                onClick={async () => {
                  await window.desktop.requestMicrophonePermission()
                  await refreshPermissions()
                }}
              >
                Allow
              </button>
            )}
          </div>
          <div className="permission-item">
            <span className={`permission-state ${permissions?.accessibility ? 'ok' : ''}`}>
              {permissions?.accessibility ? <Check size={15} /> : <Command size={15} />}
            </span>
            <div>
              <strong>Accessibility</strong>
              <small>{permissions?.accessibility ? 'Allowed' : 'Needed for paste and app context'}</small>
            </div>
            {!permissions?.accessibility && (
              <button
                className="text-button"
                onClick={() => void window.desktop.openAccessibilitySettings()}
              >
                Open settings <ExternalLink size={13} />
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function HistoryPage({
  history,
  onDelete,
  onClear
}: {
  history: HistoryItem[]
  onDelete: (id: string) => Promise<void>
  onClear: () => Promise<void>
}): React.JSX.Element {
  return (
    <div className="page">
      <PageHeader title="History" description="Your latest transcripts, stored locally and synced only when you enable it." />
      <div className="section-heading history-heading">
        <span>{history.length} transcript{history.length === 1 ? '' : 's'}</span>
        {history.length > 0 && (
          <button className="text-button danger" onClick={() => void onClear()}>
            <Trash2 size={14} /> Clear history
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Clock3 size={22} /></div>
          <h2>Your words will show up here</h2>
          <p>Use your global shortcut in any app. Transcripts are kept locally so you can reuse them.</p>
        </div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <article className="history-row" key={item.id}>
              <div className="history-meta">
                <span>{formatDate(item.createdAt)}</span>
                <span>{formatDuration(item.durationMs)}</span>
                <span>{item.provider}</span>
                <span>{item.mode}</span>
              </div>
              <p>{item.text}</p>
              {item.rawText !== item.text && (
                <details className="raw-transcript">
                  <summary>View original transcript</summary>
                  <p>{item.rawText}</p>
                </details>
              )}
              <div className="history-actions">
                <button
                  className="icon-text-button"
                  onClick={() => void window.desktop.copyText(item.text)}
                >
                  <Copy size={14} /> Copy
                </button>
                <button
                  className="icon-button danger"
                  aria-label="Delete transcript"
                  onClick={() => void onDelete(item.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function ModesPage({
  settings,
  patchSettings
}: {
  settings: AppSettings
  patchSettings: (patch: Partial<AppSettings>) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<ModeId>(settings.mode)
  const mode = settings.modes[editing] || settings.modes[settings.mode]
  const patchMode = (patch: Partial<typeof mode>): void => {
    patchSettings({
      modes: {
        ...settings.modes,
        [editing]: { ...mode, ...patch }
      }
    })
  }
  return (
    <div className="page">
      <PageHeader
        title="Modes"
        description="Choose how spoken thoughts become useful text."
      />
      <div className="mode-layout">
        <div className="mode-list" role="radiogroup" aria-label="Default mode">
          {(Object.keys(settings.modes) as ModeId[]).map((id) => {
            const item = settings.modes[id]
            const Icon = modeIcons[id] || WandSparkles
            return (
              <button
                key={id}
                role="radio"
                aria-checked={settings.mode === id}
                className={editing === id ? 'selected' : ''}
                onClick={() => setEditing(id)}
              >
                <span className="row-icon"><Icon size={17} /></span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                <span
                  className={`radio-dot ${settings.mode === id ? 'checked' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    patchSettings({ mode: id })
                  }}
                />
              </button>
            )
          })}
          <button
            className="add-mode"
            onClick={() => {
              const id = `custom-${Date.now()}`
              patchSettings({
                modes: {
                  ...settings.modes,
                  [id]: {
                    id,
                    name: 'Custom mode',
                    description: 'Your own voice workflow',
                    cleanup: true,
                    prompt:
                      'Rewrite the User Message according to my instructions. Return only the result.',
                    context: {
                      application: false,
                      clipboard: false,
                      selectedText: false
                    },
                    activateFor: []
                  }
                },
                mode: id
              })
              setEditing(id)
            }}
          >
            <span className="row-icon"><Plus size={17} /></span>
            <span><strong>New custom mode</strong><small>Add instructions and context</small></span>
          </button>
        </div>
        <div className="editor-panel">
          <div className="form-heading">
            <div>
              <h2>{mode.name}</h2>
              <p>Edit the cleanup instruction used after transcription.</p>
            </div>
            <Toggle
              label="Enable AI cleanup"
              checked={mode.cleanup}
              onChange={(cleanup) => patchMode({ cleanup })}
            />
          </div>
          {editing.startsWith('custom-') && (
            <button
              className="delete-mode"
              onClick={() => {
                const nextModes = { ...settings.modes }
                delete nextModes[editing]
                patchSettings({
                  modes: nextModes,
                  mode: settings.mode === editing ? 'dictation' : settings.mode
                })
                setEditing('dictation')
              }}
            >
              <Trash2 size={14} /> Delete custom mode
            </button>
          )}
          <label>
            Mode name
            <input value={mode.name} onChange={(event) => patchMode({ name: event.target.value })} />
          </label>
          <label>
            Description
            <input
              value={mode.description}
              onChange={(event) => patchMode({ description: event.target.value })}
            />
          </label>
          <label>
            Cleanup prompt
            <textarea
              rows={8}
              disabled={!mode.cleanup}
              value={mode.prompt}
              onChange={(event) => patchMode({ prompt: event.target.value })}
            />
          </label>
          <fieldset className="context-fieldset" disabled={!mode.cleanup}>
            <legend>Context awareness</legend>
            <div className="context-options">
              <label>
                <Toggle
                  label="Use active application context"
                  checked={mode.context.application}
                  onChange={(application) =>
                    patchMode({ context: { ...mode.context, application } })
                  }
                />
                <span><strong>Application</strong><small>App name, window title, date, and user</small></span>
              </label>
              <label>
                <Toggle
                  label="Use selected text"
                  checked={mode.context.selectedText}
                  onChange={(selectedText) =>
                    patchMode({ context: { ...mode.context, selectedText } })
                  }
                />
                <span><strong>Selected text</strong><small>Highlighted text at recording start</small></span>
              </label>
              <label>
                <Toggle
                  label="Use clipboard context"
                  checked={mode.context.clipboard}
                  onChange={(clipboard) =>
                    patchMode({ context: { ...mode.context, clipboard } })
                  }
                />
                <span><strong>Clipboard</strong><small>Text currently copied on your computer</small></span>
              </label>
            </div>
          </fieldset>
          <label>
            Activate automatically in
            <input
              placeholder="Cursor, Visual Studio Code, Xcode"
              value={mode.activateFor.join(', ')}
              onChange={(event) =>
                patchMode({
                  activateFor: event.target.value
                    .split(',')
                    .map((name) => name.trim())
                    .filter(Boolean)
                })
              }
            />
          </label>
          <p className="field-help">
            Comma-separated macOS app names. This mode becomes active when recording starts there.
          </p>
          <p className="field-help">
            The original transcript is always preserved in History.
          </p>
        </div>
      </div>
    </div>
  )
}

function ProvidersPage({
  settings,
  patchSettings
}: {
  settings: AppSettings
  patchSettings: (patch: Partial<AppSettings>) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<ProviderId>(settings.provider)
  const provider = settings.providers[editing]
  const patchProvider = (patch: Partial<typeof provider>): void => {
    patchSettings({
      providers: {
        ...settings.providers,
        [editing]: { ...provider, ...patch }
      }
    })
  }

  return (
    <div className="page">
      <PageHeader
        title="Providers"
        description={`Audio goes directly from this ${isMacOS ? 'Mac' : 'PC'} to the provider you select.`}
      />
      <div className="provider-layout">
        <div className="provider-list" role="radiogroup" aria-label="Transcription provider">
          {(Object.keys(settings.providers) as ProviderId[]).map((id) => {
            const item = settings.providers[id]
            return (
              <button
                key={id}
                role="radio"
                aria-checked={settings.provider === id}
                className={editing === id ? 'selected' : ''}
                onClick={() => setEditing(id)}
              >
                <ProviderMark id={id} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.apiKey ? 'Key configured' : providerDescriptions[id]}</small>
                </span>
                <span
                  className={`radio-dot ${settings.provider === id ? 'checked' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    patchSettings({ provider: id })
                  }}
                />
              </button>
            )
          })}
        </div>
        <div className="editor-panel">
          <div className="form-heading">
            <div className="provider-heading">
              <ProviderMark id={editing} />
              <div>
                <h2>{provider.name}</h2>
                <p>{providerDescriptions[editing]}</p>
              </div>
            </div>
            {settings.provider === editing && <span className="active-badge"><Check size={13} /> Active</span>}
          </div>
          <label>
            API key
            <div className="input-with-icon">
              <KeyRound size={15} />
              <input
                type="password"
                autoComplete="off"
                placeholder={editing === 'custom' ? 'Optional for local servers' : 'Paste API key'}
                value={provider.apiKey}
                onChange={(event) => patchProvider({ apiKey: event.target.value })}
              />
            </div>
          </label>
          {editing !== 'grok' && (
            <label>
              Speech model
              <div className="provider-control provider-model-control">
                <ProviderMark id={editing} compact />
                <input
                  aria-label={`${provider.name} speech model`}
                  value={provider.model}
                  onChange={(event) => patchProvider({ model: event.target.value })}
                />
                <span className="provider-control-name">{provider.name}</span>
              </div>
            </label>
          )}
          {editing === 'grok' && (
            <p className="field-help provider-capability">
              xAI selects its Speech-to-Text model automatically. Choose Grok · xAI and set
              Grok 4.5 as the cleanup model in General if you also want xAI to polish transcripts.
            </p>
          )}
          <label>
            Base URL
            <input
              spellCheck={false}
              value={provider.baseUrl}
              onChange={(event) => patchProvider({ baseUrl: event.target.value })}
            />
          </label>
          <p className="security-note">
            <KeyRound size={14} />
            API keys are encrypted with {isMacOS ? 'the macOS Keychain' : 'Windows DPAPI'} and never leave this device except in requests to this URL.
          </p>
        </div>
      </div>
    </div>
  )
}

function SyncPage({
  status,
  setStatus
}: {
  status: SyncStatus | null
  setStatus: (status: SyncStatus) => void
}): React.JSX.Element {
  const enabled = Boolean(status?.enabled)
  const statusLabel =
    status?.state === 'syncing'
      ? 'Syncing…'
      : status?.state === 'error'
        ? 'Needs attention'
        : enabled
          ? 'Up to date'
          : 'Not configured'

  return (
    <div className="page form-page">
      <PageHeader
        title="Sync"
        description="Keep the same writing context on your Mac and Windows PC."
      />

      <section className="section-block">
        <div className="sync-heading">
          <span className={`sync-orbit ${status?.state === 'error' ? 'sync-error' : ''}`}>
            {status?.state === 'syncing'
              ? <RefreshCw className="spin" size={21} />
              : <Cloud size={21} />}
          </span>
          <div>
            <h2>{statusLabel}</h2>
            <p>
              {enabled
                ? status?.lastSyncedAt
                  ? `Last synced ${formatDate(status.lastSyncedAt)}`
                  : 'Preparing the shared context for the first time.'
                : 'Choose the same cloud-synced folder on both computers.'}
            </p>
          </div>
        </div>

        {status?.lastError && (
          <p className="sync-error-message" role="alert">{status.lastError}</p>
        )}

        {enabled && (
          <label>
            Shared folder
            <div className="sync-path">
              <FolderSync size={16} />
              <span>{status?.folderPath}</span>
            </div>
          </label>
        )}

        <div className="sync-actions">
          <button
            className="primary-button"
            onClick={async () => setStatus(await window.desktop.chooseSyncFolder())}
          >
            <FolderSync size={15} />
            {enabled ? 'Change folder' : 'Choose sync folder'}
          </button>
          {enabled && (
            <>
              <button
                className="secondary-button"
                disabled={status?.state === 'syncing'}
                onClick={async () => setStatus(await window.desktop.syncNow())}
              >
                <RefreshCw size={15} />
                Sync now
              </button>
              <button
                className="text-button danger"
                onClick={async () => setStatus(await window.desktop.disableSync())}
              >
                Turn off
              </button>
            </>
          )}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>Shared context</h2>
            <p>These stay consistent as you move between computers.</p>
          </div>
        </div>
        <div className="settings-list">
          <div className="settings-row">
            <span className="row-icon"><Brain size={17} /></span>
            <span className="row-main">
              <strong>Writing memory</strong>
              <small>Learned spellings, vocabulary, and preferred terminology.</small>
            </span>
            <Check size={16} className="sync-check" />
          </div>
          <div className="settings-row">
            <span className="row-icon"><WandSparkles size={17} /></span>
            <span className="row-main">
              <strong>Modes and prompts</strong>
              <small>Cleanup instructions, app context rules, providers, and models.</small>
            </span>
            <Check size={16} className="sync-check" />
          </div>
          <div className="settings-row">
            <span className="row-icon"><Clock3 size={17} /></span>
            <span className="row-main">
              <strong>History and preferences</strong>
              <small>Transcripts, languages, shortcuts, and general behavior.</small>
            </span>
            <Check size={16} className="sync-check" />
          </div>
        </div>
      </section>

      <section className="section-block">
        <p className="security-note">
          <ShieldCheck size={15} />
          API keys stay in macOS Keychain or Windows DPAPI and are never written to the shared folder.
          Configure each key once on each computer; everything it operates on stays synchronized.
        </p>
      </section>
    </div>
  )
}

function GeneralPage({
  settings,
  patchSettings
}: {
  settings: AppSettings
  patchSettings: (patch: Partial<AppSettings>) => void
}): React.JSX.Element {
  const cleanupProviderId =
    settings.cleanupProvider === 'same' ? settings.provider : settings.cleanupProvider
  const cleanupProvider = settings.providers[cleanupProviderId]
  const patchCleanupProvider = (cleanupModel: string): void => {
    patchSettings({
      providers: {
        ...settings.providers,
        [cleanupProviderId]: { ...cleanupProvider, cleanupModel }
      }
    })
  }

  return (
    <div className="page form-page">
      <PageHeader title="General" description="Tune Dictalume to the way you work." />
      <section className="section-block">
        <div className="section-heading"><div><h2>Shortcut</h2><p>Works while Dictalume is running in the menu bar.</p></div></div>
        <ShortcutRecorder
          label="Global shortcut"
          value={settings.shortcut}
          onChange={(shortcut) => patchSettings({ shortcut })}
        />
        <p className="field-help">Click the field, then press the key combination you want.</p>
        <ShortcutRecorder
          label="Change mode shortcut"
          value={settings.changeModeShortcut}
          onChange={(changeModeShortcut) => patchSettings({ changeModeShortcut })}
        />
        <div className="paired-fields">
          <ShortcutRecorder
            label="English shortcut"
            optional
            value={settings.languageShortcuts.en}
            onChange={(en) =>
              patchSettings({
                languageShortcuts: {
                  ...settings.languageShortcuts,
                  en
                }
              })
            }
          />
          <ShortcutRecorder
            label="Portuguese shortcut"
            optional
            value={settings.languageShortcuts.pt}
            onChange={(pt) =>
              patchSettings({
                languageShortcuts: {
                  ...settings.languageShortcuts,
                  pt
                }
              })
            }
          />
        </div>
        <p className="field-help">
          Language shortcuts override automatic detection for one recording. Focus an optional shortcut and press Delete to clear it.
        </p>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><h2>Transcription</h2><p>Long-form, multilingual defaults used for every new recording.</p></div></div>
        <label>
          Spoken language
          <select value={settings.language} onChange={(event) => patchSettings({ language: event.target.value })}>
            <option value="auto">Detect automatically</option>
            <option value="en">English</option>
            <option value="pt">Portuguese</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="it">Italian</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
          </select>
        </label>
        <p className="field-help">
          Automatic detection works per recording and supports Portuguese and English. Choosing a language can improve accuracy when you already know what you’ll speak.
        </p>
        <div className="settings-list compact-list">
          <div className="settings-row">
            <span className="row-icon"><Timer size={17} /></span>
            <span className="row-main">
              <strong>Long recordings</strong>
              <small>Speech-optimized compression keeps 5–10+ minute recordings small enough for common provider limits.</small>
            </span>
            <span className="active-badge"><Check size={13} /> Ready</span>
          </div>
        </div>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><h2>AI polish and writing memory</h2><p>Add punctuation, remove filler, and remember the spellings you teach.</p></div></div>
        <label>
          AI provider
          <div className="provider-control provider-select-control">
            <ProviderMark id={cleanupProviderId} compact />
            <select
              aria-label="AI cleanup provider"
              value={settings.cleanupProvider}
              onChange={(event) =>
                patchSettings({
                  cleanupProvider: event.target.value as AppSettings['cleanupProvider']
                })
              }
            >
              <option value="same">Same as transcription</option>
              <option value="openai">OpenAI</option>
              <option value="grok">Grok · xAI</option>
              <option value="groq">Groq Cloud</option>
              <option value="custom">Custom OpenAI-compatible</option>
            </select>
          </div>
        </label>
        {cleanupProviderId !== 'deepgram' && (
          <label>
            Polish model
            <div className="provider-control provider-model-control">
              <ProviderMark id={cleanupProviderId} compact />
              <input
                aria-label={`${cleanupProvider.name} polish model`}
                value={cleanupProvider.cleanupModel}
                onChange={(event) => patchCleanupProvider(event.target.value)}
              />
              <span className="provider-control-name">{cleanupProvider.name}</span>
            </div>
          </label>
        )}
        <div className="settings-list compact-list">
          <div className="settings-row">
            <span className="row-icon"><Brain size={17} /></span>
            <span className="row-main">
              <strong>Learn spellings automatically</strong>
              <small>“Write it N-I-X” adds NIX to your private writing memory.</small>
            </span>
            <Toggle
              label="Learn spellings automatically"
              checked={settings.automaticMemory}
              onChange={(automaticMemory) => patchSettings({ automaticMemory })}
            />
          </div>
        </div>
        <label>
          Writing memory
          <textarea
            rows={6}
            placeholder={'Learned spellings appear here. You can also add your own:\nHRP — always uppercase\nKlabin — spell exactly like this'}
            value={settings.vocabulary}
            onChange={(event) => patchSettings({ vocabulary: event.target.value })}
          />
        </label>
        <p className="field-help">
          Stored on this device and sent with transcription and AI-polish requests to your selected provider. Nothing is stored on a Dictalume server.
        </p>
      </section>
      <section className="section-block">
        <div className="settings-list">
          <div className="settings-row">
            <span className="row-icon"><Clipboard size={17} /></span>
            <span className="row-main"><strong>Copy every transcript</strong><small>Keep text on the clipboard even if auto-paste is off.</small></span>
            <Toggle label="Copy every transcript" checked={settings.copyToClipboard} onChange={(copyToClipboard) => patchSettings({ copyToClipboard })} />
          </div>
          <div className="settings-row">
            <span className="row-icon"><Sparkles size={17} /></span>
            <span className="row-main"><strong>Sound effects</strong><small>Play subtle start and finish feedback.</small></span>
            <Toggle label="Sound effects" checked={settings.soundEffects} onChange={(soundEffects) => patchSettings({ soundEffects })} />
          </div>
          <div className="settings-row">
            <span className="row-icon"><Command size={17} /></span>
            <span className="row-main"><strong>Launch at login</strong><small>Keep dictation ready after you sign in.</small></span>
            <Toggle label="Launch at login" checked={settings.launchAtLogin} onChange={(launchAtLogin) => patchSettings({ launchAtLogin })} />
          </div>
        </div>
      </section>
    </div>
  )
}
