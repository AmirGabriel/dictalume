import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppSettings, ContextSnapshot } from '../shared/types'

const execFileAsync = promisify(execFile)

async function runAppleScript(source: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', source], {
    timeout: 2500
  })
  return stdout.trim()
}

async function runPowerShell(source: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', source],
    { timeout: 3000 }
  )
  return stdout.trim()
}

async function readApplicationContext(): Promise<string | undefined> {
  try {
    const appAndWindow =
      process.platform === 'win32'
        ? await runPowerShell(
            "Add-Type -Name Win32 -Namespace Native -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);'; $handle=[Native.Win32]::GetForegroundWindow(); $processId=0; [Native.Win32]::GetWindowThreadProcessId($handle,[ref]$processId) | Out-Null; $process=Get-Process -Id $processId; Write-Output $process.ProcessName; Write-Output $process.MainWindowTitle"
          )
        : await runAppleScript(
            'tell application "System Events" to tell (first application process whose frontmost is true) to return name & linefeed & name of front window'
          )
    return [
      appAndWindow,
      `Date: ${new Date().toLocaleString()}`,
      `Computer: ${process.env.USER || process.env.USERNAME || 'Desktop user'}`
    ].join('\n')
  } catch {
    return undefined
  }
}

export async function getFrontmostApplicationName(): Promise<string | undefined> {
  try {
    if (process.platform === 'win32') {
      const context = await readApplicationContext()
      return context?.split('\n')[0]
    }
    return await runAppleScript(
      'tell application "System Events" to get name of first application process whose frontmost is true'
    )
  } catch {
    return undefined
  }
}

async function readSelectedText(): Promise<string | undefined> {
  const previous = {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    bookmark: clipboard.readBookmark(),
    image: clipboard.readImage()
  }

  try {
    clipboard.clear()
    if (process.platform === 'win32') {
      await runPowerShell(
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')"
      )
    } else {
      await runAppleScript(
        'tell application "System Events" to keystroke "c" using command down'
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 140))
    return clipboard.readText().trim() || undefined
  } catch {
    return undefined
  } finally {
    clipboard.write({
      text: previous.text,
      html: previous.html,
      rtf: previous.rtf,
      bookmark: previous.bookmark.url,
      image: previous.image.isEmpty() ? undefined : previous.image
    })
  }
}

export async function captureContext(settings: AppSettings): Promise<ContextSnapshot> {
  const mode = settings.modes[settings.mode]
  const [application, selectedText] = await Promise.all([
    mode.context.application ? readApplicationContext() : undefined,
    mode.context.selectedText ? readSelectedText() : undefined
  ])
  const clipboardText = mode.context.clipboard ? clipboard.readText().trim() : ''

  return {
    application,
    selectedText,
    clipboard: clipboardText || undefined
  }
}
