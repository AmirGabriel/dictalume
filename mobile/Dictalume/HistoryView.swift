import SwiftUI

struct HistoryView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            if model.history.isEmpty {
                ContentUnavailableView(
                    "No transcripts yet",
                    systemImage: "waveform",
                    description: Text("Your cleaned conversations and dictations will appear here.")
                )
            } else {
                List {
                    ForEach(model.history) { item in
                        if item.mode == "meeting" {
                            NavigationLink {
                                MeetingHistoryDetailView(item: item)
                            } label: {
                                historyRow(item)
                            }
                        } else {
                            historyRow(item)
                        }
                    }
                    .onDelete { offsets in
                        model.history.remove(atOffsets: offsets)
                        model.contextStore.saveLocalHistory(model.history)
                    }
                }
            }
        }
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.large)
    }

    private func duration(_ milliseconds: Double) -> String {
        let seconds = Int(milliseconds / 1000)
        return seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(seconds % 60)s"
    }

    private func historyRow(_ item: MobileHistoryItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(
                item.title?.isEmpty == false
                    ? item.title!
                    : item.mode == "meeting" ? "Meeting notes" : "Dictation",
                systemImage: item.mode == "meeting" ? "person.2.wave.2" : "waveform"
            )
                .font(.caption.weight(.semibold))
                .foregroundStyle(.blue)
            Text(item.meetingNotes?.summary.first ?? item.text)
                .lineLimit(5)
            HStack {
                Text(Date(timeIntervalSince1970: item.createdAt / 1000), style: .date)
                Text("·")
                Text(duration(item.durationMs))
                Spacer()
                if item.mode != "meeting" {
                    Button {
                        UIPasteboard.general.string = item.text
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Copy transcript")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
    }
}

private struct MeetingHistoryDetailView: View {
    let item: MobileHistoryItem

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                if let notes = item.meetingNotes {
                    meetingSection("Summary", systemImage: "text.alignleft") {
                        ForEach(Array(notes.summary.enumerated()), id: \.offset) { _, bullet in
                            Label(bullet, systemImage: "circle.fill")
                                .labelStyle(MeetingBulletLabelStyle())
                        }
                    }
                    if !notes.actionItems.isEmpty {
                        meetingSection("To do", systemImage: "checklist") {
                            ForEach(
                                Array(notes.actionItems.enumerated()),
                                id: \.offset
                            ) { _, task in
                                Label(task, systemImage: "square")
                            }
                        }
                    }
                }

                if let userNotes = item.userNotes?.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ),
                   !userNotes.isEmpty
                {
                    meetingSection("Your notes", systemImage: "square.and.pencil") {
                        Text(userNotes)
                            .textSelection(.enabled)
                    }
                }

                meetingSection("Transcript", systemImage: "text.quote") {
                    if let turns = item.speakerTurns, !turns.isEmpty {
                        ForEach(turns) { turn in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(speakerName(turn.speakerID))
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.blue)
                                Text(turn.text)
                                    .textSelection(.enabled)
                            }
                        }
                    } else {
                        Text(item.rawText)
                            .textSelection(.enabled)
                    }
                }
            }
            .padding()
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle(item.title?.isEmpty == false ? item.title! : "Meeting")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ShareLink(
                        item: item.text,
                        subject: Text("Dictalume meeting notes"),
                        message: Text("Meeting notes created in Dictalume")
                    ) {
                        Label("Share complete notes", systemImage: "doc.text")
                    }
                    ShareLink(
                        item: transcriptDocument,
                        subject: Text("Dictalume meeting transcript")
                    ) {
                        Label("Share transcript", systemImage: "text.quote")
                    }
                    Button {
                        UIPasteboard.general.string = item.text
                    } label: {
                        Label("Copy complete notes", systemImage: "doc.on.doc")
                    }
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Share meeting")
            }
        }
    }

    private func meetingSection<Content: View>(
        _ title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.title3.weight(.semibold))
            VStack(alignment: .leading, spacing: 12) {
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(
                Color(uiColor: .secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 16)
            )
        }
    }

    private func speakerName(_ speakerID: Int) -> String {
        guard speakerID >= 0 else { return "Unknown speaker" }
        let value = item.speakerNames?[speakerID]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value! : "Speaker \(speakerID + 1)"
    }

    private var transcriptDocument: String {
        guard let turns = item.speakerTurns, !turns.isEmpty else {
            return item.rawText
        }
        return turns.map { turn in
            "\(speakerName(turn.speakerID)): \(turn.text)"
        }.joined(separator: "\n\n")
    }
}

private struct MeetingBulletLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            configuration.icon
                .font(.system(size: 6))
                .foregroundStyle(.blue)
            configuration.title
        }
    }
}
