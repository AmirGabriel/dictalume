import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

const RELEASE_URL = 'https://github.com/AmirGabriel/dictalume/releases/latest'
const { autoUpdater } = electronUpdater

function isPortableWindowsBuild(): boolean {
  return process.platform === 'win32' && Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('latest') && message.includes('404')) {
    return 'No published update channel was found yet.'
  }
  if (message.includes('signature') || message.includes('code sign')) {
    return 'macOS could not verify this update automatically.'
  }
  if (message.includes('network') || message.includes('internet') || message.includes('enotfound')) {
    return 'Could not reach GitHub. Check your internet connection.'
  }
  return 'The update could not be completed automatically.'
}

export class UpdateManager {
  private startupTimer: NodeJS.Timeout | null = null
  private startupCheckStarted = false
  private status: UpdateStatus = {
    state: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: '',
    progress: 0,
    message: 'Check GitHub for a newer version.',
    canAutoInstall: app.isPackaged && !isPortableWindowsBuild(),
    releaseUrl: RELEASE_URL
  }

  constructor(private readonly onStatus: (status: UpdateStatus) => void) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false

    autoUpdater.on('checking-for-update', () => {
      this.setStatus({
        state: 'checking',
        progress: 0,
        message: 'Checking GitHub for updates…'
      })
    })
    autoUpdater.on('update-not-available', () => {
      this.setStatus({
        state: 'current',
        availableVersion: '',
        progress: 0,
        message: 'You’re using the latest version.'
      })
    })
    autoUpdater.on('update-available', (info) => {
      const automatic = app.isPackaged && !isPortableWindowsBuild()
      this.setStatus({
        state: automatic ? 'available' : 'manual',
        availableVersion: info.version,
        progress: 0,
        canAutoInstall: automatic,
        message: automatic
          ? `Version ${info.version} is ready to download.`
          : `Version ${info.version} is available as a new installer.`
      })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.setStatus({
        state: 'downloading',
        progress: Math.max(0, Math.min(100, progress.percent)),
        message: `Downloading update… ${Math.round(progress.percent)}%`
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.setStatus({
        state: 'ready',
        availableVersion: info.version,
        progress: 100,
        message: 'Update downloaded. Restart Dictalume to finish.'
      })
    })
    autoUpdater.on('error', (error) => {
      this.setStatus({
        state: 'error',
        progress: 0,
        canAutoInstall: false,
        message: `${friendlyError(error)} You can still download it from GitHub.`
      })
    })
  }

  getStatus(): UpdateStatus {
    return { ...this.status }
  }

  start(delayMs = 12_000): void {
    if (this.startupCheckStarted || this.startupTimer || !app.isPackaged) return
    if (process.platform !== 'darwin' && process.platform !== 'win32') return
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      this.startupCheckStarted = true
      void this.check()
    }, Math.max(0, delayMs))
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.startupTimer = null
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      this.setStatus({
        state: 'current',
        message: 'Update checks are available in an installed build.'
      })
      return this.getStatus()
    }
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      this.setStatus({
        state: 'manual',
        canAutoInstall: false,
        message: 'Automatic updates are not available on this platform.'
      })
      return this.getStatus()
    }
    if (this.status.state === 'checking' || this.status.state === 'downloading') {
      return this.getStatus()
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.setStatus({
        state: 'error',
        canAutoInstall: false,
        message: `${friendlyError(error)} You can still download it from GitHub.`
      })
    }
    return this.getStatus()
  }

  async download(): Promise<UpdateStatus> {
    if (!this.status.canAutoInstall) {
      await this.openDownload()
      return this.getStatus()
    }
    try {
      this.setStatus({
        state: 'downloading',
        progress: 0,
        message: 'Starting download…'
      })
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.setStatus({
        state: 'error',
        progress: 0,
        canAutoInstall: false,
        message: `${friendlyError(error)} You can still download it from GitHub.`
      })
    }
    return this.getStatus()
  }

  install(): void {
    if (this.status.state !== 'ready') return
    autoUpdater.quitAndInstall(false, true)
  }

  async openDownload(): Promise<void> {
    await shell.openExternal(RELEASE_URL)
  }

  private setStatus(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.getStatus())
  }
}
