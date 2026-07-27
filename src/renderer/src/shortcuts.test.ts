import { describe, expect, it } from 'vitest'
import { captureShortcut, formatShortcut, type ShortcutKeyInput } from './shortcuts'

function key(
  value: string,
  overrides: Partial<ShortcutKeyInput> = {}
): ShortcutKeyInput {
  return {
    key: value,
    code: value === ' ' ? 'Space' : `Key${value.toUpperCase()}`,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides
  }
}

describe('shortcut capture', () => {
  it('records a macOS command shortcut in cross-platform Electron format', () => {
    expect(captureShortcut(key(' ', { metaKey: true, shiftKey: true }), true)).toEqual({
      kind: 'complete',
      accelerator: 'CommandOrControl+Shift+Space'
    })
  })

  it('records a Windows control shortcut in cross-platform Electron format', () => {
    expect(captureShortcut(key('e', { ctrlKey: true, altKey: true }), false)).toEqual({
      kind: 'complete',
      accelerator: 'CommandOrControl+Alt+E'
    })
  })

  it('waits while only modifier keys are held', () => {
    expect(captureShortcut(key('Meta', { metaKey: true }), true)).toEqual({
      kind: 'modifier',
      accelerator: 'CommandOrControl'
    })
  })

  it('rejects shortcuts without a modifier', () => {
    expect(captureShortcut(key('p'), true)).toMatchObject({ kind: 'invalid' })
  })

  it('renders native-looking labels', () => {
    expect(formatShortcut('CommandOrControl+Shift+Space', true)).toBe('⌘  ⇧  Space')
    expect(formatShortcut('CommandOrControl+Alt+E', false)).toBe('Ctrl  Alt  E')
  })
})
