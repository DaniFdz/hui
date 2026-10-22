// One open session's conversation, as the web's conversation controller owns it: `POST /__hui/sessions/:id/open`
// paints it, then the session stream keeps it live. Every connect mints a new one-use ticket, the snapshot replaces
// the transcript, a drop reconnects with the core's backoff, and a refusal or close code 4404 stops for good. The core
// reduces the transcript and projects its rows, held under a handle this model mints, so a reopened session's next
// model never shares it; a generation number keeps a late answer from reaching the core or overwriting a newer one, and
// stopping cancels the socket's receive. Sending reuses a failed send's request id through the core's `SendRequests`.
// A failed send stays in the transcript marked failed, and hands its text back for the draft, as the web's composer
// does.
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
    private(set) var working = ""
    private(set) var streaming = false
    private(set) var stopping = false
    private(set) var connectionNote = ""
    private(set) var sendError: String?

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
        task = Task { await run(current) }
    }

    func stop() {
        task?.cancel()
        generation += 1
        let handle = handle
        Task { [core] in await core.closeTranscript(handle) }
    }

    /// Sends `text` as a prompt; false when it wasn't sent, so the composer gets the text back.
    func send(_ text: String) async -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return true }
        let current = generation
        let pending = "user-\(UUID().uuidString)"
        sendError = nil
        do {
            guard current == generation else { return false }
            show(try await core.transcript(handle, pending: pending, text: text))
            let requestId = try await core.takeRequestId(id, text: text)
            do {
                let _: API.SessionPromptResponse = try await client.post(path("prompt"), body: PromptRequest(text: text, requestId: requestId))
                guard current == generation else { return true }
                show(try await core.transcript(handle, settle: pending, accepted: true))
                return true
            } catch {
                try await core.sendFailed(id, requestId: requestId, text: text)
                sendError = error.localizedDescription
                guard current == generation else { return false }
                show(try await core.transcript(handle, settle: pending, accepted: false))
                return false
            }
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
                return
            case .dropped:
                attempt += 1
                connectionNote = "Reconnecting…"
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
                connectionNote = ""
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
        await setStatus(snapshot.status, current)
    }

    private func setStatus(_ status: API.SessionStatus, _ current: Int) async {
        guard var session else { return }
        session.status = status
        guard let label = try? await core.sessionStatusLabel(session), current == generation else { return }
        self.session = session
        statusLabel = label
        streaming = Self.streaming(status)
        if !streaming { stopping = false }
    }

    private func show(_ projection: ChatProjection) {
        rows = projection.rows
        working = projection.working
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
