import SwiftUI

struct UpcomingMeetingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            switch model.upcomingMeetings.access {
            case .notRequested:
                ContentUnavailableView {
                    Label("Connect your calendar", systemImage: "calendar.badge.plus")
                } description: {
                    Text(
                        "See upcoming meetings and start a correctly titled note with one tap. Dictalume reads events only on this iPhone."
                    )
                } actions: {
                    Button("Allow calendar access") {
                        Task { await model.upcomingMeetings.requestAccess() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.upcomingMeetings.isLoading)
                }
            case .denied:
                ContentUnavailableView {
                    Label("Calendar access is off", systemImage: "calendar.badge.exclamationmark")
                } description: {
                    Text("Allow calendar access in Settings to show your upcoming meetings.")
                } actions: {
                    Button("Open Settings") {
                        guard let url = URL(string: UIApplication.openSettingsURLString) else {
                            return
                        }
                        openURL(url)
                    }
                    .buttonStyle(.borderedProminent)
                }
            case .connected:
                if model.upcomingMeetings.meetings.isEmpty {
                    ContentUnavailableView(
                        "No upcoming meetings",
                        systemImage: "calendar",
                        description: Text("Your next 14 days are clear.")
                    )
                } else {
                    List {
                        Section {
                            ForEach(model.upcomingMeetings.meetings) { meeting in
                                Button {
                                    model.startMeeting(from: meeting)
                                } label: {
                                    UpcomingMeetingRow(meeting: meeting)
                                }
                                .buttonStyle(.plain)
                                .accessibilityHint(
                                    "Opens Record and immediately starts an in-person meeting."
                                )
                            }
                        } header: {
                            Text("Next 14 days")
                        } footer: {
                            Text(
                                "Calendar details stay on this device. Only the selected meeting title is saved with your Dictalume note."
                            )
                        }
                    }
                    .refreshable {
                        model.upcomingMeetings.refresh()
                    }
                }
            }
        }
        .navigationTitle("Coming Up")
        .navigationBarTitleDisplayMode(.large)
        .overlay {
            if model.upcomingMeetings.isLoading {
                ProgressView("Connecting calendar…")
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !model.upcomingMeetings.errorMessage.isEmpty {
                Label(
                    model.upcomingMeetings.errorMessage,
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.footnote)
                .foregroundStyle(.red)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.bar)
            }
        }
        .onAppear {
            model.upcomingMeetings.refresh()
        }
    }
}

private struct UpcomingMeetingRow: View {
    let meeting: MobileCalendarMeeting

    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 2) {
                Text(meeting.startsAt, format: .dateTime.hour().minute())
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                if meeting.isInProgress {
                    Text("Now")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.red)
                } else {
                    Text(meeting.startsAt, format: .dateTime.weekday(.abbreviated))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 70)

            VStack(alignment: .leading, spacing: 4) {
                Text(meeting.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                HStack(spacing: 5) {
                    Text(meeting.startsAt, format: .dateTime.month(.abbreviated).day())
                    Text("·")
                    Text(duration)
                    Text("·")
                    Text(meeting.calendarName)
                        .lineLimit(1)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Image(systemName: "waveform.badge.mic")
                .foregroundStyle(.tint)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .padding(.vertical, 5)
    }

    private var duration: String {
        let minutes = max(1, Int(meeting.endsAt.timeIntervalSince(meeting.startsAt) / 60))
        return minutes >= 60 && minutes % 60 == 0
            ? "\(minutes / 60)h"
            : "\(minutes)m"
    }
}
