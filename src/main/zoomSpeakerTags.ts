import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const ZOOM_ACCESSIBILITY_SCRIPT = `
tell application "System Events"
  if not (exists application process "zoom.us") then return ""
  tell application process "zoom.us"
    if not (exists front window) then return ""
    set allElements to entire contents of front window
    repeat with currentElement in allElements
      set candidateText to ""
      try
        set candidateText to candidateText & " " & (name of currentElement as text)
      end try
      try
        set candidateText to candidateText & " " & (description of currentElement as text)
      end try
      try
        set candidateText to candidateText & " " & (value of currentElement as text)
      end try
      ignoring case
        if candidateText contains "is speaking" or candidateText contains "active speaker" or candidateText contains "está falando" then
          return candidateText
        end if
      end ignoring
    end repeat
  end tell
end tell
return ""
`

export const ZOOM_CONSENT_SCRIPT = `
on run argv
  if (count of argv) is 0 then return "no-message"
  set consentMessage to item 1 of argv
  tell application "System Events"
    if not (exists application process "zoom.us") then return "no-zoom"
    tell application process "zoom.us"
      if frontmost is false then return "not-front"
      keystroke "h" using {command down, shift down}
      delay 0.4
      if not (exists front window) then return "no-window"
      set allElements to entire contents of front window
      repeat with currentElement in allElements
        set candidateText to ""
        set candidateRole to ""
        try
          set candidateRole to role of currentElement as text
        end try
        try
          set candidateText to candidateText & " " & (name of currentElement as text)
        end try
        try
          set candidateText to candidateText & " " & (description of currentElement as text)
        end try
        ignoring case
          if (candidateRole is "AXTextArea" or candidateRole is "AXTextField") and (candidateText contains "message" or candidateText contains "chat" or candidateText contains "mensagem") then
            try
              set value of currentElement to consentMessage
              set focused of currentElement to true
              key code 36
              return "sent"
            end try
          end if
        end ignoring
      end repeat
    end tell
  end tell
  return "no-field"
end run
`

export function isZoomSelfSpeakerCandidate(value: string): boolean {
  return /\((?:me|you|eu|você)\)/i.test(value)
}

export function parseZoomSpeakerCandidate(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const patterns = [
    /(?:video of\s+)?(.+?)(?:,|\s)+(?:is speaking|está falando)\b/i,
    /(?:active speaker|speaking|falando)\s*[:—-]\s*(.+)$/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const name = match?.[1]
      ?.replace(/^(?:name|participant)\s*[:—-]\s*/i, '')
      .replace(/\s*\((?:me|you|eu|você)\)\s*/gi, ' ')
      .trim()
      .slice(0, 80)
    if (
      name &&
      !/^(?:zoom|button|group|participant|active speaker)$/i.test(name)
    ) {
      return name
    }
  }
  return ''
}

export class ZoomConsentGate {
  private enabled = false
  private message = ''
  private sent = false
  private lastAttemptAt = 0

  configure(enabled: boolean, message: string): void {
    this.enabled = enabled
    this.message = message.trim().slice(0, 500)
  }

  reset(): void {
    this.sent = false
    this.lastAttemptAt = 0
  }

  messageForCandidate(candidate: string, now = Date.now()): string {
    if (
      !this.enabled ||
      !this.message ||
      this.sent ||
      isZoomSelfSpeakerCandidate(candidate) ||
      !parseZoomSpeakerCandidate(candidate) ||
      now - this.lastAttemptAt < 5_000
    ) {
      return ''
    }
    this.lastAttemptAt = now
    return this.message
  }

  markSent(): void {
    this.sent = true
  }
}

export class ZoomSpeakerTagPoller {
  private timer: NodeJS.Timeout | null = null
  private inFlight = false
  private consent = new ZoomConsentGate()

  constructor(private readonly onSpeaker: (name: string) => void) {}

  configureConsent(enabled: boolean, message: string): void {
    this.consent.configure(enabled, message)
  }

  setActive(active: boolean): void {
    if (process.platform !== 'darwin') return
    if (!active) {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      this.consent.reset()
      return
    }
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll(), 1_000)
  }

  stop(): void {
    this.setActive(false)
  }

  private async poll(): Promise<void> {
    if (this.inFlight) return
    this.inFlight = true
    try {
      const { stdout } = await execFileAsync('/usr/bin/osascript', [
        '-e',
        ZOOM_ACCESSIBILITY_SCRIPT
      ], {
        timeout: 1_400,
        maxBuffer: 64 * 1024
      })
      const name = parseZoomSpeakerCandidate(stdout)
      if (name && !isZoomSelfSpeakerCandidate(stdout)) this.onSpeaker(name)
      const consentMessage = this.consent.messageForCandidate(stdout)
      if (consentMessage) {
        const result = await execFileAsync('/usr/bin/osascript', [
          '-e',
          ZOOM_CONSENT_SCRIPT,
          consentMessage
        ], {
          timeout: 2_400,
          maxBuffer: 64 * 1024
        })
        if (result.stdout.trim() === 'sent') this.consent.markSent()
      }
    } catch {
      // Zoom may be closed or Accessibility may not be granted.
    } finally {
      this.inFlight = false
    }
  }
}
