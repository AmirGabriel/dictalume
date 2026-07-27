export interface ShortcutKeyInput {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type ShortcutCaptureResult =
  | { kind: 'modifier'; accelerator: string }
  | { kind: 'complete'; accelerator: string }
  | { kind: 'invalid'; message: string }

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift'])

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  Backspace: 'Backspace',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Home: 'Home',
  Insert: 'Insert',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  Spacebar: 'Space',
  Tab: 'Tab'
}

function modifierParts(input: ShortcutKeyInput, isMacOS: boolean): string[] {
  const parts: string[] = []
  if (input.metaKey) parts.push('CommandOrControl')
  if (input.ctrlKey) parts.push(isMacOS ? 'Control' : 'CommandOrControl')
  if (input.altKey) parts.push('Alt')
  if (input.shiftKey) parts.push('Shift')
  return [...new Set(parts)]
}

function acceleratorKey(input: ShortcutKeyInput): string | null {
  const named = NAMED_KEYS[input.key]
  if (named) return named
  if (/^[a-z]$/i.test(input.key)) return input.key.toUpperCase()
  if (/^[0-9]$/.test(input.key)) return input.key
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(input.key)) return input.key

  const numpadMatch = input.code.match(/^Numpad([0-9])$/)
  if (numpadMatch) return `num${numpadMatch[1]}`
  return null
}

export function captureShortcut(
  input: ShortcutKeyInput,
  isMacOS: boolean
): ShortcutCaptureResult {
  const modifiers = modifierParts(input, isMacOS)
  if (MODIFIER_KEYS.has(input.key)) {
    return { kind: 'modifier', accelerator: modifiers.join('+') }
  }

  if (modifiers.length === 0) {
    return {
      kind: 'invalid',
      message: isMacOS
        ? 'Hold ⌘, ⌥, Control, or Shift while pressing a key.'
        : 'Hold Ctrl, Alt, or Shift while pressing a key.'
    }
  }

  const key = acceleratorKey(input)
  if (!key) {
    return {
      kind: 'invalid',
      message: 'That key is not supported. Try a letter, number, function key, or Space.'
    }
  }

  return { kind: 'complete', accelerator: [...modifiers, key].join('+') }
}

export function formatShortcut(accelerator: string, isMacOS: boolean): string {
  if (!accelerator) return ''
  const labels: Record<string, string> = isMacOS
    ? {
        Alt: '⌥',
        Command: '⌘',
        CommandOrControl: '⌘',
        Control: '⌃',
        Shift: '⇧'
      }
    : {
        Alt: 'Alt',
        Command: 'Win',
        CommandOrControl: 'Ctrl',
        Control: 'Ctrl',
        Shift: 'Shift'
      }
  return accelerator
    .split('+')
    .filter(Boolean)
    .map((part) => labels[part] || part)
    .join('  ')
}
