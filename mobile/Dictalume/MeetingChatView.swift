import SwiftUI

struct MeetingChatView: View {
    @EnvironmentObject private var model: AppModel
    @State private var question = ""

    private var hasMeetings: Bool {
        let savedMeetingExists = model.history.contains { $0.mode == "meeting" }
#if DEBUG
        return savedMeetingExists ||
            ProcessInfo.processInfo.arguments.contains("-dictalumeQAChat")
#else
        return savedMeetingExists
#endif
    }

    var body: some View {
        ScrollViewReader { proxy in
            Group {
                if !hasMeetings {
                    ContentUnavailableView(
                        "No meetings to ask",
                        systemImage: "sparkles",
                        description: Text(
                            "Record or sync a meeting first. Answers use only your saved meeting records."
                        )
                    )
                } else if model.meetingChat.isEmpty {
                    ContentUnavailableView {
                        Label("Ask your meetings", systemImage: "sparkles")
                    } description: {
                        Text(
                            "Recall decisions, pending work, or themes across your saved meetings."
                        )
                    }
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            ForEach(model.meetingChat) { message in
                                ChatMessageRow(message: message)
                                    .id(message.id)
                            }
                            if model.isChatting {
                                HStack(spacing: 9) {
                                    ProgressView()
                                    Text("Checking saved meetings…")
                                }
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .padding(.vertical, 8)
                                .id("chat-progress")
                            }
                        }
                        .padding()
                    }
                }
            }
            .onChange(of: model.meetingChat.count) {
                if let id = model.meetingChat.last?.id {
                    withAnimation {
                        proxy.scrollTo(id, anchor: .bottom)
                    }
                }
            }
        }
        .navigationTitle("Ask Dictalume")
        .navigationBarTitleDisplayMode(.large)
        .background(Color(uiColor: .systemGroupedBackground))
        .toolbar {
            if !model.meetingChat.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear") {
                        model.clearMeetingChat()
                    }
                    .disabled(model.isChatting)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                if !model.chatError.isEmpty {
                    Label(model.chatError, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(alignment: .bottom, spacing: 10) {
                    TextField(
                        "Ask about your meetings",
                        text: $question,
                        axis: .vertical
                    )
                    .lineLimit(1...5)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.send)
                    .onSubmit { send() }
                    Button {
                        send()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(
                        question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        model.isChatting ||
                        !hasMeetings
                    )
                    .accessibilityLabel("Send question")
                }
                Text("Answers are grounded in saved meetings and may use your selected AI API.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal)
            .padding(.top, 10)
            .background(.bar)
        }
    }

    private func send() {
        let value = question
        question = ""
        Task { await model.askMeetings(value) }
    }
}

private struct ChatMessageRow: View {
    let message: MobileChatMessage

    var body: some View {
        HStack {
            if message.role == "user" {
                Spacer(minLength: 44)
            }
            Text(message.content)
                .font(.body)
                .foregroundStyle(message.role == "user" ? .white : .primary)
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(
                    message.role == "user"
                        ? AnyShapeStyle(Color.accentColor)
                        : AnyShapeStyle(Color(uiColor: .secondarySystemGroupedBackground)),
                    in: RoundedRectangle(cornerRadius: 16)
                )
            if message.role != "user" {
                Spacer(minLength: 44)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(
            message.role == "user"
                ? "You: \(message.content)"
                : "Dictalume: \(message.content)"
        )
    }
}
