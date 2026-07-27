import Foundation

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
            for term in settings.vocabulary.split(separator: "\n").prefix(100) {
                fields.append(("keyterm", String(term.prefix(50))))
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
        request.httpBody = try JSONEncoder().encode(
            ChatRequest(
                model: settings.cleanupModel,
                temperature: 0.2,
                messages: [
                    .init(
                        role: "system",
                        content: settings.cleanupPrompt
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
            return result.choices.first?.message.content
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? transcript
        } catch {
            return transcript
        }
    }

    private func transcribeDeepgram(_ audio: Data) async throws -> String {
        var components = URLComponents(url: endpointURL("v1/listen"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            .init(name: "model", value: settings.transcriptionModel),
            .init(name: "smart_format", value: "true"),
            .init(name: "punctuate", value: "true"),
            settings.language == "auto"
                ? .init(name: "detect_language", value: "true")
                : .init(name: "language", value: settings.language)
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        request.httpBody = audio
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response, data: data)
        let result = try JSONDecoder().decode(DeepgramResponse.self, from: data)
        guard let text = result.results.channels.first?.alternatives.first?.transcript, !text.isEmpty else {
            throw ServiceError.message("Deepgram returned an empty transcript.")
        }
        return text
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
    let messages: [Message]
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
        struct Channel: Decodable {
            struct Alternative: Decodable { let transcript: String }
            let alternatives: [Alternative]
        }
        let channels: [Channel]
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
