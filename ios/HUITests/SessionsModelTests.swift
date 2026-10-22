// The live session list against a stubbed gateway: the recorded sessions.json and a scripted events stream, served
// by a URLProtocol on a host of each test's own, which also serves other tests' scripted routes and can hold a request
// until a test releases it.
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
        try await until { model.loaded && model.session(notes)?.status == .idle }
        #expect(GatewayStub.paths(host) == ["/__hui/sessions/events", "/__hui/sessions"])
    }

    @Test func aStatusWinsOverAnUpsert() async throws {
        let (model, _) = try start([
            snapshot([notes: "running", login: "idle"]),
            try upsert(revision: listRevision + 1, notes, title: "Renamed", status: .idle),
        ])
        try await until { row(model, notes)?.title == "Renamed" }
        #expect(model.session(notes)?.status == .running)
        #expect(row(model, notes)?.glyph.busy == true)
    }

    @Test func aSessionMissingFromTheSnapshotIsIdle() async throws {
        let (model, _) = try start([snapshot([notes: "running"])])
        try await until { model.session(notes)?.status == .running }
        #expect(model.session(login)?.status == .idle)
    }

    @Test func aGroupsFrameRemovesSessions() async throws {
        let (model, _) = try start([
            snapshot([notes: "idle", login: "idle"]),
            #"event: sessions\#ndata: {"revision":\#(listRevision + 1),"groups":[{"label":"ungrouped","ids":["\#(notes)"]}],"upserts":[]}"#,
        ])
        try await until { model.groups.flatMap(\.rows).map(\.id) == [notes] }
        #expect(model.session(login) == nil)
    }

    @Test func anOlderRevisionIsIgnored() async throws {
        let (model, _) = try start([
            snapshot([notes: "idle", login: "idle"]),
            try upsert(revision: listRevision - 1, notes, title: "Stale", status: .idle),
            #"event: status\#ndata: {"id":"\#(login)","status":"running"}"#,
        ])
        try await until { model.session(login)?.status == .running }
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
}

final class GatewayStub: URLProtocol, @unchecked Sendable {
    private struct Host {
        var list = Data()
        var events = Data()
        var routes: [String: [(status: Int, body: Data)]] = [:]
        var paths: [String] = []
        var held: Set<String> = []
        var waiting: [GatewayStub] = []
    }

    private static let hosts = Mutex<[String: Host]>([:])
    private static let registered: Void = { URLProtocol.registerClass(GatewayStub.self) }()

    static func serve(_ host: String, list: Data, events: Data) {
        _ = registered
        hosts.withLock { $0[host] = Host(list: list, events: events) }
    }

    static func serve(_ host: String, routes: [String: [(status: Int, body: Data)]]) {
        _ = registered
        hosts.withLock { $0[host] = Host(routes: routes) }
    }

    static func paths(_ host: String) -> [String] {
        hosts.withLock { $0[host]?.paths ?? [] }
    }

    static func hold(_ host: String, _ path: String) {
        hosts.withLock { _ = $0[host]?.held.insert(path) }
    }

    static func held(_ host: String) -> Int {
        hosts.withLock { $0[host]?.waiting.count ?? 0 }
    }

    static func release(_ host: String) {
        let waiting = hosts.withLock { hosts in
            defer { hosts[host]?.waiting = [] }
            return hosts[host]?.waiting ?? []
        }
        for request in waiting { request.startLoading() }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        guard let host = request.url?.host() else { return false }
        return hosts.withLock { $0[host] != nil }
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let host = url.host() else { return }
        let path = url.path()
        let (served, route) = Self.hosts.withLock { hosts -> (Host?, (status: Int, body: Data)?) in
            if hosts[host]?.held.remove(path) != nil {
                hosts[host]?.waiting.append(self)
                return (nil, nil)
            }
            hosts[host]?.paths.append(path)
            let route = hosts[host]?.routes[path]?.first
            if (hosts[host]?.routes[path]?.count ?? 0) > 1 { hosts[host]?.routes[path]?.removeFirst() }
            return (hosts[host], route)
        }
        guard let served else { return }
        if let route {
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: route.status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: route.body)
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        let stream = url.path() == "/__hui/sessions/events"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["content-type": stream ? "text/event-stream" : "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stream ? served.events : served.list)
        if !stream { client?.urlProtocolDidFinishLoading(self) }
    }

    override func stopLoading() {}
}
