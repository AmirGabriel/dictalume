import Foundation

enum SpellingMemory {
    private static let builtInTechnicalTerms = [
        "HTML", "CSS", "JavaScript", "TypeScript", "React", "Swift", "SwiftUI",
        "Xcode", "GitHub", "API", "APIs", "SDK", "JSON", "SQL", "iOS", "macOS",
        "Windows", "IPS"
    ]
    private static let automaticStopWords: Set<String> = [
        "EU", "UM", "UMA", "ELE", "ELA", "DE", "DO", "DA", "DOS", "DAS",
        "EM", "NO", "NA", "THE", "AND", "FOR", "WITH"
    ]

    static func extract(from transcript: String) -> [String] {
        let pattern = #"(?i)(?:write|spell|spelled|written|escrev\w*)[^.!?\n]{0,45}?([A-Z](?:[\s-]+[A-Z]){1,})"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(transcript.startIndex..., in: transcript)
        return expression.matches(in: transcript, range: range).compactMap { match in
            guard let swiftRange = Range(match.range(at: 1), in: transcript) else { return nil }
            let value = transcript[swiftRange].filter(\.isLetter).uppercased()
            return value.count > 1 ? value : nil
        }
    }

    static func merge(_ existing: String, _ learned: [String]) -> String {
        var lines = existing.split(separator: "\n").map(String.init)
        var seen = Set(
            lines.map {
                ($0.components(separatedBy: " — ").first ?? $0)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .uppercased()
            }
        )
        for term in learned {
            let key = term.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard !key.isEmpty, !seen.contains(key) else { continue }
            seen.insert(key)
            lines.append("\(term) — learned automatically")
        }
        return lines.suffix(200).joined(separator: "\n")
    }

    static func keyterms(from vocabulary: String, limit: Int = 100) -> [String] {
        var result: [String] = []
        var seen: Set<String> = []
        let stored = vocabulary.split(separator: "\n").map { line -> String in
            var value = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
            value = value.replacingOccurrences(
                of: #"^[-*•]\s*"#,
                with: "",
                options: .regularExpression
            )
            return value.components(separatedBy: " — ").first?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? value
        }
        for term in stored + builtInTechnicalTerms {
            let clipped = String(term.prefix(50))
            let key = clipped.lowercased()
            if !clipped.isEmpty, !seen.contains(key), result.count < limit {
                seen.insert(key)
                result.append(clipped)
            }
        }
        return result
    }

    static func observeAutomatic(
        from cleanedTranscript: String,
        observations: inout [String: Int]
    ) -> [String] {
        let pattern = #"\b[A-Z][A-Z0-9.+#/-]{1,15}\b"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(cleanedTranscript.startIndex..., in: cleanedTranscript)
        let builtIns = Set(builtInTechnicalTerms.map { $0.uppercased() })
        var candidates: Set<String> = []
        for match in expression.matches(in: cleanedTranscript, range: range) {
            guard let swiftRange = Range(match.range, in: cleanedTranscript) else { continue }
            let term = String(cleanedTranscript[swiftRange])
            let letters = term.filter { $0.isASCII && $0.isLetter }
            guard letters.count >= 2,
                  !automaticStopWords.contains(term),
                  !builtIns.contains(term.uppercased()) else { continue }
            candidates.insert(term)
        }
        var learned: [String] = []
        for term in candidates.sorted() {
            let count = (observations[term] ?? 0) + 1
            observations[term] = count
            if count == 2 { learned.append(term) }
        }
        return learned
    }
}
