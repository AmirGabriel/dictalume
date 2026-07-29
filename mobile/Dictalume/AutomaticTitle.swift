import Foundation

enum AutomaticTitle {
    static func dictation(_ text: String) -> String {
        make(from: text, fallback: "New dictation")
    }

    static func meeting(
        explicitTitle: String,
        notes: MobileMeetingNotes?,
        transcript: String
    ) -> String {
        let trimmed = explicitTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty && !genericMeetingTitles.contains(trimmed.lowercased()) {
            return String(trimmed.prefix(100))
        }
        if let summary = notes?.summary.first,
           !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            return make(from: summary, fallback: "Meeting notes")
        }
        return make(from: transcript, fallback: "Meeting notes")
    }

    private static let genericMeetingTitles: Set<String> = [
        "in-person meeting",
        "meeting",
        "meeting notes",
        "new meeting",
        "untitled meeting",
        "reunião",
        "nova reunião",
        "reunião presencial",
        "sem título"
    ]

    private static func make(from text: String, fallback: String) -> String {
        var candidate = text
            .replacingOccurrences(
                of: #"(?m)^(summary|resumo|transcript|transcrição|speaker \d+|unknown speaker)\s*[:\n-]*"#,
                with: "",
                options: .regularExpression
            )
            .replacingOccurrences(
                of: #"^[\s•*\-–—☐\d.)]+"#,
                with: "",
                options: .regularExpression
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !candidate.isEmpty else { return fallback }

        if let boundary = candidate.firstIndex(where: { ".!?\n".contains($0) }) {
            candidate = String(candidate[..<boundary])
        }
        let words = candidate.split(whereSeparator: \.isWhitespace)
        candidate = words.prefix(9).joined(separator: " ")
        candidate = candidate.trimmingCharacters(
            in: .whitespacesAndNewlines.union(.punctuationCharacters)
        )
        guard !candidate.isEmpty else { return fallback }
        if words.count > 9 {
            candidate += "…"
        }
        return String(candidate.prefix(100))
    }
}
