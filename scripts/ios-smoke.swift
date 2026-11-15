// Owns the iOS CI boot-readiness oracle: Vision reads actual simulator frames, not changed pixels or elapsed sleeps.
// This proves rendered boot content only, not permission dismissal, taps, or an interactive phone journey.
import AppKit
import Darwin
import Dispatch
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

// One infrastructure deadline bounds both admission and completed evidence. This is not a UI render-latency SLA.
func acceptsObservation(_ text: String, for phase: String, startedAt: TimeInterval,
                        finishedAt: TimeInterval, deadline: TimeInterval) -> Bool {
    startedAt < deadline && finishedAt >= startedAt && finishedAt < deadline && isReady(text, for: phase)
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
    // Run 43377600459, artifact 14015289270: shots/connect-1.png and .txt are a real blank first frame.
    // C165 spent 26.678 s in capture/OCR; it proves no ready Connect page or native cold-render cause.
    let phaseStart = 620.0932430833334
    let infrastructureDeadline = phaseStart + 90
    let firstFinishedAt = 646.771619375
    try check(!acceptsObservation("6:26", for: "connect", startedAt: 620.1418623750001,
        finishedAt: firstFinishedAt, deadline: infrastructureDeadline), "C165 blank first frame passed")
    try check(firstFinishedAt < infrastructureDeadline, "C165 first observation exhausted infrastructure")
    // Pure matcher scenario only: a later matching observation is hypothetical, NOT a C165 screenshot or app proof.
    try check(acceptsObservation(ciConnectOCR, for: "connect", startedAt: firstFinishedAt + 0.01,
        finishedAt: firstFinishedAt + 8, deadline: infrastructureDeadline), "later in-bound content rejected")
    for start in [infrastructureDeadline, infrastructureDeadline + 1] {
        try check(!acceptsObservation(ciConnectOCR, for: "connect", startedAt: start,
            finishedAt: start + 1, deadline: infrastructureDeadline), "late admission passed")
    }
    for finish in [infrastructureDeadline, infrastructureDeadline + 1] {
        try check(!acceptsObservation(ciConnectOCR, for: "connect", startedAt: infrastructureDeadline - 2,
            finishedAt: finish, deadline: infrastructureDeadline), "late completion passed")
    }
    try check(!acceptsObservation(wrong, for: "connect", startedAt: phaseStart,
        finishedAt: firstFinishedAt, deadline: infrastructureDeadline), "in-bound splash/error observation passed")
    print("Vision oracle self-test passed (synthetic images only; not app proof or a render-latency SLA)")
}

// This owns the single whole-phase infrastructure ceiling, including a stuck capture or Vision call.
// This is NOT a 90 s UI SLA. The workflow's existing 30 minute job ceiling also remains in force.
final class InfrastructureWatchdog {
    private let lock = NSLock()
    private var active = true
    private var capture: Process?
    private let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
    let startedAt: TimeInterval
    let deadline: TimeInterval
    private let phase: String
    private let directory: URL

    init(phase: String, directory: URL) {
        self.phase = phase
        self.directory = directory
        let phaseStart = ProcessInfo.processInfo.systemUptime
        self.startedAt = phaseStart
        self.deadline = phaseStart + 90
        // Schedule the watchdog against the same absolute bound used by capture admission and acceptance.
        timer.schedule(deadline: .now() + max(0, deadline - ProcessInfo.processInfo.systemUptime))
        timer.setEventHandler { [weak self] in self?.expire() }
        timer.resume()
    }

    func track(_ process: Process?) {
        lock.lock()
        capture = process
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        active = false
        lock.unlock()
        timer.cancel()
    }

    private func expire() {
        lock.lock()
        guard active else { lock.unlock(); return }
        active = false
        let child = capture
        lock.unlock()
        // Kill the in-flight transport before exiting; do not wait for a hung child or OCR to cooperate.
        if let child, child.isRunning { kill(child.processIdentifier, SIGKILL) }
        let message = "\(phase) infrastructure ceiling exceeded: 90 s, elapsed=\(ProcessInfo.processInfo.systemUptime - startedAt) s; render latency unmeasured\n"
        fputs("ios-smoke: \(message)", stderr)
        fflush(stderr)
        do {
            try message.write(to: directory.appendingPathComponent("\(phase)-infrastructure-error.txt"), atomically: true, encoding: .utf8)
        } catch {
            fputs("ios-smoke: could not retain infrastructure error: \(error)\n", stderr)
        }
        exit(1)
    }
}

// Both preparation and proof use this exact native capture path. A warm-up frame is never ready evidence.
func captureScreenshot(udid: String, path: URL, label: String, watchdog: InfrastructureWatchdog)
    throws -> (startedAt: TimeInterval, completedAt: TimeInterval)? {
    let capture = Process()
    capture.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    capture.arguments = ["simctl", "io", udid, "screenshot", path.path]
    watchdog.track(capture)
    defer { watchdog.track(nil) }
    let started = ProcessInfo.processInfo.systemUptime
    // Admission is checked again immediately before invoking the opaque transport, not just at loop entry.
    if started >= watchdog.deadline { return nil }
    do {
        try capture.run()
    } catch {
        throw Failure(description: "\(label) screenshot transport could not start at uptime=\(ProcessInfo.processInfo.systemUptime): \(error)")
    }
    print("\(label) screenshot started at uptime=\(started): \(path.path)")
    fflush(stdout)
    capture.waitUntilExit()
    let completed = ProcessInfo.processInfo.systemUptime
    print("\(label) screenshot completed at uptime=\(completed), transport=\(completed - started) s, status=\(capture.terminationStatus)")
    fflush(stdout)
    guard capture.terminationStatus == 0 else {
        throw Failure(description: "\(label) screenshot failed with status \(capture.terminationStatus) at uptime=\(completed)")
    }
    return (started, completed)
}

func warmUp(udid: String, directory: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let watchdog = InfrastructureWatchdog(phase: "warm-up", directory: directory)
    defer { watchdog.cancel() }
    let frame = directory.appendingPathComponent("capture-warm-up.png")
    let record = directory.appendingPathComponent("capture-warm-up.txt")
    guard let capture = try captureScreenshot(udid: udid, path: frame, label: "warm-up", watchdog: watchdog) else {
        throw Failure(description: "warm-up capture was not admitted")
    }
    let ocrStarted = ProcessInfo.processInfo.systemUptime
    try "warm-up capture-start=\(capture.startedAt), capture-end=\(capture.completedAt), OCR-start=\(ocrStarted), OCR pending; not app proof\n"
        .write(to: record, atomically: true, encoding: .utf8)
    // Exercise the actual Simulator image dimensions too; synthetic Vision tests alone did not warm transport.
    let text = try autoreleasepool { try recognizeFile(frame) }
    let evidence = "warm-up capture-start=\(capture.startedAt), capture-end=\(capture.completedAt), OCR-start=\(ocrStarted), OCR-end=\(ProcessInfo.processInfo.systemUptime); not app readiness proof\nOCR:\n\(text)\n"
    try evidence.write(to: record, atomically: true, encoding: .utf8)
    print(evidence)
}

func waitForReady(udid: String, directory: URL, phase: String) throws {
    guard required[phase] != nil else { throw Failure(description: "Unknown phase: \(phase)") }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let watchdog = InfrastructureWatchdog(phase: phase, directory: directory)
    defer { watchdog.cancel() }
    let ready = directory.appendingPathComponent("\(phase)-ready.png")
    // Poll actual frames until content is proved or this one 90 s infrastructure ceiling expires.
    // A slow blank first observation must not prevent a later fresh observation within the same ceiling.
    let startedAt = watchdog.startedAt
    let deadline = watchdog.deadline
    print("\(phase) infrastructure deadline at uptime=\(deadline) (90 s whole phase); render latency unmeasured")
    var lastText = ""
    var attempt = 0
    while ProcessInfo.processInfo.systemUptime < deadline {
        attempt += 1
        let latest = directory.appendingPathComponent("\(phase)-\(attempt).png")
        let record = directory.appendingPathComponent("\(phase)-\(attempt).txt")
        do {
            try "\(phase) attempt=\(attempt), admission pending at uptime=\(ProcessInfo.processInfo.systemUptime)\n"
                .write(to: record, atomically: true, encoding: .utf8)
            guard let capture = try captureScreenshot(udid: udid, path: latest, label: phase,
                watchdog: watchdog) else {
                try "\(phase) attempt=\(attempt) not admitted: infrastructure deadline passed at uptime=\(ProcessInfo.processInfo.systemUptime)\n"
                    .write(to: record, atomically: true, encoding: .utf8)
                break
            }
            let ocrStarted = ProcessInfo.processInfo.systemUptime
            try "\(phase) attempt=\(attempt), capture-start=\(capture.startedAt), capture-end=\(capture.completedAt), OCR-start=\(ocrStarted), OCR pending\n"
                .write(to: record, atomically: true, encoding: .utf8)
            lastText = try autoreleasepool { try recognizeFile(latest) }
            let observedAt = ProcessInfo.processInfo.systemUptime
            let matches = isReady(lastText, for: phase)
            let evidence = "\(phase) attempt=\(attempt), capture-start=\(capture.startedAt), capture-end=\(capture.completedAt), OCR-start=\(ocrStarted), OCR-end=\(observedAt), matches=\(matches), infrastructure-deadline=\(deadline), elapsed=\(observedAt - startedAt) s, beyond-infrastructure-bound=\(max(0, observedAt - deadline)) s; render latency unmeasured\nOCR:\n\(lastText)\n"
            try evidence.write(to: record, atomically: true, encoding: .utf8)
            print(evidence)
            if acceptsObservation(lastText, for: phase, startedAt: capture.startedAt, finishedAt: observedAt, deadline: deadline) {
                try FileManager.default.copyItem(at: latest, to: ready)
                print("\(phase) rendered boot content ready: \(ready.path); 90 s infrastructure bound, not a UI render-latency SLA")
                return
            }
        } catch let observationError {
            let failure = "\(phase) attempt=\(attempt) failed at uptime=\(ProcessInfo.processInfo.systemUptime): \(observationError)\n"
            do {
                try failure.write(to: directory.appendingPathComponent("\(phase)-\(attempt)-error.txt"), atomically: true, encoding: .utf8)
            } catch {
                fputs("ios-smoke: could not retain observation error: \(error)\n", stderr)
            }
            throw observationError
        }
    }
    throw Failure(description: "\(phase) no completed observation proved \(required[phase]!) before the 90 s infrastructure deadline (uptime=\(deadline), now=\(ProcessInfo.processInfo.systemUptime)); render latency unmeasured. Last OCR:\n\(lastText)")
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
