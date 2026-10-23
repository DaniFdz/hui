// One open session's conversation, as the web's conversation controller owns it: `POST /__hui/sessions/:id/open`
// paints it, then the session stream keeps it live. Every connect mints a new one-use ticket, the snapshot replaces
// the transcript, a drop reconnects with the core's backoff, and a refusal or close code 4404 stops for good. The core
// reduces the transcript and projects its rows, held under a handle this model mints, so a reopened session's next
// model never shares it; a generation number keeps a late answer from reaching the core or overwriting a newer one, and
// stopping cancels the socket's receive. Sending reuses a failed send's request id through the core's `SendRequests`.
// A failed send stays in the transcript marked failed, added again if a snapshot replaced it meanwhile, and hands its
// text back for the draft; a resend the gateway answers as a duplicate drops both local copies, as the web's composer
// does. While a run streams a send can steer it or queue a follow-up instead, which adds no transcript row; the queue
// comes from the snapshot and `queue_update` events as the core's rows, and its changes go to `POST …/queue`.
// The header's origin reads "<runtime> · <GROUP>" as the web's does. The snapshot names the running model, and once the
// runtime is ready the model list loads, once per model, as the web's conversation controller loads it; choosing one
// goes to `POST …/model`. An SDK-worker session can continue without a prompt (`POST …/resume`).
import Foundation
import Observation

@MainActor
@Observable
final class ConversationModel {
    enum Phase: Equatable {
        case loading
        case failed(String)
        case open
    }

    typealias Connector = @Sendable (URL, String) -> any SessionSocket

    static let sessionGone = 4404

    let id: String
    private let handle = UUID().uuidString
    private(set) var phase = Phase.loading
    private(set) var session: API.SessionView?
    private(set) var statusLabel = ""
    private(set) var rows: [ChatRow] = []
    private(set) var queue: [QueueRow] = []
    private(set) var working = ""
    private(set) var streaming = false
    private(set) var stopping = false
    private(set) var connectionNote = ""
    private(set) var reconnecting = false
    private(set) var stopped = false
    private(set) var sendError: String?
    private(set) var origin = ""
    private(set) var currentModel: API.RuntimeModel?
    private(set) var models: [API.RuntimeModel] = []
    private(set) var continuing = false
    private(set) var runError: RunErrorNotice?
    private var dismissedRunError: String?
    private var modelsRequested = false

    private let client: GatewayClient
    private let core: HUICore
    private let connector: Connector
    private var generation = 0
    private var task: Task<Void, Never>?

    init(id: String, client: GatewayClient, core: HUICore, connector: @escaping Connector = WebSocketSession.connect) {
        self.id = id
        self.client = client
        self.core = core
        self.connector = connector
    }

    func start() {
        task?.cancel()
        generation += 1
        let current = generation
        phase = .loading
        reconnecting = false
        stopped = false
        connectionNote = ""
        task = Task { await run(current) }
    }

    func stop() {
        task?.cancel()
        generation += 1
        let handle = handle
        Task { [core] in await core.closeTranscript(handle) }
    }

    enum SendMode: String {
        case prompt
        case steer
        case followUp = "follow-up"
    }

    /// Sends `text` as a prompt, a steer or a follow-up; false when it wasn't sent, so the composer gets the text back.
    func send(_ text: String, mode: SendMode = .prompt) async -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return true }
        let current = generation
        let pending = "user-\(UUID().uuidString)"
        let prompt = mode == .prompt
        sendError = nil
        do {
            guard current == generation else { return false }
            if prompt { show(try await core.transcript(handle, pending: pending, text: text)) }
            let request = try await core.takeRequestId(id, text: text)
            do {
                let answer: API.SessionPromptResponse = try await client.post(path(mode.rawValue), body: PromptRequest(text: text, requestId: request.requestId))
                guard current == generation else { return true }
                if answer.duplicate == true {
                    show(try await core.transcript(handle, duplicate: pending, earlierRow: request.earlierRow))
                } else if prompt {
                    show(try await core.transcript(handle, accepted: pending))
                }
                return true
            } catch {
                try await core.sendFailed(id, requestId: request.requestId, text: text, row: prompt ? pending : nil)
                sendError = error.localizedDescription
                guard current == generation, prompt else { return false }
                show(try await core.transcript(handle, failed: pending, text: text))
                return false
            }
        } catch {
            sendError = error.localizedDescription
            return false
        }
    }

    /// Edits, removes, moves or steers a queued follow-up; true when the gateway took the change.
    func changeQueue(_ change: API.SessionQueueRequest) async -> Bool {
        do {
            let _: API.JSONValue = try await client.post(path("queue"), body: change)
            return true
        } catch {
            sendError = error.localizedDescription
            return false
        }
    }

    func abort() async {
        guard !stopping else { return }
        stopping = true
        do {
            let _: API.JSONValue = try await client.post(path("abort"))
        } catch {
            stopping = false
            sendError = error.localizedDescription
        }
    }

    func selectModel(_ choice: API.RuntimeModel) async {
        do {
            let answer: API.SessionModelResponse = try await client.post(path("model"), body: API.SessionModelRequest(provider: choice.provider, modelId: choice.id))
            if let model = answer.model { currentModel = model }
        } catch {
            sendError = error.localizedDescription
        }
    }

    func resume() async {
        guard phase == .open, !continuing, !streaming else { return }
        continuing = true
        sendError = nil
        do {
            let _: API.JSONValue = try await client.post(path("resume"))
        } catch {
            sendError = error.localizedDescription
        }
        continuing = false
    }

    var shownRunError: RunErrorNotice? {
        guard !streaming, let runError, runError.key != dismissedRunError else { return nil }
        return runError
    }

    func dismissRunError() {
        dismissedRunError = runError?.key
    }

    func continueAfterError() async {
        guard let prompt = try? await core.continueAfterErrorPrompt() else { return }
        _ = await send(prompt)
    }

    private func run(_ current: Int) async {
        do {
            let opened: API.SessionOpenResponse = try await client.post(path("open"))
            guard current == generation else { return }
            session = opened.session
            try await apply(opened.snapshot, current)
            guard current == generation else { return }
            phase = .open
        } catch {
            if current == generation { phase = .failed(error.localizedDescription) }
            return
        }
        var attempt = 0
        while !Task.isCancelled, current == generation {
            switch await connect(current, onLive: { attempt = 0 }) {
            case .ended(let note):
                connectionNote = note
                streaming = false
                reconnecting = false
                stopped = true
                return
            case .dropped:
                attempt += 1
                reconnecting = true
                guard let delay = try? await core.reconnectDelay(attempt: attempt) else { return }
                try? await Task.sleep(for: delay)
            }
        }
    }

    private enum Outcome {
        case ended(String)
        case dropped
    }

    private func connect(_ current: Int, onLive: () -> Void) async -> Outcome {
        let socket: any SessionSocket
        do {
            let ticket: API.SessionConnectResponse = try await client.post(path("connect"))
            guard current == generation, let address = Self.socketURL(ticket.url, gateway: client.baseURL) else { return .dropped }
            socket = connector(address, client.origin)
        } catch let error as GatewayError {
            guard let status = error.status, status != 429, status < 500 else { return .dropped }
            return .ended("The event stream returned HTTP \(status).")
        } catch {
            return .dropped
        }
        defer { socket.close() }
        var live = false
        while current == generation, !Task.isCancelled {
            let text: String
            do {
                text = try await withTaskCancellationHandler { try await socket.receive() } onCancel: { socket.close() }
            } catch {
                return socket.closeCode == Self.sessionGone ? .ended("This session no longer exists.") : .dropped
            }
            if !live {
                live = true
                onLive()
                reconnecting = false
            }
            guard current == generation, !Task.isCancelled else { return .dropped }
            do {
                let frame = try JSONDecoder().decode(API.SessionStreamFrame.self, from: Data(text.utf8))
                if case .closed = frame { return .ended("The runtime exited — this session is no longer streaming.") }
                try await apply(frame, current)
            } catch {
                return .dropped
            }
        }
        return .dropped
    }

    static func socketURL(_ relative: String, gateway: URL) -> URL? {
        guard let url = URL(string: relative, relativeTo: gateway),
              var components = URLComponents(url: url.absoluteURL, resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        return components.url
    }

    private func apply(_ frame: API.SessionStreamFrame, _ current: Int) async throws {
        switch frame {
        case .snapshot(let snapshot):
            try await apply(snapshot.data, current)
        case .transcript(let transcript):
            guard current == generation else { return }
            let projection = try await core.transcript(handle, snapshot: transcript.data, streaming: false)
            if current == generation { show(projection) }
        case .event(let event):
            guard current == generation else { return }
            if case .turnStart = event.data {
                streaming = true
                stopping = false
            }
            if case .queueUpdate(let update) = event.data {
                try await setQueue(update.queue, current)
                return
            }
            let projection = try await core.transcript(handle, event: event.data)
            if current == generation { show(projection) }
        case .status(let status):
            await setStatus(status.data.status, current)
        default:
            return
        }
    }

    private func apply(_ snapshot: API.SessionSnapshot, _ current: Int) async throws {
        guard current == generation else { return }
        let projection = try await core.transcript(handle, snapshot: snapshot.transcript, streaming: Self.streaming(snapshot.status))
        guard current == generation else { return }
        show(projection)
        if let model = snapshot.model { currentModel = model }
        try await setQueue(snapshot.queue, current)
        await setStatus(snapshot.status, current)
    }

    private func setQueue(_ runtime: API.RuntimeQueue, _ current: Int) async throws {
        let rows = try await core.queueRows(runtime)
        if current == generation { queue = rows }
    }

    private func setStatus(_ status: API.SessionStatus, _ current: Int) async {
        guard var session else { return }
        session.status = status
        guard let label = try? await core.sessionStatusLabel(session), let group = try? await core.sessionGroupLabel(session.group),
              current == generation else { return }
        self.session = session
        statusLabel = label
        origin = "\(session.parentId == nil ? session.tool : "Subagent")\(session.worker.map { " on \($0.name)" } ?? "") · \(group)"
        if [.idle, .running, .waiting].contains(status), !modelsRequested {
            modelsRequested = true
            Task { await loadModels() }
        }
        streaming = Self.streaming(status)
        if !streaming { stopping = false }
    }

    private func loadModels() async {
        guard let answer: API.SessionModelsResponse = try? await client.get(path("models")) else {
            modelsRequested = false
            return
        }
        models = answer.models
    }

    private func show(_ projection: ChatProjection) {
        rows = projection.rows
        working = projection.working
        runError = projection.runError
    }

    private func path(_ action: String) -> String {
        "/__hui/sessions/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)/\(action)"
    }

    private static func streaming(_ status: API.SessionStatus) -> Bool {
        status == .running || status == .waiting
    }

    private struct PromptRequest: Encodable {
        var text: String
        var requestId: String
    }
}
