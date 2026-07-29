import Foundation

private let losslessCleanupPolicy = """
You are a lossless transcript editor. The transcript is the source of truth.
Allowed edits only: clean punctuation and casing; correct grammar without changing meaning; remove filler and exact or near-verbatim repetition; and execute an explicit spoken self-editing command such as “delete the previous sentence,” removing both that command and only the text it targets.
Preserve every fact, idea, example, request, constraint, caveat, qualification, uncertainty, name, number, filename, technical term, and the order needed to retain the speaker’s intent.
Never summarize, paraphrase for brevity, reinterpret, infer, answer the speaker, add information, or silently omit a detail. Preferred vocabulary may clarify spelling only.
Keep Portuguese and English terms exactly as spoken. If unsure about an edit, preserve the original wording. Return only the edited transcript.
"""

private func editDistance(_ left: String, _ right: String) -> Int {
    let leftCharacters = Array(left)
    let rightCharacters = Array(right)
    var previous = Array(0...rightCharacters.count)
    for leftIndex in 1...leftCharacters.count {
        var current = [leftIndex]
        for rightIndex in 1...rightCharacters.count {
            current.append(
                min(
                    current[rightIndex - 1] + 1,
                    previous[rightIndex] + 1,
                    previous[rightIndex - 1]
                        + (leftCharacters[leftIndex - 1] == rightCharacters[rightIndex - 1] ? 0 : 1)
                )
            )
        }
        previous = current
    }
    return previous[rightCharacters.count]
}

private func technicalCorrection(
    detail: String,
    cleaned: String,
    vocabulary: String
) -> String? {
    guard detail.range(of: #"^[A-Z]{2,12}$"#, options: .regularExpression) != nil
    else { return nil }
    let cleanedTokens = Set(
        cleaned.components(separatedBy: CharacterSet.alphanumerics.inverted)
            .map { $0.uppercased() }
    )
    return SpellingMemory.keyterms(from: vocabulary).first { term in
        let candidate = term.uppercased()
        return candidate.range(of: #"^[A-Z]{2,12}$"#, options: .regularExpression) != nil
            && cleanedTokens.contains(candidate)
            && abs(candidate.count - detail.count) <= 1
            && (
                editDistance(detail, candidate) <= 1
                || (
                    candidate.count == detail.count
                    && candidate.prefix(2) == detail.prefix(2)
                    && editDistance(detail, candidate) <= 2
                )
            )
    }
}

private func faithfulCleanup(original: String, cleaned: String, vocabulary: String) -> Bool {
    let output = cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else { return false }
    let deletionPattern = #"(?i)\b(apag\w*|remov\w*|exclu\w*|delet\w*|tira\w*|retira\w*|delete|remove|erase|strike|cut)\b[^.!?\n]{0,48}\b(frase|senten[cç]a|palavra|parte|trecho|anterior|[uú]ltim[oa]|isso|isto|que eu (disse|falei)|previous|last|sentence|word|part|passage|that|what i (said|spoke))\b"#
    let spellingPattern = #"(?i)\b(spell\w*|write it|written|escrev\w*|soletr\w*)\b"#
    let controlledRemoval =
        original.range(of: deletionPattern, options: .regularExpression) != nil
        || original.range(of: spellingPattern, options: .regularExpression) != nil

    let protectedPattern = #"https?://\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:\d[\d.,:/%-]*|[A-Z]{2,}|[\w-]+\.[A-Za-z0-9]{1,8})\b"#
    let expression = try? NSRegularExpression(pattern: protectedPattern)
    if !controlledRemoval, let expression {
        let range = NSRange(original.startIndex..., in: original)
        let lowerOutput = output.lowercased()
        for match in expression.matches(in: original, range: range) {
            guard let swiftRange = Range(match.range, in: original) else { continue }
            let detail = String(original[swiftRange])
            if !lowerOutput.contains(detail.lowercased()),
               technicalCorrection(
                    detail: detail,
                    cleaned: output,
                    vocabulary: vocabulary
               ) == nil {
                return false
            }
        }
    }

    let stopWords: Set<String> = [
        "uma", "uns", "umas", "que", "para", "pra", "por", "com", "isso", "isto",
        "então", "tipo", "assim", "the", "and", "for", "with", "that", "this",
        "like", "well", "just", "really", "actually"
    ]
    func terms(_ text: String) -> Set<String> {
        let folded = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        return Set(
            folded.components(separatedBy: CharacterSet.alphanumerics.inverted)
                .filter { $0.count >= 3 && !stopWords.contains($0.lowercased()) }
                .map { String($0.lowercased().prefix(6)) }
        )
    }
    let sourceTerms = terms(original)
    let outputTerms = terms(output)
    if controlledRemoval {
        guard !outputTerms.isEmpty else { return false }
        let sourced = outputTerms.intersection(sourceTerms).count
        return Double(sourced) / Double(outputTerms.count) >= 0.85
    }
    guard sourceTerms.count >= 6 else { return true }

    var aliases: [String: String] = [:]
    if let expression {
        let range = NSRange(original.startIndex..., in: original)
        for match in expression.matches(in: original, range: range) {
            guard let swiftRange = Range(match.range, in: original) else { continue }
            let detail = String(original[swiftRange])
            if let correction = technicalCorrection(
                detail: detail,
                cleaned: output,
                vocabulary: vocabulary
            ) {
                aliases[String(detail.lowercased().prefix(6))] =
                    String(correction.lowercased().prefix(6))
            }
        }
    }
    let retained = sourceTerms.filter {
        outputTerms.contains($0)
            || (aliases[$0].map { outputTerms.contains($0) } ?? false)
    }.count
    let correctedOutputs = Set(aliases.values)
    let sourcedOutput = outputTerms.filter {
        sourceTerms.contains($0) || correctedOutputs.contains($0)
    }.count
    return Double(retained) / Double(sourceTerms.count) >= 0.90
        && Double(sourcedOutput) / Double(outputTerms.count) >= 0.85
}

struct TranscriptionService {
    let settings: MobileSettings

    private var apiKey: String {
        KeychainStore.get(account: "provider.\(settings.provider.rawValue)")
    }

    func transcribe(audio: Data, filename: String) async throws -> String {
        guard !apiKey.isEmpty || settings.baseURL.contains("localhost") else {
            throw ServiceError.message("Add an API key in Settings.")
        }
        if settings.provider == .deepgram {
            return try await transcribeDeepgram(audio)
        }
        let endpoint = settings.provider == .grok ? "stt" : "audio/transcriptions"
        var fields: [(String, String)] = []
        if settings.provider != .grok {
            fields.append(("model", settings.transcriptionModel))
        }
        if settings.language != "auto" {
            fields.append(("language", settings.language))
            if settings.provider == .grok { fields.append(("format", "true")) }
        }
        if settings.provider == .grok {
            for term in SpellingMemory.keyterms(from: settings.vocabulary) {
                fields.append(("keyterm", term))
            }
        } else if !settings.vocabulary.isEmpty {
            fields.append(("prompt", settings.vocabulary))
        }
        let boundary = "Dictalume-\(UUID().uuidString)"
        var request = URLRequest(url: endpointURL(endpoint))
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = multipart(fields: fields, audio: audio, filename: filename, boundary: boundary)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        let payload = try JSONDecoder().decode(TextResponse.self, from: data)
        guard !payload.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ServiceError.message("The provider returned an empty transcript.")
        }
        return payload.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func cleanup(_ transcript: String, vocabulary: String) async throws -> String {
        guard settings.cleanup, settings.provider != .deepgram, !apiKey.isEmpty else {
            return transcript
        }
        var request = URLRequest(url: endpointURL("chat/completions"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if settings.provider == .grok {
            request.setValue(
                "dictalume-transcript-cleanup-v1",
                forHTTPHeaderField: "x-grok-conv-id"
            )
        }
        request.httpBody = try JSONEncoder().encode(
            ChatRequest(
                model: settings.cleanupModel,
                temperature: 0,
                reasoningEffort: settings.provider == .grok
                    ? (settings.cleanupModel == "grok-4.5" ? "low" : "none")
                    : nil,
                messages: [
                    .init(
                        role: "system",
                        content: "\(losslessCleanupPolicy)\n\nMode guidance (subordinate to the lossless rules):\n\(settings.cleanupPrompt)"
                    ),
                    .init(
                        role: "user",
                        content: "Preferred vocabulary:\n\(vocabulary)\n\nTranscript:\n\(transcript)"
                    )
                ]
            )
        )
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            try validate(response, data: data)
            let result = try JSONDecoder().decode(ChatResponse.self, from: data)
            let candidate = result.choices.first?.message.content
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return faithfulCleanup(
                original: transcript,
                cleaned: candidate,
                vocabulary: vocabulary
            )
                ? candidate
                : transcript
        } catch {
            return transcript
        }
    }

    func transcribeMeeting(
        audio: Data,
        deepgramAPIKey: String
    ) async throws -> MobileMeetingTranscription {
        let key = deepgramAPIKey.isEmpty && settings.provider == .deepgram
            ? apiKey
            : deepgramAPIKey
        guard !key.isEmpty else {
            throw ServiceError.message(
                "Add a Deepgram key in Settings → In-person meetings to identify speakers."
            )
        }
        let result = try await requestDeepgram(audio, apiKey: key, diarize: true)
        let turns = (result.results.utterances ?? [])
            .filter { !$0.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .map {
                MobileSpeakerTurn(
                    id: UUID().uuidString,
                    speakerID: $0.speaker,
                    start: $0.start,
                    end: $0.end,
                    text: $0.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            }
        let fallback = result.results.channels.first?.alternatives.first?.transcript
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !turns.isEmpty {
            return MobileMeetingTranscription(
                transcript: turns.map(\.text).joined(separator: " "),
                turns: turns
            )
        }
        guard !fallback.isEmpty else {
            throw ServiceError.message("Deepgram returned an empty meeting transcript.")
        }
        return MobileMeetingTranscription(
            transcript: fallback,
            turns: [
                MobileSpeakerTurn(
                    id: UUID().uuidString,
                    speakerID: -1,
                    start: 0,
                    end: 0,
                    text: fallback
                )
            ]
        )
    }

    func generateMeetingNotes(
        transcript: String,
        userNotes: String = ""
    ) async throws -> MobileMeetingNotes {
        guard settings.provider != .deepgram, !apiKey.isEmpty else {
            throw ServiceError.message(
                "Choose OpenAI, Grok, Groq, or a compatible custom provider to generate notes. You can also save the speaker transcript without AI notes."
            )
        }
        var request = URLRequest(url: endpointURL("chat/completions"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            ChatRequest(
                model: settings.cleanupModel,
                temperature: 0.1,
                messages: [
                    .init(
                        role: "system",
                        content: """
                        Create faithful meeting notes from a speaker-confirmed transcript.
                        Never infer a speaker identity, fact, assignee, deadline, decision, or task.
                        Preserve every material detail. Put only explicitly assigned or clearly \
                        requested follow-ups in actionItems.
                        The user's own notes may guide emphasis, but they are not permission to \
                        alter what a speaker said or invent an attribution.
                        Return only valid JSON in this exact shape:
                        {"summary":["concise bullet"],"actionItems":["explicit task"]}
                        Write in the predominant language of the transcript.
                        """
                    ),
                    .init(
                        role: "user",
                        content: """
                        SPEAKER-CONFIRMED TRANSCRIPT:
                        \(transcript)

                        USER NOTES:
                        \(userNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? "(none)"
                            : userNotes)
                        """
                    )
                ]
            )
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        let result = try JSONDecoder().decode(ChatResponse.self, from: data)
        guard let content = result.choices.first?.message.content else {
            throw ServiceError.message("The notes provider returned an empty response.")
        }
        guard let json = jsonObjectData(in: content),
              let notes = try? JSONDecoder().decode(MobileMeetingNotes.self, from: json),
              !notes.summary.isEmpty
        else {
            throw ServiceError.message(
                "The notes provider did not return structured meeting notes. The speaker transcript is still available."
            )
        }
        return notes
    }

    func answerMeetingQuestion(
        _ question: String,
        meetings: [MobileHistoryItem],
        conversation: [MobileChatMessage]
    ) async throws -> String {
        guard settings.provider != .deepgram, !apiKey.isEmpty else {
            throw ServiceError.message(
                "Choose OpenAI, Grok, Groq, or a compatible custom provider and add its API key."
            )
        }
        var remainingCharacters = 60_000
        var sources: [String] = []
        for meeting in meetings
            .filter({ $0.mode == "meeting" })
            .sorted(by: { $0.createdAt > $1.createdAt })
            .prefix(20)
        {
            guard remainingCharacters > 0 else { break }
            let title = meeting.title?.trimmingCharacters(in: .whitespacesAndNewlines)
            let safeTitle = title?.isEmpty == false ? title! : "Untitled meeting"
            let date = ISO8601DateFormatter().string(
                from: Date(timeIntervalSince1970: meeting.createdAt / 1000)
            )
            let body = String(meeting.text.prefix(min(5_000, remainingCharacters)))
            remainingCharacters -= body.count
            sources.append("MEETING: \(safeTitle)\nDATE: \(date)\n\(body)")
        }
        guard !sources.isEmpty else {
            throw ServiceError.message("Record or sync a meeting before asking about it.")
        }
        var messages = [
            ChatRequest.Message(
                role: "system",
                content: """
                Answer only from the supplied Dictalume meeting records.
                Never invent a fact, quote, task, decision, date, or speaker identity.
                If the records do not support the answer, say that you could not find it.
                Mention the meeting title and date supporting each material claim.
                Keep the answer concise and write in the language of the user's question.
                """
            ),
            ChatRequest.Message(
                role: "user",
                content: "MEETING RECORDS:\n\n\(sources.joined(separator: "\n\n---\n\n"))"
            )
        ]
        messages.append(
            contentsOf: conversation.suffix(8).map {
                ChatRequest.Message(
                    role: $0.role == "assistant" ? "assistant" : "user",
                    content: String($0.content.prefix(2_000))
                )
            }
        )
        messages.append(.init(role: "user", content: String(question.prefix(4_000))))

        var request = URLRequest(url: endpointURL("chat/completions"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            ChatRequest(
                model: settings.cleanupModel,
                temperature: 0.1,
                messages: messages
            )
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        let result = try JSONDecoder().decode(ChatResponse.self, from: data)
        guard let answer = result.choices.first?.message.content
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !answer.isEmpty
        else {
            throw ServiceError.message("The provider returned an empty answer.")
        }
        return answer
    }

    private func transcribeDeepgram(_ audio: Data) async throws -> String {
        let result = try await requestDeepgram(audio, apiKey: apiKey, diarize: false)
        guard let text = result.results.channels.first?.alternatives.first?.transcript, !text.isEmpty else {
            throw ServiceError.message("Deepgram returned an empty transcript.")
        }
        return text
    }

    private func requestDeepgram(
        _ audio: Data,
        apiKey: String,
        diarize: Bool
    ) async throws -> DeepgramResponse {
        let url = diarize
            ? URL(string: "https://api.deepgram.com/v1/listen")!
            : endpointURL("v1/listen")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            .init(
                name: "model",
                value: diarize ? "nova-3" : settings.transcriptionModel
            ),
            .init(name: "smart_format", value: "true"),
            .init(name: "punctuate", value: "true"),
            settings.language == "auto"
                ? .init(name: "detect_language", value: "true")
                : .init(name: "language", value: settings.language)
        ]
        components.queryItems?.append(
            contentsOf: SpellingMemory.keyterms(from: settings.vocabulary).map {
                .init(name: "keyterm", value: $0)
            }
        )
        if diarize {
            components.queryItems?.append(.init(name: "diarize", value: "true"))
            components.queryItems?.append(.init(name: "utterances", value: "true"))
        }
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        request.httpBody = audio
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(DeepgramResponse.self, from: data)
    }

    private func jsonObjectData(in text: String) -> Data? {
        guard let start = text.firstIndex(of: "{"),
              let end = text.lastIndex(of: "}"),
              start <= end
        else { return nil }
        return Data(text[start...end].utf8)
    }

    private func endpointURL(_ path: String) -> URL {
        URL(string: settings.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/" + path)!
    }

    private func multipart(
        fields: [(String, String)],
        audio: Data,
        filename: String,
        boundary: String
    ) -> Data {
        var body = Data()
        for (name, value) in fields {
            body.append("--\(boundary)\r\n")
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            body.append("\(value)\r\n")
        }
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
        body.append("Content-Type: audio/mp4\r\n\r\n")
        body.append(audio)
        body.append("\r\n--\(boundary)--\r\n")
        return body
    }

    private func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                .flatMap { $0["error"] as? [String: Any] }?["message"] as? String
            throw ServiceError.message(detail ?? "The provider rejected the request.")
        }
    }
}

private struct TextResponse: Decodable { let text: String }
private struct ChatRequest: Encodable {
    struct Message: Encodable { let role: String; let content: String }
    let model: String
    let temperature: Double
    var reasoningEffort: String? = nil
    let messages: [Message]

    enum CodingKeys: String, CodingKey {
        case model
        case temperature
        case reasoningEffort = "reasoning_effort"
        case messages
    }
}
private struct ChatResponse: Decodable {
    struct Choice: Decodable {
        struct Message: Decodable { let content: String }
        let message: Message
    }
    let choices: [Choice]
}
private struct DeepgramResponse: Decodable {
    struct Results: Decodable {
        struct Utterance: Decodable {
            let speaker: Int
            let start: Double
            let end: Double
            let transcript: String
        }
        struct Channel: Decodable {
            struct Alternative: Decodable { let transcript: String }
            let alternatives: [Alternative]
        }
        let channels: [Channel]
        let utterances: [Utterance]?
    }
    let results: Results
}
private enum ServiceError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case let .message(value) = self { value } else { nil }
    }
}

private extension Data {
    mutating func append(_ string: String) {
        append(Data(string.utf8))
    }
}
