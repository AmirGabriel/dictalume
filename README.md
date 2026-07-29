# Dictalume

Dictalume is a macOS, Windows, and iPhone voice-to-text utility you own. On desktop, press a global shortcut in any app, speak, and press it again. On iPhone, record long thoughts or in-person conversations and insert the cleaned result from the companion keyboard.

There is no Dictalume subscription or proxy. You bring the API key.

> This repository intentionally contains no user credentials, recordings, transcripts, calendar data, or signing identities. Run `pnpm privacy:check` before committing changes.

## Features

- Global `⌘ ⇧ Space` / `Ctrl Shift Space` dictation shortcut
- Compact always-on-top recording overlay with live microphone levels and automatic input recovery
- OpenAI, Grok (xAI), Groq Cloud, Deepgram, and custom OpenAI-compatible providers
- Encrypted API keys through the operating system’s secure credential storage
- Dictation, coding-agent, message, and raw transcript modes
- Unlimited custom modes with editable cleanup prompts
- Optional active-app, selected-text, and clipboard context
- Automatic mode rules for apps such as Cursor, VS Code, Slack, or Messages
- Preferred vocabulary for job-specific names, acronyms, and spellings
- Automatic writing memory: say “write it N-I-X” and NIX is remembered for future recordings
- Lossless AI polish for punctuation, grammar, filler, repetition, and explicit spoken self-edits
- Speech-optimized 64 kbps recording for 5–10+ minute dictation
- Automatic language detection with optional English and Portuguese shortcut overrides
- Cross-device context sync through any shared OneDrive, Dropbox, iCloud Drive, or network folder
- Audio and video file transcription
- Automatic paste with clipboard fallback
- Local transcript history with copy and delete controls
- Configurable language, endpoint, models, startup, and shortcut
- Mac menu-bar and Windows system-tray access, mode switching, a dedicated mode shortcut, and deep-link automation
- Microphone and Accessibility permission guidance
- Audio-only Meet and Zoom recording with microphone + computer audio
- Live, source-labelled meeting transcripts with pause, resume, search, and a floating controller
- Conservative speaker labels, Deepgram diarization, calendar attendee suggestions, and per-turn corrections
- Optional local Chromium extension for Google Meet display-name speaker tags
- Opt-in automatic Zoom consent message on macOS, sent once after another participant speaks
- Structured summaries, key points, decisions, editable to-dos, open questions, full
  transcripts, Markdown personal notes, and pasted image attachments
- Persistent AI chat for every saved meeting, including Grok with the same configured xAI key
- Cross-meeting chat, pre-meeting briefs, reusable note templates and AI recipes
- Nested Spaces with icons, descriptions, multi-space membership, recurring auto-add rules,
  People & Companies, trash/restore, transcript retention, and Markdown/JSON/CSV export
- Local per-request API cost ledger with provider-reported and rate-calculated totals
- Read-only Google and Outlook Calendar connections with upcoming meeting notifications
- Native iPhone conversation recorder and companion keyboard extension

## Install on Windows

Download `Dictalume-0.4.0-Windows-Setup.exe` from the latest
[GitHub Release](https://github.com/AmirGabriel/dictalume/releases/latest) and run it. The installer creates Start menu and desktop
shortcuts; Node.js and pnpm are not required. If you cannot install software on that PC,
use `Dictalume-0.4.0-Windows-Portable.exe` instead.

Windows may show a SmartScreen warning while releases are unsigned. Choose **More info →
Run anyway** only when the file came from this repository.

## Run from source

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

## Build the Windows downloads

```bash
pnpm dist:win
```

The clearly named installer and portable executable are written to `dist`. Windows uses
native PowerShell and SendKeys integration for context capture and paste, with no
macOS-only runtime dependency. GitHub can build both on demand through **Actions →
Desktop builds and releases → Run workflow**.

## In-app updates

Version 0.3.0 introduces **General → Software update**. Existing installations from
before 0.3.0 must install this release manually once; after that, installed Windows builds
can check, download, and restart into future GitHub releases from inside Dictalume without
re-entering settings or API keys. The portable Windows build opens the latest installer
because portable executables cannot safely replace themselves.

The same button checks releases on Mac. Fully automatic Mac replacement requires an Apple
Developer ID signature, which is not configured in this public repository yet. Until it
is, the button opens the latest DMG when macOS rejects an automatic download. App data is
kept in the operating system’s application-data folder, so replacing the application does
not remove settings, vocabulary, history, meetings, or encrypted API keys.

## Provider notes

- **OpenAI:** default transcription model `gpt-4o-mini-transcribe`
- **Groq:** default transcription model `whisper-large-v3-turbo`
- **Grok · xAI:** uses xAI’s managed Speech-to-Text API at `/v1/stt`
- **Deepgram:** default model `nova-3`; transcript cleanup is skipped unless you use an OpenAI-compatible provider
- **Custom:** point the base URL at any server implementing `POST /v1/audio/transcriptions`; local servers may omit the API key

Cleanup can use the transcription provider or a separate OpenAI, Grok, Groq Cloud, or custom provider through its `/chat/completions` endpoint. A mandatory lossless-editing policy permits only punctuation, grammar correction, filler or repetition removal, preferred spellings, and explicit spoken deletion commands. It forbids summarizing, interpreting, inventing, or silently dropping information, and a local fidelity check rejects suspiciously lossy output. If cleanup fails either check, Dictalume preserves and returns the successful raw transcript.

Writing memory is stored locally in the app settings and sent as vocabulary guidance only to the transcription and cleanup providers you configure. Dictalume has no intermediary cloud or account service.

The bottom-right API total is stored locally as a per-request ledger. When a provider
returns an actual charged amount (currently xAI text responses), Dictalume records it
exactly. Otherwise it calculates from provider-reported tokens or billable audio duration
using official rates verified on July 27, 2026, including Groq’s 10-second minimum and
Deepgram keyterm charges. The ledger syncs with the rest of the shared context, so each
request ID is counted once across Mac and Windows. Unknown custom models remain visibly
unpriced instead of being guessed; the provider billing console remains the final invoice
source.

## Mac and Windows sync

Open **Sync** and choose a folder already synchronized by OneDrive, Dropbox, iCloud Drive, or another file-sync service. Choose that service’s matching folder on the other computer. Dictalume creates `Dictalume/context.json` there and automatically synchronizes every ten seconds.

The shared context includes writing memory, modes, prompts, provider and model choices, transcription history, language preferences, shortcuts, and general behavior. Concurrent changes are merged: vocabulary and history from both devices are retained, while the most recently edited scalar preference wins.

API keys and Google/Microsoft OAuth tokens are deliberately excluded. Configure them once on each computer so they remain protected by macOS Keychain and Windows DPAPI. Meeting notes, verified speaker corrections, spaces, task state, chat, and transcripts are included in the shared context.

## Meeting recording

Open **Meetings**, optionally choose an upcoming Google or Outlook Calendar event, and
start recording. Dictalume records audio only and deliberately keeps microphone and
computer audio in separate source-labelled tracks. Thirty-second chunks power the live
transcript and long recordings without sending the same audio twice. A floating controller
keeps pause, resume, and stop available while the main window is hidden.

Selecting a future calendar meeting explicitly arms that note: Dictalume opens audio
capture at the scheduled start time and shows the operating-system picker when required.
It also treats the scheduled end as an additional stop signal, but only after two minutes
without transcribed speech. Fifteen minutes of silence, the shared source ending, or the
computer suspending also stop capture safely.

For remote meetings, microphone speech is labelled **Me** and computer audio is kept
separate. Deepgram can diarize speakers inside the remote or in-person track; names remain
anonymous until calendar evidence or the user confirms them. After recording, Dictalume
offers a speaker-confirmation step before the first notes request; confirmed names become
authoritative labels without a second AI charge. Any saved transcript turn can still be
reassigned later. Choose a dedicated meeting transcription provider under
**Templates, recipes & privacy** while keeping Grok, OpenAI, Groq, or a custom text model
for note generation.

### Google Meet speaker tags

Granola-style display-name tags are available through the optional extension in
[`extension/dictalume-speaker-tags`](extension/dictalume-speaker-tags/README.md). Open
`chrome://extensions` in Chrome, Edge, Arc, or Brave, enable **Developer mode**, choose
**Load unpacked**, and select that folder. The Meetings settings panel has a
**Show extension folder** button for installed builds.

The extension reads only Google Meet’s visible participant name and active-speaker signal.
It does not read captions, chat, audio, video, or general browsing activity. A heartbeat is
sent to `127.0.0.1:43127`; the listener is available only on the local computer and accepts
browser-extension origins. Dictalume associates a name only when the heartbeat is within
2.5 seconds of the transcribed speech. Otherwise the speaker remains anonymous for review.

On macOS, Zoom speaker tags use the equivalent Accessibility signal from the Zoom
Workplace window and require no browser extension. Dictalume polls this signal only while
it is actively recording a meeting whose source is set to **Zoom**. Zoom speaker tags are
not enabled on Windows, matching the platform limitation of the reference behavior.
The same privacy panel can optionally post an editable disclosure to Zoom chat. Zoom must
already be focused; Dictalume waits for an explicit non-self active-speaker signal and
sends at most once per recording.

After processing, the new meeting opens automatically with structured Summary, Key
points, Decisions, To-do list, Open questions, and Full transcript sections. Generated and
personal notes can be edited locally without another API call, and to-dos can be completed
in place. New AI-generated bullets carry validated transcript-turn evidence; the
magnifying-glass control reveals the exact speaker-labelled passage, and invented or stale
turn IDs are discarded before notes are saved. Per-meeting and cross-meeting chat reuse an
already configured text provider. Personal notes support headings, emphasis, bullet lists,
and pasted or selected images. Images remain attachments and are not sent to the notes AI.
Meetings can be resumed, assigned to several nested Spaces, searched, restored from trash,
and exported individually or as a CSV library. Spaces can auto-add an exact recurring
Google or Outlook series (or an exact meeting title); older flat Space labels migrate
automatically. Optional retention removes old raw transcripts while preserving the notes.

Windows uses native loopback capture. On macOS 15 or later, choose the Meet or Zoom window in Apple’s system share picker and enable audio. If macOS does not return a system-audio track, the app shows that explicitly and lets you continue with microphone-only recording.

Google Calendar uses the read-only `calendar.events.readonly` scope. Outlook uses delegated
`User.Read` and `Calendars.Read` permissions. Because this app has no Dictalume backend,
create a public desktop OAuth client with the relevant provider and paste its client ID in
**Meetings**. OAuth tokens are encrypted locally and never enter the shared context file.

## iPhone app and keyboard

The native project is in [`mobile/`](mobile/README.md). It includes long-form dictation,
an in-person Meeting mode with Deepgram speaker diarization and human name confirmation,
an opt-in local Coming Up calendar that starts correctly titled meetings,
live personal notes, structured summary/to-do/transcript history, complete-notes and
speaker-transcript sharing, grounded cross-meeting mobile chat, pause/resume with
microphone-interruption recovery, provider
configuration, AI cleanup,
English/Portuguese automatic detection, Keychain API-key storage, spelling memory, a shared
`context.json` file picker, an App Group keyboard extension, and separate native dictation
and meeting actions for Shortcuts and the iPhone Action Button. Confirmed mobile speakers,
timed turns, personal notes, generated notes, and the full transcript are synchronized as
first-class Meetings records on macOS and Windows.

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
