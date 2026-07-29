import AppIntents
import SwiftUI

struct ShortcutSetupView: View {
    var body: some View {
        List {
            Section {
                VStack(spacing: 16) {
                    Image(systemName: "button.programmable")
                        .font(.largeTitle)
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)
                    Text("Ready for the Action Button")
                        .font(.title2.weight(.semibold))
                    Text(
                        "Dictalume already publishes recording actions to Shortcuts. " +
                        "There is no shortcut file to build or import."
                    )
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }

            Section("Open Shortcuts") {
                ShortcutsLink()
                    .frame(maxWidth: .infinity, minHeight: 44)
                Text(
                    "Look for Dictalume and choose Start recording or Start meeting. " +
                    "The action is installed automatically after you open Dictalume once."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }

            Section("Assign it on iPhone 15 Pro Max") {
                setupStep(
                    number: 1,
                    title: "Open Settings",
                    detail: "Choose Action Button."
                )
                setupStep(
                    number: 2,
                    title: "Select Shortcut",
                    detail: "Swipe to the Shortcut action."
                )
                setupStep(
                    number: 3,
                    title: "Choose Dictalume",
                    detail: "Pick Start recording for instant dictation."
                )
            }

            Section {
                Label(
                    "The first recording asks for microphone permission. Later presses " +
                    "open Dictalume and begin immediately.",
                    systemImage: "lock.shield"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Action Button")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func setupStep(number: Int, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "\(number).circle.fill")
                .foregroundStyle(.tint)
                .font(.title3)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.body.weight(.semibold))
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
