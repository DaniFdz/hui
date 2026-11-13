// Owns the iOS CI boot-readiness oracle: Vision reads actual simulator frames, not changed pixels or elapsed sleeps.
// This proves rendered boot content only, not permission dismissal, taps, or an interactive phone journey.
import AppKit
import Vision

struct Failure: Error, CustomStringConvertible {
    let description: String
}

let required: [String: [String]] = [
    "connect": ["Connect to HUI", "GATEWAY URL"],
    "gateway": ["Plan the Android app", "Fix the flaky upload test"],
]

func normalized(_ text: String) -> String {
    text.lowercased(with: Locale(identifier: "en_US_POSIX"))
        .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}

func isReady(_ text: String, for phase: String) -> Bool {
    guard let phrases = required[phase] else { return false }
    let text = " " + normalized(text) + " "
    return phrases.allSatisfy { text.contains(" " + normalized($0) + " ") }
}

func recognize(_ image: CGImage) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

func recognizeFile(_ path: URL) throws -> String {
    guard let image = NSImage(contentsOf: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw Failure(description: "Cannot read screenshot: \(path.path)")
    }
    return try recognize(cgImage)
}

// Synthetic images exercise the real built-in Vision path. They are oracle tests, never app proof.
func selfTest() throws {
    func check(_ condition: Bool, _ message: String) throws {
        if !condition { throw Failure(description: "Oracle self-test: \(message)") }
    }
    func rendered(_ text: String) throws -> String {
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1400, pixelsHigh: 700,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
            let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            throw Failure(description: "Cannot create oracle self-test image")
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor.white.setFill()
        NSRect(x: 0, y: 0, width: 1400, height: 700).fill()
        (text as NSString).draw(in: NSRect(x: 50, y: 50, width: 1300, height: 600),
            withAttributes: [.font: NSFont.systemFont(ofSize: 40), .foregroundColor: NSColor.black])
        NSGraphicsContext.restoreGraphicsState()
        guard let image = bitmap.cgImage else { throw Failure(description: "Cannot read self-test image") }
        return try recognize(image)
    }
    let blank = try rendered("")
    let wrong = try rendered("9:41\nConnecting to HUI\nError: gateway unavailable")
    for phase in ["connect", "gateway"] {
        let phrases = required[phase]!
        try check(!isReady(blank, for: phase), "blank frame passed \(phase)")
        try check(!isReady(wrong, for: phase), "clock, splash or error frame passed \(phase)")
        for phrase in phrases {
            let partial = try rendered(phrase)
            try check(!isReady(partial, for: phase), "one required phrase alone passed \(phase)")
        }
        let positive = try rendered(phrases.joined(separator: "\n"))
        try check(isReady(positive, for: phase), "required rendered text failed \(phase): \(positive)")
        try check(isReady(phrases.joined(separator: "\n").uppercased()
            .replacingOccurrences(of: " ", with: "\n  "), for: phase), "case/line normalization failed")
    }
    print("Vision oracle self-test passed (synthetic images only; not app proof)")
}

func waitForReady(udid: String, directory: URL, phase: String) throws {
    guard required[phase] != nil else { throw Failure(description: "Unknown phase: \(phase)") }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let latest = directory.appendingPathComponent("\(phase)-latest.png")
    let ready = directory.appendingPathComponent("\(phase)-ready.png")
    // Preserve the old ~24 s per-phase budget; compilation and self-test happen before the app launches.
    let deadline = ProcessInfo.processInfo.systemUptime + 24
    var lastText = ""
    while ProcessInfo.processInfo.systemUptime < deadline {
        let capture = Process()
        capture.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        capture.arguments = ["simctl", "io", udid, "screenshot", latest.path]
        try capture.run()
        capture.waitUntilExit()
        guard capture.terminationStatus == 0 else {
            throw Failure(description: "\(phase) screenshot failed with status \(capture.terminationStatus)")
        }
        lastText = try autoreleasepool { try recognizeFile(latest) }
        if ProcessInfo.processInfo.systemUptime < deadline && isReady(lastText, for: phase) {
            try FileManager.default.copyItem(at: latest, to: ready)
            print("\(phase) rendered boot content ready: \(ready.path)\n\(lastText)")
            return
        }
    }
    throw Failure(description: "\(phase) did not render \(required[phase]!) within 24 s. Last OCR:\n\(lastText)")
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    if args == ["self-test"] {
        try selfTest()
    } else if args.count == 4 && args[0] == "wait" {
        try waitForReady(udid: args[1], directory: URL(fileURLWithPath: args[2]), phase: args[3])
    } else {
        throw Failure(description: "Usage: ios-smoke self-test | wait <udid> <shots-directory> <connect|gateway>")
    }
} catch {
    fputs("ios-smoke: \(error)\n", stderr)
    exit(1)
}
