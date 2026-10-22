// The live session list, as the web's sessions controller owns it: opens GET /__hui/sessions/events, loads
// GET /__hui/sessions, then reads the stream for statuses and list changes, reconnecting with the core's backoff. The
// stream's statuses win over every list and upsert once its snapshot arrived. Rows are projected by the core with the
// web sidebar's Filter & sort options (kept on the device as the web keeps them in the browser), grouping,
// subagent folding, labels and accessible names. The session menu's actions patch or delete a session as the web's
// do, with the web's notices: an archive keeps a toast with Restore for 15 s, other notices go after 6 s, and a
// failure stays until the next one.
import Foundation
import Observation

@MainActor
@Observable
final class SessionsModel {
    struct Row: Identifiable, Equatable {
        var id: String
        var title: String
        var accessibleName: String
        var glyph: SessionGlyph
        var pinned: Bool
        var unread: Bool
        var group: String
        var depth: Int
        var hasChildren: Bool
        var collapsed: Bool
    }

    struct Notice: Equatable {
        var text: String
        var failed: Bool
    }

    struct ArchiveToast: Equatable {
        var id: String
        var title: String
        var restoring = false
        var error: String?
    }

    struct Group: Identifiable, Equatable {
        var id: String
        var label: String
        var rows: [Row]
    }

    private(set) var groups: [Group] = []
    private(set) var loaded = false
    private(set) var error: String?
    private(set) var options: SidebarOptions?
    private(set) var moveGroups: [MoveGroupOption] = []
    private(set) var notice: Notice?
    private(set) var archiveToast: ArchiveToast?
    var closed: Set<String> = []
    var removing: API.SessionView?
    var selected = "" {
        didSet { if selected != oldValue { reproject() } }
    }
    private var toggled: Set<String> = []

    var filtering: Bool {
        options.map { $0.status != "all" } ?? false
    }

    private static let optionsKey = "hui.sidebar-session-options"

    private let core: HUICore
    private var revision = -Double.infinity
    private var layout: [API.SessionListLayoutGroup] = []
    private var sessions: [String: API.SessionView] = [:]
    private var statuses: [String: API.SessionStatus]?
    private var projection = 0
    private var stream: Task<Void, Never>?
    private var noticeTimer: Task<Void, Never>?
    private var archiveTimer: Task<Void, Never>?

    init(core: HUICore) {
        self.core = core
    }

    func session(_ id: String) -> API.SessionView? {
        sessions[id]
    }

    func page(_ state: String) -> [API.SessionView] {
        layout.flatMap(\.ids).compactMap { sessions[$0] }.filter { state == "all" || ($0.archived == true) == (state == "archived") }
    }

    func toggleTree(_ id: String) {
        toggled.formSymmetricDifference([id])
        reproject()
    }

    private func tree(_ id: String) -> Set<String> {
        var ids: Set<String> = [id]
        var grew = true
        while grew {
            let children = sessions.values.filter { !ids.contains($0.id) && $0.parentId.map(ids.contains) == true }.map(\.id)
            grew = !children.isEmpty
            ids.formUnion(children)
        }
        return ids
    }

    func setOptions(_ options: SidebarOptions) {
        self.options = options
        UserDefaults.standard.set(String(decoding: (try? JSONEncoder().encode(options)) ?? Data(), as: UTF8.self), forKey: Self.optionsKey)
        reproject()
    }

    func createGroup(_ name: String, client: GatewayClient) async {
        do {
            let _: API.JSONValue = try await client.post("/__hui/session-groups", body: ["name": name])
        } catch {
            self.error = error.localizedDescription
        }
    }

    func notify(_ text: String, failed: Bool = false) {
        noticeTimer?.cancel()
        notice = Notice(text: text, failed: failed)
        guard !failed else { return }
        noticeTimer = Task {
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { notice = nil }
        }
    }

    @discardableResult
    func update(_ id: String, _ patch: [String: API.JSONValue], client: GatewayClient) async -> API.SessionView? {
        do {
            let answer: SessionAnswer = try await client.send("PATCH", "/__hui/sessions/\(Self.escaped(id))", body: patch)
            sessions[id] = withStreamStatus(answer.session)
            await project()
            return answer.session
        } catch {
            notify(error.localizedDescription, failed: true)
            return nil
        }
    }

    func setUnread(_ session: API.SessionView, client: GatewayClient) async {
        let unread = session.unread == true
        if await update(session.id, ["unread": .bool(!unread)], client: client) != nil {
            notify(unread ? "Marked as read." : "Marked as unread.")
        }
    }

    func move(_ session: API.SessionView, to group: String, client: GatewayClient) async {
        guard let moved = await update(session.id, ["group": .string(group)], client: client) else { return }
        guard let label = try? await core.sessionGroupLabel(moved.group) else { return }
        notify("Moved \(moved.title) to \(label).")
    }

    func archive(_ session: API.SessionView, client: GatewayClient) async {
        let ids = tree(session.id)
        guard await update(session.id, ["archived": .bool(true)], client: client) != nil else { return }
        closed = ids
        noticeTimer?.cancel()
        notice = nil
        archiveToast = ArchiveToast(id: session.id, title: session.title)
        expireArchiveToast()
    }

    func restoreArchived(client: GatewayClient) async {
        guard let toast = archiveToast, !toast.restoring else { return }
        archiveTimer?.cancel()
        archiveToast?.restoring = true
        do {
            let _: SessionAnswer = try await client.send("PATCH", "/__hui/sessions/\(Self.escaped(toast.id))", body: ["archived": API.JSONValue.bool(false)])
            if archiveToast?.id == toast.id { archiveToast = nil }
            notify("Session restored.")
        } catch {
            if archiveToast?.id == toast.id { archiveToast = ArchiveToast(id: toast.id, title: toast.title, error: error.localizedDescription) }
        }
    }

    func dismissArchiveToast() {
        archiveTimer?.cancel()
        archiveToast = nil
    }

    private func expireArchiveToast() {
        archiveTimer?.cancel()
        archiveTimer = Task {
            try? await Task.sleep(for: .seconds(15))
            if !Task.isCancelled, archiveToast?.error == nil, archiveToast?.restoring == false { archiveToast = nil }
        }
    }

    func restore(_ session: API.SessionView, client: GatewayClient) async {
        if await update(session.id, ["archived": .bool(false)], client: client) != nil { notify("Session restored.") }
    }

    func remove(_ session: API.SessionView, client: GatewayClient) async {
        let ids = tree(session.id)
        do {
            let _: API.JSONValue = try await client.send("DELETE", "/__hui/sessions/\(Self.escaped(session.id))")
            closed = ids
        } catch {
            notify(error.localizedDescription, failed: true)
        }
    }

    func copy(_ id: String, _ action: String, client: GatewayClient, markdown: () async throws -> String = { "" }, write: (String) -> Void) async {
        do {
            let text = action == "id" ? id : action == "markdown" ? try await markdown() : client.origin + (try await core.sessionPath(id))
            write(text)
            notify(try await core.sessionCopiedNotice(action))
        } catch {
            notify("Could not copy to the clipboard.", failed: true)
        }
    }

    private static func escaped(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
    }

    private struct SessionAnswer: Decodable {
        var session: API.SessionView
    }

    private func reproject() {
        guard loaded else { return }
        Task { await project() }
    }

    func start(_ client: GatewayClient) {
        stream?.cancel()
        revision = -.infinity
        statuses = nil
        stream = Task { await run(client) }
    }

    private func run(_ client: GatewayClient) async {
        if options == nil {
            options = try? await core.sidebarOptions(stored: UserDefaults.standard.string(forKey: Self.optionsKey))
            if options == nil { options = try? await core.sidebarOptions(stored: nil) }
        }
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
            var projected: [Group] = []
            for group in try await core.sidebarSessionGroups(input, options: options) {
                var rows: [Row] = []
                for tree in try await core.sessionTree(group.sessions, selected: selected, toggled: toggled) {
                    let session = tree.session
                    rows.append(Row(id: session.id, title: session.title, accessibleName: try await core.sessionAccessibleName(session), glyph: try await core.sessionGlyph(session),
                                    pinned: session.pinned == true, unread: session.unread == true, group: session.group,
                                    depth: tree.depth, hasChildren: tree.hasChildren, collapsed: tree.collapsed))
                }
                projected.append(Group(id: group.key, label: try await core.sessionGroupLabel(group.label), rows: rows))
            }
            let moves = try await core.sessionMoveGroupOptions(input)
            guard current == projection else { return }
            groups = projected
            moveGroups = moves
            loaded = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}
