// One session's conversation against a stubbed gateway (its open, connect and prompt routes) and scripted sockets:
// tickets per connect, the Origin header, the snapshot replacing the transcript, streamed events, reconnects, 429,
// close code 4404, a stopped model closing its socket without touching the core again, a failed send and its
// resend, and the queue: its rows from the core, a steer that adds no transcript row, and a refused queue change.
import Foundation
import Synchronization
import Testing
@testable import HUI

@MainActor
struct ConversationModelTests {
    @Test func opensThenStreamsEventsThroughTheCore() async throws {
        let sockets = Sockets([[snapshot([user("u1", "Hi")], status: "running"), event(#"{"type":"text","delta":"Hel"}"#), event(#"{"type":"text","delta":"lo"}"#)]])
        let (model, host) = try start(sockets)
        defer { model.stop() }
        try await until { model.rows.last?.messages?.first?.text == "Hello" }
        #expect(model.phase == .open)
        #expect(model.statusLabel == "Running")
        #expect(model.working == "Writing response…")
        #expect(sockets.connected.first == Connected(url: "ws://\(host):4100/__hui/sessions/a/stream?ticket=t", origin: "http://\(host):4100"))
        #expect(GatewayStub.paths(host).filter { !$0.hasSuffix("/models") }.prefix(2) == ["/__hui/sessions/a/open", "/__hui/sessions/a/connect"])
        try await until { GatewayStub.paths(host).contains("/__hui/sessions/a/models") }
    }

    @Test func aDropReconnectsWithANewTicketAndTheSnapshotReplacesTheTranscript() async throws {
        let sockets = Sockets([[snapshot([user("u1", "Hi")]), event(#"{"type":"tool_start","id":"t","name":"read"}"#)], [snapshot([user("u1", "Hi"), assistant("a1", "Done")])]])
        let (model, host) = try start(sockets)
        defer { model.stop() }
        try await until { model.rows.map(\.kind) == [.messages, .messages] && model.rows.last?.messages?.first?.text == "Done" }
        #expect(sockets.connected.count == 2)
        #expect(GatewayStub.paths(host).filter { $0.hasSuffix("/connect") }.count >= 2)
    }

    @Test func closeCode4404EndsTheStream() async throws {
        let sockets = Sockets([[snapshot([])]], closeCode: ConversationModel.sessionGone)
        let (model, _) = try start(sockets)
        defer { model.stop() }
        try await until { model.connectionNote == "This session no longer exists." }
        #expect(sockets.connected.count == 1)
    }

    @Test func aTicketRefusedWith429IsRetried() async throws {
        let sockets = Sockets([[snapshot([user("u1", "Hi")])]])
        let (model, _) = try start(sockets, connect: [(429, Data(#"{"error":"later"}"#.utf8)), ticket])
        defer { model.stop() }
        try await until { model.rows.count == 1 }
        #expect(sockets.connected.count >= 1)
    }

    @Test func aFailedOpenShowsItsMessage() async throws {
        let (model, _) = try start(Sockets([]), open: [(503, Data(#"{"error":"The runtime is not ready yet."}"#.utf8))])
        defer { model.stop() }
        try await until { model.phase == .failed("The runtime is not ready yet.") }
    }

    @Test func stoppingClosesTheSocketAndALaterFrameNeverArrives() async throws {
        let sockets = Sockets([[snapshot([user("u1", "Hi")])]], hold: true)
        let (model, _) = try start(sockets)
        try await until { model.rows.count == 1 && sockets.opened.first?.waiting == true }
        model.stop()
        let socket = try #require(sockets.opened.first)
        try await until { socket.closed }
        socket.deliver(event(#"{"type":"text","delta":"late"}"#))
        #expect(socket.queued == 1)
        #expect(model.rows.count == 1)
    }

    @Test func stoppingAModelLeavesTheNextModelOfThatSessionAlone() async throws {
        let core = try HUICore.bundled()
        let sockets = Sockets([[snapshot([user("u1", "Hi")])], [snapshot([user("u1", "Hi")])]], hold: true)
        let (first, _) = try start(sockets, core: core)
        try await until { first.rows.count == 1 && sockets.opened.count == 1 }
        let (second, _) = try start(sockets, core: core)
        defer { second.stop() }
        try await until { second.rows.count == 1 && sockets.opened.count == 2 && sockets.opened[1].waiting }
        first.stop()
        try await until { sockets.opened[0].closed }
        sockets.opened[1].deliver(event(#"{"type":"text","delta":"Hello"}"#))
        try await until { second.rows.count == 2 }
        #expect(second.rows.first?.messages?.first?.text == "Hi")
        #expect(second.rows.last?.messages?.first?.text == "Hello")
    }

    @Test func aFailedSendKeepsItsRequestIdForTheResend() async throws {
        let core = try HUICore.bundled()
        let first = try await core.takeRequestId("a", text: "Hi").requestId
        try await core.sendFailed("a", requestId: first, text: "Hi", row: "user-1")
        let resend = try await core.takeRequestId("a", text: "Hi")
        #expect(resend.requestId == first)
        #expect(resend.earlierRow == "user-1")
        #expect(try await core.takeRequestId("a", text: "Hi").requestId != first)
    }

    @Test func aSnapshotDuringAFailedSendStillShowsItFailed() async throws {
        let model = try await failSend(withSnapshot: [])
        defer { model.stop() }
        #expect(messages(model) == [Shown(text: "Hi", failed: true)])
    }

    @Test func aFailedSendThenADuplicateResendLeavesOneMessage() async throws {
        let model = try await failSend(withSnapshot: [user("g1", "Hi")], prompt: [(200, Data(#"{"ok":true,"duplicate":true}"#.utf8))])
        defer { model.stop() }
        #expect(messages(model) == [Shown(text: "Hi"), Shown(text: "Hi", failed: true)])
        #expect(await model.send("Hi"))
        #expect(messages(model) == [Shown(text: "Hi")])
    }

    @Test func aQueueUpdateShowsTheCoresRowsAndASteerAddsNoTranscriptRow() async throws {
        let queue = #"{"type":"queue_update","queue":{"steering":["Now"],"followUp":["Later"],"items":[{"id":"q1","text":"Later","mode":"followUp"}]}}"#
        let (model, host) = try start(Sockets([[snapshot([user("u1", "Hi")], status: "running"), event(queue)]], hold: true), routes: [
            "/__hui/sessions/a/steer": [(200, Data(#"{"ok":true}"#.utf8))],
        ])
        defer { model.stop() }
        try await until { model.queue.count == 2 }
        #expect(model.queue == [QueueRow(id: "", text: "Now", label: "Steer", editable: false), QueueRow(id: "q1", text: "Later", label: "Follow up", editable: true)])
        #expect(await model.send("Use tabs", mode: .steer))
        #expect(GatewayStub.paths(host).last == "/__hui/sessions/a/steer")
        #expect(messages(model) == [Shown(text: "Hi")])
    }

    @Test func aRefusedQueueChangeSaysWhy() async throws {
        let (model, _) = try start(Sockets([[snapshot([])]], hold: true), routes: [
            "/__hui/sessions/a/queue": [(409, Data(#"{"error":"That queued message is no longer available."}"#.utf8))],
        ])
        defer { model.stop() }
        try await until { model.phase == .open }
        #expect(await model.changeQueue(.remove(.init(itemId: "q1"))) == false)
        #expect(model.sendError == "That queued message is no longer available.")
    }

    private struct Shown: Equatable {
        var text: String
        var failed = false
    }

    private func messages(_ model: ConversationModel) -> [Shown] {
        model.rows.flatMap { $0.messages ?? [] }.map { Shown(text: $0.text ?? "", failed: $0.failed == true) }
    }

    private func failSend(withSnapshot entries: [String], prompt: [(status: Int, body: Data)] = []) async throws -> ConversationModel {
        let sockets = Sockets([[snapshot([])]], hold: true)
        let (model, host) = try start(sockets, prompt: [(503, Data(#"{"error":"The runtime is not ready yet."}"#.utf8))] + prompt)
        try await until { model.phase == .open && sockets.opened.first?.waiting == true }
        GatewayStub.hold(host, "/__hui/sessions/a/prompt")
        let sent = Task { await model.send("Hi") }
        try await until { GatewayStub.held(host) == 1 && model.rows.count == 1 }
        sockets.opened[0].deliver(snapshot(entries))
        try await until { messages(model).count == entries.count && model.rows.allSatisfy { $0.messages?.allSatisfy { $0.pending != true } ?? true } }
        GatewayStub.release(host)
        #expect(await sent.value == false)
        #expect(model.sendError == "The runtime is not ready yet.")
        return model
    }

    private var ticket: (status: Int, body: Data) { (200, Data(#"{"url":"/__hui/sessions/a/stream?ticket=t"}"#.utf8)) }

    private func start(_ sockets: Sockets, core: HUICore? = nil, open: [(status: Int, body: Data)]? = nil, connect: [(status: Int, body: Data)]? = nil, prompt: [(status: Int, body: Data)] = [], routes: [String: [(status: Int, body: Data)]] = [:]) throws -> (ConversationModel, String) {
        let host = "\(UUID().uuidString.lowercased()).stub.test"
        let session = try JSONDecoder().decode(API.SessionList.self, from: fixture("sessions.json")).groups[0].sessions[0]
        let opened = #"{"session":\#(String(decoding: try JSONEncoder().encode(session), as: UTF8.self)),"transcript":[],"snapshot":\#(snapshotData([]))}"#
        GatewayStub.serve(host, routes: [
            "/__hui/sessions/a/open": open ?? [(200, Data(opened.utf8))],
            "/__hui/sessions/a/connect": connect ?? [ticket],
            "/__hui/sessions/a/prompt": prompt,
        ].merging(routes) { $1 })
        let model = ConversationModel(id: "a", client: GatewayClient(baseURL: URL(string: "http://\(host):4100")!), core: try core ?? HUICore.bundled(), connector: sockets.connect)
        model.start()
        return (model, host)
    }

    private func user(_ id: String, _ text: String) -> String { #"{"kind":"message","entryId":"\#(id)","role":"user","text":"\#(text)"}"# }
    private func assistant(_ id: String, _ text: String) -> String { #"{"kind":"message","entryId":"\#(id)","role":"assistant","text":"\#(text)"}"# }
    private func snapshotData(_ entries: [String], status: String = "idle") -> String {
        #"{"transcript":[\#(entries.joined(separator: ","))],"status":"\#(status)","queue":{"steering":[],"followUp":[]},"questions":[],"subagents":[]}"#
    }
    private func snapshot(_ entries: [String], status: String = "idle") -> String { #"{"event":"snapshot","data":\#(snapshotData(entries, status: status))}"# }
    private func event(_ data: String) -> String { #"{"event":"event","data":\#(data)}"# }
}

struct Connected: Equatable {
    var url: String
    var origin: String
}

final class Sockets: Sendable {
    private let scripts: Mutex<[[String]]>
    private let record = Mutex<[Connected]>([])
    private let sockets = Mutex<[ScriptedSocket]>([])
    private let closeCode: Int
    private let hold: Bool

    init(_ scripts: [[String]], closeCode: Int = 1006, hold: Bool = false) {
        self.scripts = Mutex(scripts)
        self.closeCode = closeCode
        self.hold = hold
    }

    var connected: [Connected] { record.withLock { $0 } }
    var opened: [ScriptedSocket] { sockets.withLock { $0 } }

    func connect(_ url: URL, _ origin: String) -> any SessionSocket {
        record.withLock { $0.append(Connected(url: url.absoluteString, origin: origin)) }
        let frames = scripts.withLock { $0.isEmpty ? [] : $0.removeFirst() }
        let socket = ScriptedSocket(frames: frames, closeCode: closeCode, hold: hold)
        sockets.withLock { $0.append(socket) }
        return socket
    }
}

/// Plays its frames, then drops, or with `hold` waits for `deliver` or `close`.
final class ScriptedSocket: SessionSocket {
    private struct State {
        var frames: [String]
        var waiter: CheckedContinuation<String, any Error>?
        var closed = false
    }

    private let state: Mutex<State>
    private let hold: Bool
    let closeCode: Int

    init(frames: [String], closeCode: Int, hold: Bool) {
        state = Mutex(State(frames: frames))
        self.closeCode = closeCode
        self.hold = hold
    }

    var closed: Bool { state.withLock { $0.closed } }
    var waiting: Bool { state.withLock { $0.waiter != nil } }
    var queued: Int { state.withLock { $0.frames.count } }

    func receive() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            state.withLock { state in
                if !state.frames.isEmpty {
                    continuation.resume(returning: state.frames.removeFirst())
                } else if state.closed || !hold {
                    continuation.resume(throwing: URLError(.networkConnectionLost))
                } else {
                    state.waiter = continuation
                }
            }
        }
    }

    func deliver(_ frame: String) {
        state.withLock { state in
            if let waiter = state.waiter {
                state.waiter = nil
                waiter.resume(returning: frame)
            } else {
                state.frames.append(frame)
            }
        }
    }

    func close() {
        state.withLock { state in
            state.closed = true
            state.waiter?.resume(throwing: URLError(.cancelled))
            state.waiter = nil
        }
    }
}
