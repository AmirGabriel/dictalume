# Dictalume Design System

## Direction

Dictalume follows the visual language of a first-party Apple utility: calm system materials, a translucent source-list sidebar, grouped settings rows, standard blue actions, hairline separators, and typography that feels native on macOS. Windows receives the same hierarchy using Mica and Segoe UI. The app follows the operating system’s light or dark appearance.

## Color

All authored colors use OKLCH.

- Light background: `oklch(0.965 0.003 255)`
- Light raised surface: `oklch(0.997 0.001 255)`
- Dark background: `oklch(0.145 0.004 255)`
- Dark raised surface: `oklch(0.205 0.005 255)`
- Primary ink follows the selected system appearance
- Muted ink uses a neutral gray with AA contrast
- Brand/action: `oklch(0.62 0.205 255)`
- Action hover: `oklch(0.56 0.21 255)`
- Success: `oklch(0.73 0.145 155)`
- Warning: `oklch(0.80 0.14 85)`
- Error: `oklch(0.65 0.21 25)`

## Typography

Use the macOS system family (`-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`) everywhere. UI text is compact and practical: 13–15px for controls and body copy, 20–28px for page titles. Monospaced transcript previews and shortcuts use `SFMono-Regular`.

## Shape and spacing

The spacing unit is 4px, with 8, 12, 16, 24, and 32px composing most layouts. Controls use 8–10px radii; panels top out at 14px. Pill geometry is reserved for status and shortcut tokens.

## Components

- Sidebar: fixed 196px navigation rail with icon, label, and a compact recording status.
- Buttons: quiet secondary controls and one system-blue primary action per surface.
- Inputs: system-filled fields with a visible neutral border and blue focus ring.
- Provider rows: full-width settings rows, selected through a radio affordance rather than nested cards.
- Recorder overlay: a 304px floating capsule with waveform, elapsed time, and cancel control. It stays above full-screen work without stealing focus; its transparent host window has no native macOS shadow, preventing rectangular edge artifacts. If the input ends, becomes muted, changes device, suspends, or produces sustained digital zero, the status names the problem while the audio graph reconnects without discarding the recording already captured.
- Menu bar and system tray: a compact waveform glyph keeps Dictalume available after its windows close. Its menu starts dictation, changes mode, opens the app, or quits.
- History: chronological transcript rows with source app, mode, duration, provider, and copy action.
- Writing memory: an ordinary grouped settings row with an editable vocabulary field; learned spellings remain visible and reversible.
- Language overrides: optional paired shortcut fields beneath the global shortcut, kept secondary to automatic detection.
- Sync: a first-class sidebar destination with one folder action, a plain-language status, and a transparent inventory of shared versus device-local data.

## Motion

State transitions last 160–220ms and use exponential ease-out. The recording waveform responds to live microphone energy. Reduced-motion mode replaces scaling and sliding with simple opacity changes.

## Layout

The main window is a compact desktop settings surface with persistent sidebar navigation and a single scrolling content region. Keep forms below 680px wide. Meeting records expand into notes, transcript, and a contextual chat. The recorder overlay remains one-line while listening and expands vertically only for errors. Persistent API cost sits quietly in the bottom-right and reveals its measurement breakdown on demand.
