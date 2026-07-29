import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const app = {
    getVersion: vi.fn(() => '0.3.0'),
    isPackaged: false
  }
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    allowDowngrade: true,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn()
  }
  return { app, autoUpdater, handlers, openExternal: vi.fn(async () => undefined) }
})

vi.mock('electron', () => ({
  app: mocks.app,
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mocks.autoUpdater }
}))

import { UpdateManager } from './updater'

beforeEach(() => {
  vi.useRealTimers()
  mocks.app.isPackaged = false
  mocks.autoUpdater.checkForUpdates.mockClear()
  mocks.autoUpdater.downloadUpdate.mockClear()
  mocks.autoUpdater.quitAndInstall.mockClear()
  mocks.openExternal.mockClear()
})

describe('desktop updater', () => {
  it('does not contact the release server from a development build', async () => {
    const manager = new UpdateManager(() => undefined)
    const status = await manager.check()

    expect(status.state).toBe('current')
    expect(status.currentVersion).toBe('0.3.0')
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('moves through available, download, and ready states', async () => {
    mocks.app.isPackaged = true
    const statuses: string[] = []
    const manager = new UpdateManager((status) => statuses.push(status.state))

    mocks.handlers.get('update-available')?.({ version: '0.3.1' })
    expect(manager.getStatus()).toMatchObject({
      state: 'available',
      availableVersion: '0.3.1',
      canAutoInstall: true
    })

    await manager.download()
    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    mocks.handlers.get('download-progress')?.({ percent: 42.4 })
    expect(manager.getStatus()).toMatchObject({ state: 'downloading', progress: 42.4 })

    mocks.handlers.get('update-downloaded')?.({ version: '0.3.1' })
    expect(manager.getStatus()).toMatchObject({ state: 'ready', progress: 100 })
    manager.install()
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(statuses).toContain('available')
  })

  it('keeps the GitHub download available after an updater error', async () => {
    const manager = new UpdateManager(() => undefined)
    mocks.handlers.get('error')?.(new Error('network request failed'))
    expect(manager.getStatus()).toMatchObject({
      state: 'error',
      canAutoInstall: false
    })

    await manager.openDownload()
    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://github.com/AmirGabriel/dictalume/releases/latest'
    )
  })

  it('checks once after startup without downloading until the user accepts', async () => {
    vi.useFakeTimers()
    mocks.app.isPackaged = true
    const manager = new UpdateManager(() => undefined)

    manager.start(500)
    manager.start(500)
    await vi.advanceTimersByTimeAsync(499)
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    manager.stop()
  })

  it('does not start a background update check in development', async () => {
    vi.useFakeTimers()
    const manager = new UpdateManager(() => undefined)

    manager.start(0)
    await vi.runAllTimersAsync()

    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })
})
