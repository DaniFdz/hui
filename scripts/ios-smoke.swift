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
    // CI's cold first capture arrived after the deadline, but the matcher was already correct.
    let ciConnectOCR = "3:52\nC\nConnect to HUI\nThe address of the gateway you want this\napp to show.\nGATEWAY URL\nhttps://my-machine.example.ts.net\nConnect"
    try check(isReady(ciConnectOCR, for: "connect"), "CI Connect OCR did not match")
    print("Vision oracle self-test passed (synthetic images only; not app proof)")
}

// Both preparation and proof use this exact native capture path. A warm-up frame is never ready evidence.
func captureScreenshot(udid: String, path: URL, label: String) throws {
    let started = ProcessInfo.processInfo.systemUptime
    print("\(label) screenshot started at uptime=\(started): \(path.path)")
    fflush(stdout)
    let capture = Process()
    capture.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    capture.arguments = ["simctl", "io", udid, "screenshot", path.path]
    do {
        try capture.run()
    } catch {
        throw Failure(description: "\(label) screenshot transport could not start at uptime=\(ProcessInfo.processInfo.systemUptime): \(error)")
    }
    capture.waitUntilExit()
    let completed = ProcessInfo.processInfo.systemUptime
    print("\(label) screenshot completed at uptime=\(completed), transport=\(completed - started) s, status=\(capture.terminationStatus)")
    fflush(stdout)
    guard capture.terminationStatus == 0 else {
        throw Failure(description: "\(label) screenshot failed with status \(capture.terminationStatus) at uptime=\(completed)")
    }
}

func warmUp(udid: String, directory: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let frame = directory.appendingPathComponent("capture-warm-up.png")
    try captureScreenshot(udid: udid, path: frame, label: "warm-up")
    // Exercise the actual Simulator image dimensions too; synthetic Vision tests alone did not warm transport.
    _ = try autoreleasepool { try recognizeFile(frame) }
    print("Native capture/Vision warm-up completed at uptime=\(ProcessInfo.processInfo.systemUptime); not app readiness proof")
}

func waitForReady(udid: String, directory: URL, phase: String) throws {
    guard required[phase] != nil else { throw Failure(description: "Unknown phase: \(phase)") }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let latest = directory.appendingPathComponent("\(phase)-latest.png")
    let ready = directory.appendingPathComponent("\(phase)-ready.png")
    // Keep 24 s from wait entry through capture AND OCR; never restart or pause this clock.
    // Native first-use transport/Vision preparation must finish before the workflow launches HUI.
    let deadline = ProcessInfo.processInfo.systemUptime + 24
    print("\(phase) readiness deadline at uptime=\(deadline)")
    var lastText = ""
    while ProcessInfo.processInfo.systemUptime < deadline {
        try captureScreenshot(udid: udid, path: latest, label: phase)
        let ocrStarted = ProcessInfo.processInfo.systemUptime
        lastText = try autoreleasepool { try recognizeFile(latest) }
        let observedAt = ProcessInfo.processInfo.systemUptime
        let matches = isReady(lastText, for: phase)
        print("\(phase) OCR completed at uptime=\(observedAt), OCR=\(observedAt - ocrStarted) s, matches=\(matches), deadline=\(deadline)")
        if observedAt < deadline && matches {
            try FileManager.default.copyItem(at: latest, to: ready)
            print("\(phase) rendered boot content ready: \(ready.path)\n\(lastText)")
            return
        }
    }
    throw Failure(description: "\(phase) did not observe \(required[phase]!) within 24 s (capture + OCR deadline uptime=\(deadline), now=\(ProcessInfo.processInfo.systemUptime)). Last OCR:\n\(lastText)")
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    if args == ["self-test"] {
        try selfTest()
    } else if args.count == 3 && args[0] == "warm-up" {
        try warmUp(udid: args[1], directory: URL(fileURLWithPath: args[2]))
    } else if args.count == 4 && args[0] == "wait" {
        try waitForReady(udid: args[1], directory: URL(fileURLWithPath: args[2]), phase: args[3])
    } else {
        throw Failure(description: "Usage: ios-smoke self-test | warm-up <udid> <shots-directory> | wait <udid> <shots-directory> <connect|gateway>")
    }
} catch {
    fputs("ios-smoke: \(error)\n", stderr)
    exit(1)
}
