import NaturalLanguage
import UIKit

final class KeyboardViewController: UIInputViewController {
    private static let appGroup = "group.com.dictalume.app"
    private static let latestTranscriptKey = "latestTranscript"

    private let group = UserDefaults(suiteName: appGroup)!
    private let checker = UITextChecker()
    private let contentStack = UIStackView()
    private let suggestionsRow = UIStackView()
    private let microphoneButton = UIButton(type: .system)
    private let modeButton = UIButton(type: .system)
    private let shiftButton = UIButton(type: .system)
    private let globeButton = UIButton(type: .system)

    private var letterButtons: [UIButton] = []
    private var suggestionButtons: [UIButton] = []
    private var keyHeightConstraints: [NSLayoutConstraint] = []
    private var keyboardHeightConstraint: NSLayoutConstraint?
    private var suggestionHeightConstraint: NSLayoutConstraint?
    private var supplementaryWords: Set<String> = []
    private var deleteTimer: Timer?
    private var lastCorrection: (original: String, corrected: String)?
    private var shifted = false
    private var shiftLocked = false
    private var symbols = false

    private let letterValues = Array("qwertyuiopasdfghjklçzxcvbnm").map(String.init)
    private let symbolValues = [
        "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
        "@", "#", "$", "&", "_", "-", "+", "(", ")", "/",
        "*", "\"", "'", ";", ":", ",", "."
    ]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = keyboardBackground
        buildKeyboard()
        loadSupplementaryLexicon()
        refreshState()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refreshState()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyMetrics(compact: traitCollection.verticalSizeClass == .compact)
    }

    deinit {
        deleteTimer?.invalidate()
    }

    private var keyboardBackground: UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.12, green: 0.12, blue: 0.13, alpha: 1)
                : UIColor(red: 0.82, green: 0.83, blue: 0.85, alpha: 1)
        }
    }

    private var letterKeyBackground: UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.40, green: 0.40, blue: 0.42, alpha: 1)
                : .white
        }
    }

    private var specialKeyBackground: UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.23, green: 0.23, blue: 0.25, alpha: 1)
                : UIColor(red: 0.68, green: 0.69, blue: 0.72, alpha: 1)
        }
    }

    private func buildKeyboard() {
        contentStack.axis = .vertical
        contentStack.spacing = 6
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(contentStack)

        keyboardHeightConstraint = view.heightAnchor.constraint(equalToConstant: 258)
        keyboardHeightConstraint?.priority = .defaultHigh
        NSLayoutConstraint.activate([
            contentStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 4),
            contentStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -4),
            contentStack.topAnchor.constraint(equalTo: view.topAnchor, constant: 6),
            contentStack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -6),
            keyboardHeightConstraint!
        ])

        buildSuggestionRow()
        contentStack.addArrangedSubview(letterRow(Array(letterValues[0..<10])))
        contentStack.addArrangedSubview(letterRow(Array(letterValues[10..<20]), horizontalInset: 14))
        contentStack.addArrangedSubview(thirdLetterRow())
        contentStack.addArrangedSubview(bottomRow())
    }

    private func buildSuggestionRow() {
        suggestionsRow.axis = .horizontal
        suggestionsRow.spacing = 1
        suggestionsRow.distribution = .fill

        var microphone = UIButton.Configuration.plain()
        microphone.image = UIImage(systemName: "mic.fill")
        microphone.baseForegroundColor = .label
        microphoneButton.configuration = microphone
        microphoneButton.addTarget(self, action: #selector(openDictalumeRecording), for: .touchUpInside)
        microphoneButton.widthAnchor.constraint(equalToConstant: 44).isActive = true
        microphoneButton.accessibilityLabel = "Record with Dictalume"
        microphoneButton.accessibilityHint = "Opens Dictalume and starts recording. Return here to insert the transcript."
        suggestionsRow.addArrangedSubview(microphoneButton)

        let divider = UIView()
        divider.backgroundColor = .separator
        divider.widthAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale).isActive = true
        suggestionsRow.addArrangedSubview(divider)

        for index in 0..<3 {
            let button = UIButton(type: .system)
            var configuration = UIButton.Configuration.plain()
            configuration.baseForegroundColor = .label
            configuration.titleLineBreakMode = .byTruncatingTail
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
                var attributes = $0
                attributes.font = .preferredFont(forTextStyle: .body)
                return attributes
            }
            button.configuration = configuration
            button.tag = index
            button.addTarget(self, action: #selector(suggestionTapped(_:)), for: .touchUpInside)
            button.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            button.accessibilityHint = "Inserts this suggestion."
            suggestionButtons.append(button)
            suggestionsRow.addArrangedSubview(button)
        }
        suggestionHeightConstraint = suggestionsRow.heightAnchor.constraint(equalToConstant: 38)
        suggestionHeightConstraint?.isActive = true
        contentStack.addArrangedSubview(suggestionsRow)
    }

    private func letterRow(_ letters: [String], horizontalInset: CGFloat = 0) -> UIView {
        let container = UIView()
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 5
        row.distribution = .fillEqually
        row.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: horizontalInset),
            row.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -horizontalInset),
            row.topAnchor.constraint(equalTo: container.topAnchor),
            row.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        for letter in letters {
            let button = characterButton(letter)
            letterButtons.append(button)
            row.addArrangedSubview(button)
        }
        return container
    }

    private func thirdLetterRow() -> UIView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 6
        row.distribution = .fill

        configureSpecialButton(shiftButton, image: "shift", action: #selector(toggleShift))
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(lockShift))
        doubleTap.numberOfTapsRequired = 2
        shiftButton.addGestureRecognizer(doubleTap)
        row.addArrangedSubview(shiftButton)

        let letters = letterRow(Array(letterValues[20..<27]))
        row.addArrangedSubview(letters)

        let delete = UIButton(type: .system)
        configureSpecialButton(delete, image: "delete.left", action: #selector(deleteBackward))
        delete.addTarget(self, action: #selector(beginRepeatingDelete), for: .touchDown)
        delete.addTarget(
            self,
            action: #selector(stopRepeatingDelete),
            for: [.touchUpInside, .touchUpOutside, .touchCancel]
        )
        row.addArrangedSubview(delete)
        return row
    }

    private func bottomRow() -> UIView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 6
        row.distribution = .fill

        configureSpecialButton(globeButton, image: "globe", action: #selector(nextKeyboard), width: 44)
        globeButton.accessibilityLabel = "Next keyboard"
        row.addArrangedSubview(globeButton)

        configureTextSpecialButton(modeButton, title: "123", action: #selector(toggleSymbols), width: 48)
        row.addArrangedSubview(modeButton)

        let space = characterButton("space", insertedValue: " ")
        space.setContentHuggingPriority(.defaultLow, for: .horizontal)
        row.addArrangedSubview(space)

        let returnButton = characterButton("return", insertedValue: "\n")
        returnButton.widthAnchor.constraint(equalToConstant: 74).isActive = true
        row.addArrangedSubview(returnButton)
        return row
    }

    private func characterButton(_ title: String, insertedValue: String? = nil) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.baseBackgroundColor = letterKeyBackground
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .medium
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 2, bottom: 0, trailing: 2)
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
            var attributes = $0
            attributes.font = title.count == 1
                ? .systemFont(ofSize: 22)
                : .preferredFont(forTextStyle: .body)
            return attributes
        }
        button.configuration = configuration
        button.accessibilityValue = insertedValue ?? title
        button.addTarget(self, action: #selector(characterTapped(_:)), for: .touchUpInside)
        addKeyHeight(to: button)

        if title.count == 1, let accents = accentVariants[title.lowercased()] {
            button.menu = UIMenu(children: accents.map { value in
                UIAction(title: value) { [weak self] _ in
                    self?.insertCharacter(value)
                }
            })
        }
        return button
    }

    private var accentVariants: [String: [String]] {
        [
            "a": ["á", "à", "ã", "â"],
            "e": ["é", "ê"],
            "i": ["í"],
            "o": ["ó", "õ", "ô"],
            "u": ["ú", "ü"],
            "c": ["ç"]
        ]
    }

    private func configureSpecialButton(
        _ button: UIButton,
        image: String,
        action: Selector,
        width: CGFloat = 46
    ) {
        var configuration = UIButton.Configuration.filled()
        configuration.image = UIImage(systemName: image)
        configuration.baseBackgroundColor = specialKeyBackground
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .medium
        button.configuration = configuration
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: width).isActive = true
        addKeyHeight(to: button)
    }

    private func configureTextSpecialButton(
        _ button: UIButton,
        title: String,
        action: Selector,
        width: CGFloat
    ) {
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.baseBackgroundColor = specialKeyBackground
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .medium
        button.configuration = configuration
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: width).isActive = true
        addKeyHeight(to: button)
    }

    private func addKeyHeight(to button: UIButton) {
        let constraint = button.heightAnchor.constraint(equalToConstant: 43)
        constraint.isActive = true
        keyHeightConstraints.append(constraint)
    }

    private func applyMetrics(compact: Bool) {
        let height: CGFloat = compact ? 34 : 43
        let total: CGFloat = compact ? 212 : 258
        guard keyboardHeightConstraint?.constant != total else { return }
        keyHeightConstraints.forEach { $0.constant = height }
        suggestionHeightConstraint?.constant = compact ? 34 : 38
        keyboardHeightConstraint?.constant = total
        contentStack.spacing = compact ? 4 : 6
    }

    @objc private func characterTapped(_ sender: UIButton) {
        let value = sender.accessibilityValue ?? sender.configuration?.title ?? ""
        if value == " " {
            insertSpace()
        } else {
            insertCharacter(value)
        }
    }

    private func insertCharacter(_ value: String) {
        let rendered: String
        if !symbols, shifted {
            rendered = value.uppercased()
        } else {
            rendered = value
        }
        textDocumentProxy.insertText(rendered)
        lastCorrection = nil
        if shifted && !shiftLocked {
            shifted = false
            updateLetterCase()
        }
        updateSuggestions()
    }

    private func insertSpace() {
        let context = textDocumentProxy.documentContextBeforeInput ?? ""
        if context.hasSuffix(" ") {
            textDocumentProxy.deleteBackward()
            textDocumentProxy.insertText(". ")
            lastCorrection = nil
            refreshState()
            return
        }

        let original = currentWord(in: context)
        if let original, let corrected = conservativeAutocorrection(for: original) {
            replaceCurrentWord(original, with: corrected)
            lastCorrection = (original, corrected)
        } else {
            lastCorrection = nil
        }
        textDocumentProxy.insertText(" ")
        refreshState()
    }

    @objc private func suggestionTapped(_ sender: UIButton) {
        guard let value = sender.configuration?.title, !value.isEmpty else { return }
        if value == "Insert latest Dictalume" {
            insertLatestTranscript()
            return
        }
        let context = textDocumentProxy.documentContextBeforeInput ?? ""
        guard let current = currentWord(in: context) else {
            textDocumentProxy.insertText(value)
            return
        }
        replaceCurrentWord(current, with: value)
        textDocumentProxy.insertText(" ")
        lastCorrection = (current, value)
        refreshState()
    }

    private func insertLatestTranscript() {
        guard let transcript = group.string(forKey: Self.latestTranscriptKey),
              !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }
        textDocumentProxy.insertText(transcript)
        if !transcript.hasSuffix(" ") && !transcript.hasSuffix("\n") {
            textDocumentProxy.insertText(" ")
        }
        refreshState()
    }

    private func replaceCurrentWord(_ current: String, with replacement: String) {
        for _ in current {
            textDocumentProxy.deleteBackward()
        }
        textDocumentProxy.insertText(replacement)
    }

    @objc private func toggleShift() {
        guard !symbols else { return }
        shiftLocked = false
        shifted.toggle()
        updateLetterCase()
    }

    @objc private func lockShift() {
        guard !symbols else { return }
        shiftLocked = true
        shifted = true
        updateLetterCase()
    }

    @objc private func toggleSymbols() {
        symbols.toggle()
        shifted = false
        shiftLocked = false
        for (index, button) in letterButtons.enumerated() {
            let title = symbols ? symbolValues[index] : letterValues[index]
            button.configuration?.title = title
            button.accessibilityValue = title
        }
        modeButton.configuration?.title = symbols ? "ABC" : "123"
        shiftButton.isEnabled = !symbols
        shiftButton.configuration?.image = UIImage(systemName: symbols ? "number" : "shift")
        updateSuggestions()
    }

    private func updateLetterCase() {
        for (index, button) in letterButtons.enumerated() {
            let value = letterValues[index]
            let next = shifted ? value.uppercased() : value.lowercased()
            button.configuration?.title = next
            button.accessibilityValue = next
        }
        let symbol = shiftLocked ? "capslock.fill" : shifted ? "shift.fill" : "shift"
        shiftButton.configuration?.image = UIImage(systemName: symbol)
        shiftButton.configuration?.baseBackgroundColor =
            shifted ? letterKeyBackground : specialKeyBackground
    }

    @objc private func deleteBackward() {
        if let correction = lastCorrection,
           (textDocumentProxy.documentContextBeforeInput ?? "").hasSuffix(correction.corrected + " ")
        {
            textDocumentProxy.deleteBackward()
            replaceCurrentWord(correction.corrected, with: correction.original)
            lastCorrection = nil
        } else {
            textDocumentProxy.deleteBackward()
            lastCorrection = nil
        }
        refreshState()
    }

    @objc private func beginRepeatingDelete() {
        deleteTimer?.invalidate()
        deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.42, repeats: false) {
            [weak self] _ in
            self?.deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.075, repeats: true) {
                [weak self] _ in self?.deleteBackward()
            }
        }
    }

    @objc private func stopRepeatingDelete() {
        deleteTimer?.invalidate()
        deleteTimer = nil
    }

    @objc private func nextKeyboard() {
        advanceToNextInputMode()
    }

    @objc private func openDictalumeRecording() {
        guard let url = URL(string: "dictalume://record?source=keyboard") else { return }
        extensionContext?.open(url) { [weak self] opened in
            guard !opened else { return }
            self?.microphoneButton.configuration?.image =
                UIImage(systemName: "exclamationmark.circle")
            self?.microphoneButton.accessibilityHint =
                "Open Dictalume or use its Action Button shortcut to record."
        }
    }

    private func refreshState() {
        globeButton.isHidden = !needsInputModeSwitchKey
        updateAutomaticShift()
        updateSuggestions()
    }

    private func updateAutomaticShift() {
        guard !symbols, !shiftLocked else { return }
        let context = (textDocumentProxy.documentContextBeforeInput ?? "")
            .trimmingCharacters(in: .whitespaces)
        let shouldShift = context.isEmpty || context.hasSuffix(".") ||
            context.hasSuffix("!") || context.hasSuffix("?") || context.hasSuffix("\n")
        guard shifted != shouldShift else { return }
        shifted = shouldShift
        updateLetterCase()
    }

    private func updateSuggestions() {
        guard !symbols else {
            setSuggestions([])
            return
        }
        let context = textDocumentProxy.documentContextBeforeInput ?? ""
        guard let word = currentWord(in: context), word.count >= 2 else {
            let latestAvailable = !(group.string(forKey: Self.latestTranscriptKey) ?? "").isEmpty
            setSuggestions(latestAvailable ? ["Insert latest Dictalume"] : [])
            return
        }
        setSuggestions(suggestions(for: word, context: context))
    }

    private func setSuggestions(_ values: [String]) {
        for (index, button) in suggestionButtons.enumerated() {
            let value = index < values.count ? values[index] : ""
            button.configuration?.title = value
            button.isEnabled = !value.isEmpty
            button.accessibilityLabel = value.isEmpty ? "No suggestion" : value
        }
    }

    private func suggestions(for word: String, context: String) -> [String] {
        guard shouldCheck(word) else { return [] }
        var found: [String] = []
        for language in languageOrder(for: context) {
            let guesses = checker.guesses(
                forWordRange: NSRange(location: 0, length: (word as NSString).length),
                in: word,
                language: language
            ) ?? []
            for guess in guesses.prefix(3)
            where guess.caseInsensitiveCompare(word) != .orderedSame &&
                !found.contains(where: { $0.caseInsensitiveCompare(guess) == .orderedSame })
            {
                found.append(matchCase(of: word, replacement: guess))
            }
        }
        return Array(found.prefix(3))
    }

    private func conservativeAutocorrection(for word: String) -> String? {
        guard shouldCheck(word) else { return nil }
        let languages = languageOrder(for: textDocumentProxy.documentContextBeforeInput ?? "")
        let validInOneLanguage = languages.contains { language in
            checker.rangeOfMisspelledWord(
                in: word,
                range: NSRange(location: 0, length: (word as NSString).length),
                startingAt: 0,
                wrap: false,
                language: language
            ).location == NSNotFound
        }
        guard !validInOneLanguage else { return nil }

        let guesses = languages.map { language in
            checker.guesses(
                forWordRange: NSRange(location: 0, length: (word as NSString).length),
                in: word,
                language: language
            ) ?? []
        }
        guard let candidate = guesses.first?.first else { return nil }
        let supportedByBoth = guesses.dropFirst().allSatisfy {
            $0.isEmpty || $0.prefix(2).contains(where: {
                $0.caseInsensitiveCompare(candidate) == .orderedSame
            })
        }
        guard supportedByBoth, editDistance(word.lowercased(), candidate.lowercased()) <= 2 else {
            return nil
        }
        return matchCase(of: word, replacement: candidate)
    }

    private func shouldCheck(_ word: String) -> Bool {
        guard word.count >= 3 else { return false }
        if supplementaryWords.contains(word.lowercased()) { return false }
        if word.allSatisfy({ $0.isUppercase || $0.isNumber }) { return false }
        if word.contains(where: \.isNumber) { return false }
        return word.unicodeScalars.allSatisfy {
            CharacterSet.letters.contains($0) || CharacterSet.nonBaseCharacters.contains($0)
        }
    }

    private func languageOrder(for context: String) -> [String] {
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(String(context.suffix(240)))
        if recognizer.dominantLanguage == .english {
            return ["en-US", "pt-BR"]
        }
        return ["pt-BR", "en-US"]
    }

    private func currentWord(in context: String) -> String? {
        guard let final = context.last,
              final.isLetter || final.isNumber || final == "'" || final == "’"
        else { return nil }
        let components = context.split {
            !$0.isLetter && !$0.isNumber && $0 != "'" && $0 != "’"
        }
        return components.last.map(String.init)
    }

    private func matchCase(of original: String, replacement: String) -> String {
        if original == original.uppercased() { return replacement.uppercased() }
        if original.first?.isUppercase == true {
            return replacement.prefix(1).uppercased() + replacement.dropFirst()
        }
        return replacement.lowercased()
    }

    private func editDistance(_ lhs: String, _ rhs: String) -> Int {
        let left = Array(lhs)
        let right = Array(rhs)
        var previous = Array(0...right.count)
        for (leftIndex, leftCharacter) in left.enumerated() {
            var current = [leftIndex + 1]
            for (rightIndex, rightCharacter) in right.enumerated() {
                current.append(min(
                    current[rightIndex] + 1,
                    previous[rightIndex + 1] + 1,
                    previous[rightIndex] + (leftCharacter == rightCharacter ? 0 : 1)
                ))
            }
            previous = current
        }
        return previous.last ?? max(left.count, right.count)
    }

    private func loadSupplementaryLexicon() {
        let sharedWords = sharedVocabularyWords()
        supplementaryWords.formUnion(sharedWords)
        requestSupplementaryLexicon { [weak self] lexicon in
            let systemWords = Set(
                lexicon.entries.flatMap { [$0.userInput.lowercased(), $0.documentText.lowercased()] }
            )
            self?.supplementaryWords.formUnion(systemWords)
        }
    }

    private func sharedVocabularyWords() -> Set<String> {
        let memory = group.string(forKey: "vocabulary") ?? ""
        let entries = memory.components(separatedBy: .newlines)
            .flatMap { $0.components(separatedBy: ",") }
            .map {
                $0.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
                    .lowercased()
            }
            .filter { !$0.isEmpty && $0.count <= 80 }
        return Set(entries + entries.flatMap {
            $0.split(whereSeparator: \.isWhitespace).map(String.init)
        })
    }
}
