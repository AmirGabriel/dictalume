# Dictalume for iPhone

This folder contains the native SwiftUI iPhone app and its UIKit keyboard extension.

## Open the Xcode project

1. Install the full current Xcode release from Apple.
2. Open `Dictalume.xcodeproj`.
3. Select your Apple Developer team for both targets.
4. Register `group.com.dictalume.app` as an App Group for the app and keyboard targets, or replace it consistently in `project.yml`, both entitlements files, and the Swift sources.
5. Run the **Dictalume** scheme on an iPhone.

The current machine only has Apple Command Line Tools, not the full iOS SDK and signing UI, so the project cannot be compiled or installed here until Xcode is installed.

The Xcode project is checked in. If sources are added later, regenerate it with
`ruby generate_project.rb` (the `xcodeproj` gem is required) or use the equivalent
`xcodegen generate` command with `project.yml`.

## Keyboard setup

After installing the app, open **Settings → General → Keyboard → Keyboards → Add New Keyboard**, select **Dictalume Keyboard**, then enable Full Access. Full Access lets the extension read the latest transcript from the shared App Group; it does not send keystrokes to a Dictalume server.

iOS does not expose microphone recording to custom keyboard extensions. Record in the containing Dictalume app, return to the app where you were typing, then tap **Insert latest transcript**. The keyboard uses only public App Store APIs.
