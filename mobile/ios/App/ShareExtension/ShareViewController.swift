import UIKit

/**
 The Share Extension's only screen: what the system shared becomes `hui://share?url=…`, and iOS opens HUI with it, which
 turns the value into `<gateway>/new-session?share=…`. The extension has no gateway of its own — the app resolves the one
 it remembers and ignores the link without one — and iOS may refuse an extension's `open` too, so a share that does not
 leave is shown here with a Copy action instead of failing silently. There is no Capacitor and no storyboard: `loadView`
 builds every view it has.
 */
final class ShareViewController: UIViewController {
    private let titleLabel = UILabel()
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let copyButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)

    /// The value the app is being sent, kept so Copy can hand it over when the link does not open.
    private var payload: String?

    /// The sheet is done: the operator tapped Done, or the request completed. A provider callback that lands afterwards
    /// must not open HUI from under them, so every callback and every open checks this first.
    private var finished = false

    override func loadView() {
        let root = UIView()
        root.backgroundColor = .systemBackground

        titleLabel.text = "Send to HUI"
        titleLabel.font = .preferredFont(forTextStyle: .title2)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textAlignment = .center

        statusLabel.text = "Opening HUI…"
        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.adjustsFontForContentSizeCategory = true
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0

        spinner.hidesWhenStopped = true
        spinner.startAnimating()

        copyButton.setTitle("Copy", for: .normal)
        copyButton.addTarget(self, action: #selector(copyPayload), for: .touchUpInside)
        copyButton.isHidden = true

        closeButton.setTitle("Done", for: .normal)
        closeButton.addTarget(self, action: #selector(dismissSheet), for: .touchUpInside)

        let buttons = UIStackView(arrangedSubviews: [copyButton, closeButton])
        buttons.axis = .horizontal
        buttons.spacing = 24
        buttons.alignment = .center

        let stack = UIStackView(arrangedSubviews: [titleLabel, statusLabel, spinner, buttons])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: root.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: root.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -24),
            stack.centerXAnchor.constraint(equalTo: root.centerXAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        share()
    }

    /// The values the host offered, in the order HUI can use them: `public.url` first (a shared web address), then
    /// `public.plain-text`. Nothing else — New Session takes words, and a photo or a file would need an upload this
    /// extension cannot make.
    private func share() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap { $0.attachments ?? [] } ?? []
        let candidates: [(String, NSItemProvider)] = ["public.url", "public.plain-text"].flatMap { type in
            providers.filter { $0.hasItemConformingToTypeIdentifier(type) }.map { (type, $0) }
        }
        load(candidates, at: 0)
    }

    /// The first candidate that hands back words is the one sent: a share can offer a URL that does not load with text
    /// beside it, and the sheet should not close on the broken one. A `public.url` candidate also has to be a web
    /// address (`webAddress`), and the plain-text candidate beside it is what a file URL falls back to.
    private func load(_ candidates: [(String, NSItemProvider)], at index: Int) {
        guard index < candidates.count else {
            fail("Nothing to send to HUI.")
            return
        }
        let (type, provider) = candidates[index]
        provider.loadItem(forTypeIdentifier: type, options: nil) { [weak self] item, _ in
            let value = ShareViewController.text(from: item)
                .flatMap { type == "public.url" ? ShareViewController.webAddress(from: $0) : $0 }
                .flatMap(ShareViewController.payload(from:))
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                if let value {
                    self.send(value)
                } else {
                    self.load(candidates, at: index + 1)
                }
            }
        }
    }

    /// A `public.url` value, or nothing: `public.file-url` conforms to `public.url`, so a share that offers a file beside
    /// its text hands back `file:///…` here, and the only address New Session can open is an `http(s)` one.
    static func webAddress(from value: String) -> String? {
        guard let scheme = URL(string: value)?.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return nil }
        return value
    }

    /// What a provider handed back, whichever representation it chose: a URL, a string, attributed words, or their bytes.
    static func text(from item: NSSecureCoding?) -> String? {
        if let url = item as? URL { return url.absoluteString }
        if let url = item as? NSURL { return url.absoluteString }
        if let string = item as? String { return string }
        if let attributed = item as? NSAttributedString { return attributed.string }
        if let data = item as? Data { return String(data: data, encoding: .utf8) }
        return nil
    }

    /// The value the link carries: what was shared, trimmed at both ends only. The line breaks and tabs inside it stay as
    /// they were written — Android sends the same ones, so one share arrives the same on both phones — and
    /// `DeepLink.fittedShare` then cuts the value to what the app accepts, on a character boundary, so no emoji or
    /// accented letter is split in half.
    static func payload(from value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return DeepLink.fittedShare(trimmed)
    }

    private func send(_ payload: String) {
        self.payload = payload
        guard var link = URLComponents(string: "hui://share") else {
            fail("HUI couldn't be opened.")
            return
        }
        link.queryItems = [URLQueryItem(name: "url", value: payload)]
        guard let url = link.url else {
            fail("HUI couldn't be opened.")
            return
        }
        open(url)
    }

    /// iOS refuses an extension's `open` when it will not launch the app from here, and answers `false` rather than
    /// throwing; the operator still gets the words, with Copy. An answer that arrives after the sheet is done is dropped.
    private func open(_ url: URL) {
        guard let context = extensionContext else {
            fail("HUI couldn't be opened.")
            return
        }
        context.open(url) { [weak self] opened in
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                if opened {
                    self.finished = true
                    self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                } else {
                    self.fail("HUI couldn't be opened.")
                }
            }
        }
    }

    private func fail(_ message: String) {
        guard !finished else { return }
        spinner.stopAnimating()
        statusLabel.text = message
        copyButton.isHidden = payload == nil
    }

    @objc private func copyPayload() {
        guard let payload else { return }
        UIPasteboard.general.string = payload
        copyButton.setTitle("Copied", for: .normal)
    }

    @objc private func dismissSheet() {
        guard !finished else { return }
        finished = true
        spinner.stopAnimating()
        extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
    }
}
