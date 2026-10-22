// One session's conversation against a stubbed gateway (its open, connect and prompt routes) and scripted sockets:
// tickets per connect, the Origin header, the snapshot replacing the transcript, streamed events, reconnects, 429 and
// close code 4404.
import Foundation
import Synchronization
import Testing
@testable import HUI

@MainActor
struct ConversationModelTests {
    @Test func opensThenStreamsEventsThroughTheCore() async throws {
        let sockets = Sockets([[snapshot([user("u1", "Hi")], status: "running"), event(#"{"type":"text","delta":"Hel"}"#), event(#"{"type":"text","delta":"lo"}"#)]])
        let (model, host) = try start(sockets)
        try await until { model.rows.last?.messages?.first?.text == "Hello" }
        #expect(model.phase == .open)
        #expect(model.statusLabel == "Running")
        #expect(model.working == "Writing response…")
        #expect(sockets.connected.first == Connected(url: "ws://\(host):4100/__hui/sessions/a/stream?ticket=t", origin: "http://\(host):4100"))
        #expect(GatewayStub.paths(host).prefix(2) == ["/__hui/sessions/a/open", "/__hui/sessions/a/connect"])
    }

    @Test func aDropReconnectsWithANewTicketAndTheSnapshotReplacesTheTranscript() async throws {
        let sockets = Sockets([[snapshot([user("u1", "Hi")]), event(#"{"type":"tool_start","id":"t","name":"read"}"#)], [snapshot([user("u1", "Hi"), assistant("a1", "Done")])]])
        let (model, host) = try start(sockets)
        try await until { model.rows.map(\.kind) == [.messages, .messages] && model.rows.last?.messages?.first?.text == "Done" }
        #expect(sockets.connected.count == 2)
        #expect(GatewayStub.paths(host).filter { $0.hasSuffix("/connect") }.count >= 2)
    }

    @Test func closeCode4404EndsTheStream() async throws {
        let sockets = Sockets([[snapshot([])]], closeCode: ConversationModel.sessionGone)
        let (model, _) = try start(sockets)
        try await until { model.connectionNote == "This session no longer exists." }
        #expect(sockets.connected.count == 1)
    }

    @Test func aTicketRefusedWith429IsRetried() async throws {
        let sockets = Sockets([[snapshot([user("u1", "Hi")])]])
        let (model, _) = try start(sockets, connect: [(429, Data(#"{"error":"later"}"#.utf8)), ticket])
        try await until { model.rows.count == 1 }
        #expect(sockets.connected.count >= 1)
    }

    @Test func aFailedOpenShowsItsMessage() async throws {
        let (model, _) = try start(Sockets([]), open: [(503, Data(#"{"error":"The runtime is not ready yet."}"#.utf8))])
        try await until { model.phase == .failed("The runtime is not ready yet.") }
    }

    @Test func aFailedSendKeepsItsRequestIdForTheResend() async throws {
        let core = try HUICore.bundled()
        let first = try await core.takeRequestId("a", text: "Hi")
        try await core.sendFailed("a", requestId: first, text: "Hi")
        #expect(try await core.takeRequestId("a", text: "Hi") == first)
        #expect(try await core.takeRequestId("a", text: "Hi") != first)
    }

    private var ticket: (status: Int, body: Data) { (200, Data(#"{"url":"/__hui/sessions/a/stream?ticket=t"}"#.utf8)) }

    private func start(_ sockets: Sockets, open: [(status: Int, body: Data)]? = nil, connect: [(status: Int, body: Data)]? = nil) throws -> (ConversationModel, String) {
        let host = "\(UUID().uuidString.lowercased()).stub.test"
        let session = try JSONDecoder().decode(API.SessionList.self, from: fixture("sessions.json")).groups[0].sessions[0]
        let opened = #"{"session":\#(String(decoding: try JSONEncoder().encode(session), as: UTF8.self)),"transcript":[],"snapshot":\#(snapshotData([]))}"#
        GatewayStub.serve(host, routes: [
            "/__hui/sessions/a/open": open ?? [(200, Data(opened.utf8))],
            "/__hui/sessions/a/connect": connect ?? [ticket],
        ])
        let model = ConversationModel(id: "a", client: GatewayClient(baseURL: URL(string: "http://\(host):4100")!), core: try HUICore.bundled(), connector: sockets.connect)
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
    private let closeCode: Int

    init(_ scripts: [[String]], closeCode: Int = 1006) {
        self.scripts = Mutex(scripts)
        self.closeCode = closeCode
    }

    var connected: [Connected] { record.withLock { $0 } }

    func connect(_ url: URL, _ origin: String) -> any SessionSocket {
        record.withLock { $0.append(Connected(url: url.absoluteString, origin: origin)) }
        let frames = scripts.withLock { $0.isEmpty ? [] : $0.removeFirst() }
        return ScriptedSocket(frames: frames, closeCode: closeCode)
    }
}

private final class ScriptedSocket: SessionSocket {
    private let frames: Mutex<[String]>
    let closeCode: Int

    init(frames: [String], closeCode: Int) {
        self.frames = Mutex(frames)
        self.closeCode = closeCode
    }

    func receive() async throws -> String {
        guard let frame = frames.withLock({ $0.isEmpty ? nil : $0.removeFirst() }) else { throw URLError(.networkConnectionLost) }
        return frame
    }

    func close() {}
}
