# Dictalume for iPhone

This folder contains the native SwiftUI iPhone app and its UIKit keyboard extension.

## Open the Xcode project

1. Install the full current Xcode release from Apple.
2. Open `Dictalume.xcodeproj`.
3. Select your Apple Developer team for both targets.
4. Register `group.com.dictalume.app` as an App Group for the app and keyboard targets, or replace it consistently in `project.yml`, both entitlements files, and the Swift sources.
5. Run the **Dictalume** scheme on an iPhone.

The project has been built successfully with the installed Xcode for both a generic ARM64
iPhone and an iPhone 15 simulator.

The Xcode project is checked in. If sources are added later, regenerate it with
`ruby generate_project.rb` (the `xcodeproj` gem is required) or use the equivalent
`xcodegen generate` command with `project.yml`.

## Keyboard setup

After installing the app, open **Settings → General → Keyboard → Keyboards → Add New Keyboard**, select **Dictalume Keyboard**, then enable Full Access. Full Access lets the extension read the latest transcript from the shared App Group; it does not send keystrokes to a Dictalume server.

iOS does not expose microphone recording to custom keyboard extensions. The microphone key
uses the public extension URL API to open Dictalume and start recording; if the current host
app refuses that handoff, use the Action Button or open Dictalume directly. Return to the app
where you were typing and tap **Insert latest Dictalume** in the suggestions row. The keyboard
uses only public App Store APIs.

The keyboard follows the iPhone keyboard's spacing, semantic light/dark colors, 44-point
controls, shift/caps-lock behavior, press-and-hold accents, repeating delete, double-space
period, and undo-after-autocorrection behavior. It checks both Portuguese (Brazil) and English
with Apple's public `UITextChecker`, the user's supplementary lexicon, and local language
detection. A word that is valid in either language, an acronym, a word containing a number,
or a saved personal term is never autocorrected. This makes mixed Portuguese/English typing
conservative by design.

Apple does not expose the private QuickType/autocorrection model used by its own keyboard to
third-party keyboard extensions, so no third-party keyboard can reproduce Apple's predictions
exactly. Dictalume uses the closest public system APIs and favors preserving meaning over an
aggressive guess.

## In-person meetings and speaker attribution

The **Coming Up** tab can read the next 14 days from the iPhone calendar after explicit
permission. It ignores all-day entries and starts an in-person recording immediately when
you tap an event. Calendar details are queried locally; only the selected event title is
saved with the meeting and synchronized to Mac/Windows.

Choose **Meeting** on the Record screen before starting an in-person conversation. Add a
Deepgram API key under **Settings → In-person meetings**; Dictalume sends that recording
directly to Deepgram with acoustic diarization enabled and receives anonymous Speaker 1,
Speaker 2, and Speaker 3 voice clusters.

After transcription, Dictalume always shows the speaker transcript for confirmation. You
can rename the voice clusters when you know the participants, leave them anonymous, or keep
an uncertain segment as **Unknown speaker**. Names are never inferred from conversation
content. Only after this review can the selected AI provider generate the bullet summary and
explicit to-do list. The saved result always ends with the complete speaker transcript. If
the selected provider does not support chat completions, save the attributed transcript
without AI notes.

You can write headings, bullets, decisions, or context in **Your notes** while the meeting
is recording. Those notes guide what the AI emphasizes, but they never replace transcript
evidence or permit it to infer a speaker. They remain editable during speaker review and are
saved separately from the generated notes. From a saved meeting, the Share menu can export
either the complete notes or the full speaker-labelled transcript.

Recording can be paused and resumed without closing the audio file. Dictalume also listens
for iOS audio-session interruptions and microphone-route changes, attempts to resume the
same recording safely, and shows an explicit recovery message when iOS will not resume it.
The `audio` background mode keeps an active long meeting recording when the screen locks or
the app moves to the background.

When a shared desktop `context.json` is selected, an iPhone meeting is published as a
first-class desktop meeting—not only as a generic history item. Its confirmed speaker names,
anonymous/unknown identities, timed turns, personal notes, generated summary, to-dos, and
full transcript therefore appear in Meetings on macOS and Windows after sync. A desktop edit
is never overwritten by a later duplicate mobile publish.

The **Ask** tab can answer questions across up to 20 recent saved meetings using the selected
text provider. Dictalume caps the supplied context, keeps the last eight chat turns for
follow-ups, and instructs the model to cite the supporting meeting title/date or say that the
answer was not found. It is never allowed to invent a fact, task, decision, or speaker.
Mobile chat history stays in the local App Group; the underlying meetings remain the shared
source of truth.

## Action Button and Shortcuts

Dictalume publishes separate **Start recording** and **Start Dictalume meeting** actions
through App Intents. They appear automatically in Shortcuts after installing and opening
Dictalume once. Open **Settings → Instant recording → Set up Action Button** inside Dictalume
for a one-tap link to Shortcuts and the three assignment steps:

### iPhone 15 Pro and iPhone 15 Pro Max

1. Open **Settings → Action Button** on a supported iPhone.
2. Swipe to **Shortcut** and tap **Choose a Shortcut**.
3. Choose **Dictalume → Start recording** for dictation or **Start Dictalume meeting** for
   immediate in-person speaker diarization.

Pressing and holding the Action Button opens Dictalume and immediately starts the selected
recording mode.
The first run still requires the normal iOS microphone permission prompt. You can also add
the same Dictalume action to any custom shortcut in the Shortcuts app.

Apple does not provide a public API for an app to assign its own Action Button action. The
Dictalume action itself is already installed; iOS still requires the owner of the iPhone to
choose it once in Settings.

### iPhone 15 and iPhone 15 Plus

These models have the Ring/Silent switch rather than the Action Button. Use the same shortcut
with **Settings → Accessibility → Touch → Back Tap**, then assign it to Double Tap or Triple
Tap. The in-app recording, keyboard, safe-area layout, and background recording behavior are
the same across all four iPhone 15 models.
