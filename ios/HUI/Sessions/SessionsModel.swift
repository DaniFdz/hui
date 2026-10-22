// The live session list, as the web's sessions controller owns it: opens GET /__hui/sessions/events, loads
// GET /__hui/sessions, then reads the stream for statuses and list changes, reconnecting with the core's backoff. The
// stream's statuses win over every list and upsert once its snapshot arrived. Rows are projected by the core with the
// web sidebar's grouping, subagent folding, labels and accessible names.
import Foundation
import Observation

@MainActor
@Observable
final class SessionsModel {
    struct Row: Identifiable, Equatable {
        var id: String
        var title: String
        var accessibleName: String
        var statusText: String
    }

    struct Group: Identifiable, Equatable {
        var id: String
        var label: String
        var rows: [Row]
    }

    private(set) var groups: [Group] = []
    private(set) var statusLabels: [String: String] = [:]
    private(set) var loaded = false
    private(set) var error: String?

    private let core: HUICore
    private var revision = -Double.infinity
    private var layout: [API.SessionListLayoutGroup] = []
    private var sessions: [String: API.SessionView] = [:]
    private var statuses: [String: API.SessionStatus]?
    private var projection = 0
    private var stream: Task<Void, Never>?

    init(core: HUICore) {
        self.core = core
    }

    func session(_ id: String) -> API.SessionView? {
        sessions[id]
    }

    func start(_ client: GatewayClient) {
        stream?.cancel()
        revision = -.infinity
        statuses = nil
        stream = Task { await run(client) }
    }

    private func run(_ client: GatewayClient) async {
        var attempt = 0
        while !Task.isCancelled {
            do {
                let bytes = try await client.stream("/__hui/sessions/events")
                apply(try await client.get("/__hui/sessions", as: API.SessionList.self))
                await project()
                error = nil
                attempt = 0
                do {
                    try await read(bytes)
                } catch {
                    throw GatewayClient.described(error, timeout: GatewayClient.streamStallTimeout)
                }
            } catch {
                self.error = error.localizedDescription
            }
            attempt += 1
            guard let delay = try? await core.reconnectDelay(attempt: attempt) else { return }
            try? await Task.sleep(for: delay)
        }
    }

    private nonisolated func read(_ bytes: URLSession.AsyncBytes) async throws {
        var framer = SSEFramer()
        for try await byte in bytes {
            guard let chunk = framer.push(byte), let frame = try await core.decodeFrame(chunk, as: API.SessionStatusStreamFrame.self) else { continue }
            await apply(frame)
        }
    }

    private func apply(_ list: API.SessionList) {
        guard list.revision >= revision else { return }
        revision = list.revision
        layout = list.groups.map { group in
            API.SessionListLayoutGroup(label: group.label, cwd: group.cwd, workspaceMode: group.workspaceMode.map { .init(rawValue: $0.rawValue) }, baseRef: group.baseRef, ids: group.sessions.map(\.id))
        }
        sessions = Dictionary(list.groups.flatMap(\.sessions).map { ($0.id, withStreamStatus($0)) }, uniquingKeysWith: { $1 })
    }

    private func apply(_ frame: API.SessionStatusStreamFrame) async {
        switch frame {
        case .snapshot(let snapshot):
            statuses = Dictionary(snapshot.data.statuses.map { ($0.id, $0.status) }, uniquingKeysWith: { $1 })
            for update in snapshot.data.statuses { apply(update) }
            sessions = sessions.mapValues(withStreamStatus)
        case .status(let status):
            statuses?[status.data.id] = status.data.status
            apply(status.data)
        case .sessions(let list):
            guard list.data.revision > revision else { return }
            revision = list.data.revision
            for session in list.data.upserts { sessions[session.id] = withStreamStatus(session) }
            if let groups = list.data.groups {
                layout = groups
                let kept = Set(groups.flatMap(\.ids))
                sessions = sessions.filter { kept.contains($0.key) }
            }
        case .unrecognized:
            return
        }
        await project()
    }

    private func apply(_ update: API.SessionStatusUpdate) {
        guard var session = sessions[update.id] else { return }
        session.status = update.status
        session.unread = update.unread ?? session.unread
        session.creating = update.creating
        session.creationError = update.creationError
        session.title = update.title ?? session.title
        sessions[update.id] = session
    }

    private func withStreamStatus(_ session: API.SessionView) -> API.SessionView {
        guard let statuses else { return session }
        var session = session
        session.status = statuses[session.id] ?? .idle
        return session
    }

    private func project() async {
        projection += 1
        let current = projection
        let input = layout.map { group in
            API.SessionGroup(label: group.label, cwd: group.cwd, workspaceMode: group.workspaceMode.map { .init(rawValue: $0.rawValue) }, baseRef: group.baseRef, sessions: group.ids.compactMap { sessions[$0] })
        }
        do {
            var labels: [String: String] = [:]
            for session in sessions.values { labels[session.id] = try await core.sessionStatusLabel(session) }
            var projected: [Group] = []
            for group in try await core.sidebarSessionGroups(input) {
                var rows: [Row] = []
                for session in try await core.foldedSessionTree(group.sessions) {
                    rows.append(Row(id: session.id, title: session.title, accessibleName: try await core.sessionAccessibleName(session), statusText: labels[session.id] ?? ""))
                }
                projected.append(Group(id: group.key, label: try await core.sessionGroupLabel(group.label), rows: rows))
            }
            guard current == projection else { return }
            statusLabels = labels
            groups = projected
            loaded = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}
