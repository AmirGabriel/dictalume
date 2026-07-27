import Foundation

enum SpellingMemory {
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
        var values: [String: String] = [:]
        for line in existing.split(separator: "\n").map(String.init) + learned {
            values[line.uppercased()] = line
        }
        return values.values.sorted().suffix(200).joined(separator: "\n")
    }
}
