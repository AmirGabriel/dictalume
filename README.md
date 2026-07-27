# Dictalume

Dictalume is a macOS, Windows, and iPhone voice-to-text utility you own. On desktop, press a global shortcut in any app, speak, and press it again. On iPhone, record long thoughts or in-person conversations and insert the cleaned result from the companion keyboard.

There is no Dictalume subscription or proxy. You bring the API key.

> This repository intentionally contains no user credentials, recordings, transcripts, calendar data, or signing identities. Run `pnpm privacy:check` before committing changes.

## Features

- Global `⌘ ⇧ Space` / `Ctrl Shift Space` dictation shortcut
- Compact always-on-top recording overlay with live microphone levels
- OpenAI, Grok (xAI), Groq Cloud, Deepgram, and custom OpenAI-compatible providers
- Encrypted API keys through the operating system’s secure credential storage
- Dictation, coding-agent, message, and raw transcript modes
- Unlimited custom modes with editable cleanup prompts
- Optional active-app, selected-text, and clipboard context
- Automatic mode rules for apps such as Cursor, VS Code, Slack, or Messages
- Preferred vocabulary for job-specific names, acronyms, and spellings
- Automatic writing memory: say “write it N-I-X” and NIX is remembered for future recordings
- AI polish for punctuation, filler removal, tone, and mode-specific cleanup
- Speech-optimized 64 kbps recording for 5–10+ minute dictation
- Automatic language detection with optional English and Portuguese shortcut overrides
- Cross-device context sync through any shared OneDrive, Dropbox, iCloud Drive, or network folder
- Audio and video file transcription
- Automatic paste with clipboard fallback
- Local transcript history with copy and delete controls
- Configurable language, endpoint, models, startup, and shortcut
- Menu-bar mode switching, a dedicated mode shortcut, and deep-link automation
- Microphone and Accessibility permission guidance
- Audio-only Meet and Zoom recording with microphone + computer audio
- Segmented long-session uploads, full meeting transcripts, and AI notes
- Read-only Google Calendar connection with upcoming Meet and Zoom links
- Native iPhone conversation recorder and companion keyboard extension

## Run locally

Requirements: macOS or Windows and Node.js 20 or later.

```bash
pnpm install
pnpm dev
```

On first use:

1. Open **Providers**, select a provider, and enter its API key.
2. Open **Dictation** and allow Microphone access.
3. On macOS, enable **System Settings → Privacy & Security → Accessibility → Dictalume** for automatic paste, selected text, and active-app context. Windows does not need this extra permission.
4. Focus any text field, press `⌘ ⇧ Space`, speak, then press it again.

Without Accessibility permission, the transcript is still copied to your clipboard.

## Build the Mac app

```bash
pnpm package
```

The unpacked application is written to `dist/mac-*`. To produce a distributable DMG and ZIP, run `pnpm dist`. Public distribution requires an Apple Developer signing identity and notarization; local builds do not.

## Build the Windows app

```bash
pnpm build
pnpm exec electron-builder --win
```

The installer and portable executable are written to `dist`. Windows uses native PowerShell and SendKeys integration for context capture and paste, with no macOS-only runtime dependency.

## Provider notes

- **OpenAI:** default transcription model `gpt-4o-mini-transcribe`
- **Groq:** default transcription model `whisper-large-v3-turbo`
- **Grok · xAI:** uses xAI’s managed Speech-to-Text API at `/v1/stt`
- **Deepgram:** default model `nova-3`; transcript cleanup is skipped unless you use an OpenAI-compatible provider
- **Custom:** point the base URL at any server implementing `POST /v1/audio/transcriptions`; local servers may omit the API key

Cleanup can use the transcription provider or a separate OpenAI, Grok, Groq Cloud, or custom provider through its `/chat/completions` endpoint. The cleanup model is configurable. If cleanup fails, Dictalume preserves and returns the successful raw transcript.

Writing memory is stored locally in the app settings and sent as vocabulary guidance only to the transcription and cleanup providers you configure. Dictalume has no intermediary cloud or account service.

## Mac and Windows sync

Open **Sync** and choose a folder already synchronized by OneDrive, Dropbox, iCloud Drive, or another file-sync service. Choose that service’s matching folder on the other computer. Dictalume creates `Dictalume/context.json` there and automatically synchronizes every ten seconds.

The shared context includes writing memory, modes, prompts, provider and model choices, transcription history, language preferences, shortcuts, and general behavior. Concurrent changes are merged: vocabulary and history from both devices are retained, while the most recently edited scalar preference wins.

API keys and Google OAuth tokens are deliberately excluded. Configure them once on each computer so they remain protected by macOS Keychain and Windows DPAPI. Meeting notes and transcripts are included in the shared context.

## Meeting recording

Open **Meetings**, optionally choose an upcoming Google Calendar event, and start recording. Dictalume mixes the microphone with computer audio, records audio only, rotates the recording into four-minute files for provider-friendly long sessions, then transcribes each segment and creates structured notes.

Windows uses native loopback capture. On macOS 15 or later, choose the Meet or Zoom window in Apple’s system share picker and enable audio. If macOS does not return a system-audio track, the app shows that explicitly and lets you continue with microphone-only recording.

Google Calendar uses the read-only `calendar.events.readonly` scope. Because this app has no Dictalume backend, create a Desktop OAuth client in Google Cloud, enable the Calendar API, and paste its client ID in **Meetings**. The OAuth token is encrypted locally and never enters the shared context file.

## iPhone app and keyboard

The native project is in [`mobile/`](mobile/README.md). It includes long-form conversation recording, provider configuration, AI cleanup, English/Portuguese automatic detection, Keychain API-key storage, spelling memory, history, a shared `context.json` file picker, and an App Group keyboard extension.

Apple does not expose microphone access to third-party keyboard extensions. Dictalume follows the supported flow: record and transcribe in the containing app, return to the previous app, then tap **Insert latest transcript** on the familiar QWERTY keyboard. This is the closest App Store-compatible version of a transcription key.

## Automation

Dictalume registers two deep links:

```text
dictalume://record
dictalume://mode?id=code
```

Custom mode IDs are generated locally and can be used in the same `mode` link. You can also cycle modes with `⌘ ⌥ Space` or choose one from the menu bar.

## Privacy

Recordings exist in memory only long enough to send the transcription request. Audio files are not written to disk. History is stored locally under Electron’s application-data directory. API keys are encrypted using Electron `safeStorage`, backed by the macOS Keychain or Windows DPAPI.

## Repository safety

Generated applications, local runtime data, API credentials, OAuth tokens, Apple signing files, IDE user state, and synchronized `context.json` files are excluded from Git. CI runs a privacy scan before typechecking, testing, and building the project.

The package is marked `private` and `UNLICENSED` to prevent accidental npm publication or unintended redistribution. Choose an explicit open-source license later only if you decide to grant those rights.
