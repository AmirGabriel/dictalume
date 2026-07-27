import { clipboard } from 'electron'
import { spawn } from 'node:child_process'

export function copyText(text: string): void {
  clipboard.writeText(text)
}

export function pasteFromClipboard(): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable =
      process.platform === 'win32' ? 'powershell.exe' : '/usr/bin/osascript'
    const args =
      process.platform === 'win32'
        ? [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
          ]
        : ['-e', 'tell application "System Events" to keystroke "v" using command down']
    const child = spawn(executable, args, {
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let error = ''
    child.stderr.on('data', (chunk) => {
      error += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(error.trim() || 'The operating system did not allow automatic paste.'))
    })
  })
}
