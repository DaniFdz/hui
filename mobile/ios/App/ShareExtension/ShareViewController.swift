import ObjectiveC
import UIKit

/**
 The Share Extension's only screen: what the system shared becomes `hui://share?url=…`, and HUI opens with it, which
 turns the value into `<gateway>/new-session?share=…`. The extension has no gateway of its own — the app resolves the one
 it remembers and ignores the link without one.

 Opening the app takes two steps. Apple documents `NSExtensionContext.open(_:)` — how an extension asks iOS to open its
 app — for the Today and iMessage extension points only, so a share extension calling it is unsupported, and it is
 reported to answer `false` on iOS 18 and later, a cold start especially. The responder chain is the standard workaround:
 `open` is tried first and a `false` answer is handed to the first responder that answers `openURL:` (see
 `openFromResponderChain`). `openURL:` is a public `UIApplication` method marked unavailable in app extensions, not a
 private selector: the chain never names the symbol, so App Review's private-API rule is not the runtime barrier, and
 HUI's unsigned IPA is signed by SideStore with the operator's own Apple ID, so App Review never sees it.

 A share that leaves neither way is shown here with a Copy action instead of failing silently. There is no Capacitor and
 no storyboard: `loadView` builds every view it has.
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

    /// HUI has been asked to open. Set before the first attempt, so a provider callback that answers twice, or lands
    /// before `finished` is set, cannot ask iOS to open HUI a second time.
    private var requested = false

    /// A `public.url` candidate was a file address, which New Session cannot open. `public.file-url` conforms to
    /// `public.url`, so a file-only share would otherwise be refused as an empty one.
    private var rejectedFile = false

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
            fail(rejectedFile ? "HUI can't open this file. Share the post's link instead." : "Nothing to send to HUI.")
            return
        }
        let (type, provider) = candidates[index]
        provider.loadItem(forTypeIdentifier: type, options: nil) { [weak self] item, _ in
            let shared = ShareViewController.text(from: item)
            let value = shared
                .flatMap { type == "public.url" ? ShareViewController.webAddress(from: $0) : $0 }
                .flatMap(ShareViewController.payload(from:))
            // `public.file-url` conforms to `public.url`, so a file arrives as one: remembering that is what lets the
            // exhausted walk say the share held a file instead of calling it empty.
            let isFile = type == "public.url" && (shared.map { URL(string: $0)?.isFileURL == true } ?? false)
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                if let value {
                    self.send(value)
                } else {
                    if isFile { self.rejectedFile = true }
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
        // A provider that answers twice must not replace the value Copy would hand over after the first handoff.
        guard self.payload == nil else { return }
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

    /// The one handoff attempt. iOS answers `extensionContext.open` with `false` when it will not launch the app from
    /// here, and a share extension is the extension point it is unsupported for, so that answer is the responder chain's
    /// (`openFromResponderChain`). A second ask, and an answer that arrives after the sheet is done, are dropped.
    private func open(_ url: URL) {
        guard !requested else { return }
        requested = true
        guard let context = extensionContext else {
            fail("HUI couldn't be opened.")
            return
        }
        context.open(url) { [weak self] opened in
            DispatchQueue.main.async {
                guard let self, !self.finished else { return }
                if opened {
                    self.complete()
                } else {
                    self.openFromResponderChain(url)
                }
            }
        }
    }

    /**
     The fallback `open` needs: the first responder that answers `openURL:` is the one that can hand the link to the
     system, which is how a share extension starts its app. `responds(to:)` guards the selector, so it is only performed
     on a responder that really implements it and nothing is sent blindly; this runs on the main queue, because the
     provider callback that got here already dispatched there. `UIApplication` is never named: the chain is walked as
     responders, and the extension target stays API-extension-only.

     The call's `BOOL` answer is read through the runtime method's own type encoding (`method_getTypeEncoding`), not
     discarded: `perform(_:with:)` cannot carry a `BOOL` out, and its `Unmanaged<AnyObject>` return would be undefined.
     `methodSignature(for:)` would describe the method the same way, but Swift does not expose it, so the encoding is
     read from the runtime method instead. The encoding check keeps an unrelated `openURL:` implementation from being
     called with the wrong ABI — three arguments taking an object, a one-byte `BOOL` return — and a `false` answer is a
     real answer: the sheet stays, with Copy as the last resort.
     */
    private func openFromResponderChain(_ url: URL) {
        let selector = NSSelectorFromString("openURL:")
        typealias OpenURL = @convention(c) (AnyObject, Selector, NSURL) -> Bool
        var responder: UIResponder? = self
        while let candidate = responder {
            responder = candidate.next
            guard candidate.responds(to: selector) else { continue }
            guard let cls = object_getClass(candidate),
                  let method = class_getInstanceMethod(cls, selector),
                  let encoding = method_getTypeEncoding(method) else { continue }
            let types = String(cString: encoding)
            // - (BOOL)openURL:(NSURL *): one-byte BOOL return, object receiver, selector and object argument.
            guard types.hasPrefix("B") || types.hasPrefix("c"),
                  types.contains("@0:8@16") else { continue }
            let implementation = unsafeBitCast(candidate.method(for: selector), to: OpenURL.self)
            if implementation(candidate, selector, url as NSURL) {
                complete()
            } else {
                fail("HUI couldn't be opened.")
            }
            return
        }
        fail("HUI couldn't be opened.")
    }

    /// The handoff was made: the request is answered, which dismisses the sheet.
    private func complete() {
        guard !finished else { return }
        finished = true
        spinner.stopAnimating()
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
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
