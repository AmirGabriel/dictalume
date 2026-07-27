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
                        VStack(alignment: .leading, spacing: 8) {
                            Text(item.text)
                                .lineLimit(5)
                                .textSelection(.enabled)
                            HStack {
                                Text(Date(timeIntervalSince1970: item.createdAt / 1000), style: .date)
                                Text("·")
                                Text(duration(item.durationMs))
                                Spacer()
                                Button {
                                    UIPasteboard.general.string = item.text
                                } label: {
                                    Image(systemName: "doc.on.doc")
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Copy transcript")
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 5)
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
}
