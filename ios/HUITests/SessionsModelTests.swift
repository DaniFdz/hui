// The live session list against a stubbed gateway: the recorded sessions.json and a scripted events stream, served
// by a URLProtocol on a host of each test's own.
import Foundation
import Synchronization
import Testing
@testable import HUI

private let notes = "8f0b7f00-fa30-404a-a9f0-bb0217d3a990"
private let login = "489e1c3d-b1f6-453a-809d-915f402a5eba"
private let listRevision = 1792610058661

@MainActor
struct SessionsModelTests {
    @Test func opensTheStreamBeforeLoadingTheList() async throws {
        let (model, host) = try start([snapshot([notes: "idle", login: "idle"])])
        try await until { model.loaded && model.statusLabels[notes] == "Idle" }
        #expect(GatewayStub.paths(host) == ["/__hui/sessions/events", "/__hui/sessions"])
    }

    @Test func aStatusWinsOverAnUpsert() async throws {
        let (model, _) = try start([
            snapshot([notes: "running", login: "idle"]),
            try upsert(revision: listRevision + 1, notes, title: "Renamed", status: .idle),
        ])
        try await until { row(model, notes)?.title == "Renamed" }
        #expect(row(model, notes)?.statusText == "Running")
    }

    @Test func aSessionMissingFromTheSnapshotIsIdle() async throws {
        let (model, _) = try start([snapshot([notes: "running"])])
        try await until { row(model, notes)?.statusText == "Running" }
        #expect(row(model, login)?.statusText == "Idle")
    }

    @Test func aGroupsFrameRemovesSessions() async throws {
        let (model, _) = try start([
            snapshot([notes: "idle", login: "idle"]),
            #"event: sessions\#ndata: {"revision":\#(listRevision + 1),"groups":[{"label":"ungrouped","ids":["\#(notes)"]}],"upserts":[]}"#,
        ])
        try await until { model.groups.flatMap(\.rows).map(\.id) == [notes] }
        #expect(model.session(login) == nil)
        #expect(model.statusLabels[login] == nil)
    }

    @Test func anOlderRevisionIsIgnored() async throws {
        let (model, _) = try start([
            snapshot([notes: "idle", login: "idle"]),
            try upsert(revision: listRevision - 1, notes, title: "Stale", status: .idle),
            #"event: status\#ndata: {"id":"\#(login)","status":"running"}"#,
        ])
        try await until { row(model, login)?.statusText == "Running" }
        #expect(row(model, notes)?.title == "Write release notes")
    }

    private func start(_ frames: [String]) throws -> (SessionsModel, String) {
        let host = "\(UUID().uuidString.lowercased()).stub.test"
        GatewayStub.serve(host, list: try fixture("sessions.json"), events: Data(frames.map { $0 + "\n\n" }.joined().utf8))
        let model = SessionsModel(core: try HUICore.bundled())
        model.start(GatewayClient(baseURL: URL(string: "http://\(host)")!))
        return (model, host)
    }

    private func row(_ model: SessionsModel, _ id: String) -> SessionsModel.Row? {
        model.groups.flatMap(\.rows).first { $0.id == id }
    }

    private func snapshot(_ statuses: [String: String]) -> String {
        let entries = statuses.map { #"{"id":"\#($0.key)","status":"\#($0.value)"}"# }.joined(separator: ",")
        return #"event: snapshot\#ndata: {"statuses":[\#(entries)]}"#
    }

    private func upsert(revision: Int, _ id: String, title: String, status: API.SessionStatus) throws -> String {
        let list = try JSONDecoder().decode(API.SessionList.self, from: fixture("sessions.json"))
        var session = try #require(list.groups.flatMap(\.sessions).first { $0.id == id })
        session.title = title
        session.status = status
        let json = String(decoding: try JSONEncoder().encode(session), as: UTF8.self)
        return #"event: sessions\#ndata: {"revision":\#(revision),"upserts":[\#(json)]}"#
    }

    private func until(_ condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(10)
        while !condition() {
            guard ContinuousClock.now < deadline else {
                Issue.record("the session list never reached the expected state")
                return
            }
            try await Task.sleep(for: .milliseconds(10))
        }
    }
}

final class GatewayStub: URLProtocol {
    private struct Host {
        var list: Data
        var events: Data
        var paths: [String] = []
    }

    private static let hosts = Mutex<[String: Host]>([:])
    private static let registered: Void = { URLProtocol.registerClass(GatewayStub.self) }()

    static func serve(_ host: String, list: Data, events: Data) {
        _ = registered
        hosts.withLock { $0[host] = Host(list: list, events: events) }
    }

    static func paths(_ host: String) -> [String] {
        hosts.withLock { $0[host]?.paths ?? [] }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        guard let host = request.url?.host() else { return false }
        return hosts.withLock { $0[host] != nil }
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let host = url.host() else { return }
        let served = Self.hosts.withLock { hosts -> Host? in
            hosts[host]?.paths.append(url.path())
            return hosts[host]
        }
        guard let served else { return }
        let stream = url.path() == "/__hui/sessions/events"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["content-type": stream ? "text/event-stream" : "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stream ? served.events : served.list)
        if !stream { client?.urlProtocolDidFinishLoading(self) }
    }

    override func stopLoading() {}
}
