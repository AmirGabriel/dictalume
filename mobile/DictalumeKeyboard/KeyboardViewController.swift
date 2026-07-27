import UIKit

final class KeyboardViewController: UIInputViewController {
    private let group = UserDefaults(suiteName: "group.com.dictalume.app")!
    private let contentStack = UIStackView()
    private let transcriptButton = UIButton(type: .system)
    private var letterButtons: [UIButton] = []
    private var modeButton = UIButton(type: .system)
    private var shifted = false
    private var symbols = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGray5
        buildKeyboard()
        refreshTranscriptButton()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refreshTranscriptButton()
    }

    private func buildKeyboard() {
        contentStack.axis = .vertical
        contentStack.spacing = 7
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(contentStack)
        NSLayoutConstraint.activate([
            contentStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 5),
            contentStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -5),
            contentStack.topAnchor.constraint(equalTo: view.topAnchor, constant: 7),
            contentStack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -7),
            view.heightAnchor.constraint(equalToConstant: 292)
        ])

        var transcript = UIButton.Configuration.filled()
        transcript.cornerStyle = .medium
        transcript.baseBackgroundColor = .systemBlue
        transcript.baseForegroundColor = .white
        transcript.image = UIImage(systemName: "waveform")
        transcript.imagePadding = 7
        transcriptButton.configuration = transcript
        transcriptButton.addTarget(self, action: #selector(insertLatestTranscript), for: .touchUpInside)
        transcriptButton.heightAnchor.constraint(equalToConstant: 40).isActive = true
        contentStack.addArrangedSubview(transcriptButton)

        contentStack.addArrangedSubview(letterRow(Array("qwertyuiop")))
        contentStack.addArrangedSubview(letterRow(Array("asdfghjkl"), horizontalInset: 17))

        let third = UIStackView()
        third.axis = .horizontal
        third.spacing = 6
        third.distribution = .fill
        third.addArrangedSubview(specialButton("shift.fill", action: #selector(toggleShift)))
        let letters = letterRow(Array("zxcvbnm"))
        third.addArrangedSubview(letters)
        third.addArrangedSubview(specialButton("delete.left", action: #selector(deleteBackward)))
        contentStack.addArrangedSubview(third)

        let bottom = UIStackView()
        bottom.axis = .horizontal
        bottom.spacing = 6
        bottom.distribution = .fill
        bottom.addArrangedSubview(specialButton("globe", action: #selector(nextKeyboard), width: 45))
        modeButton = modeSwitchButton()
        bottom.addArrangedSubview(modeButton)
        let space = textButton("space", value: " ", width: nil)
        space.setContentHuggingPriority(.defaultLow, for: .horizontal)
        bottom.addArrangedSubview(space)
        bottom.addArrangedSubview(textButton("return", value: "\n", width: 76))
        contentStack.addArrangedSubview(bottom)
    }

    private func letterRow(_ letters: [Character], horizontalInset: CGFloat = 0) -> UIView {
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
            let button = keyButton(String(letter))
            letterButtons.append(button)
            row.addArrangedSubview(button)
        }
        return container
    }

    private func keyButton(_ title: String, tracked: Bool = true) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.baseBackgroundColor = .systemBackground
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .medium
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
            var attributes = $0
            attributes.font = .systemFont(ofSize: 22)
            return attributes
        }
        button.configuration = configuration
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.18
        button.layer.shadowOffset = CGSize(width: 0, height: 1)
        button.layer.shadowRadius = 0.5
        button.addTarget(self, action: #selector(letterTapped(_:)), for: .touchUpInside)
        button.heightAnchor.constraint(equalToConstant: 43).isActive = true
        if tracked { button.accessibilityValue = title }
        return button
    }

    private func specialButton(_ image: String, action: Selector, width: CGFloat = 46) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.image = UIImage(systemName: image)
        configuration.baseBackgroundColor = .systemGray3
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .medium
        button.configuration = configuration
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: width).isActive = true
        button.heightAnchor.constraint(equalToConstant: 43).isActive = true
        return button
    }

    private func textButton(_ title: String, value: String, width: CGFloat?) -> UIButton {
        let button = keyButton(title, tracked: false)
        button.accessibilityValue = value
        if let width { button.widthAnchor.constraint(equalToConstant: width).isActive = true }
        return button
    }

    private func modeSwitchButton() -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = "123"
        configuration.baseBackgroundColor = .systemGray3
        configuration.baseForegroundColor = .label
        configuration.cornerStyle = .medium
        button.configuration = configuration
        button.addTarget(self, action: #selector(toggleSymbols), for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: 48).isActive = true
        button.heightAnchor.constraint(equalToConstant: 43).isActive = true
        return button
    }

    @objc private func letterTapped(_ sender: UIButton) {
        let value = sender.accessibilityValue ?? sender.configuration?.title ?? ""
        textDocumentProxy.insertText(value)
        if shifted {
            shifted = false
            updateLetterCase()
        }
    }

    @objc private func toggleShift() {
        guard !symbols else { return }
        shifted.toggle()
        updateLetterCase()
    }

    @objc private func toggleSymbols() {
        symbols.toggle()
        shifted = false
        let letters = Array("qwertyuiopasdfghjklzxcvbnm").map(String.init)
        let punctuation = Array("1234567890@#$&_−+().,?!'\":;/").map(String.init)
        for (index, button) in letterButtons.enumerated() {
            let title = symbols ? punctuation[index] : letters[index]
            button.configuration?.title = title
            button.accessibilityValue = title
        }
        modeButton.configuration?.title = symbols ? "ABC" : "123"
    }

    private func updateLetterCase() {
        for button in letterButtons {
            let title = button.configuration?.title ?? ""
            let next = shifted ? title.uppercased() : title.lowercased()
            button.configuration?.title = next
            button.accessibilityValue = next
        }
    }

    @objc private func deleteBackward() {
        textDocumentProxy.deleteBackward()
    }

    @objc private func nextKeyboard() {
        advanceToNextInputMode()
    }

    @objc private func insertLatestTranscript() {
        guard let transcript = group.string(forKey: "latestTranscript"), !transcript.isEmpty else {
            transcriptButton.configuration?.title = "Record in Dictalume first"
            return
        }
        textDocumentProxy.insertText(transcript)
        if !transcript.hasSuffix(" ") && !transcript.hasSuffix("\n") {
            textDocumentProxy.insertText(" ")
        }
    }

    private func refreshTranscriptButton() {
        let available = !(group.string(forKey: "latestTranscript") ?? "").isEmpty
        transcriptButton.configuration?.title =
            available ? "Insert latest transcript" : "Record in Dictalume, then return"
        transcriptButton.isEnabled = true
    }
}
