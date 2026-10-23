// The JavaScriptCore host for hui-core.js, the pure logic the app shares with the web (ios/core/entry.ts): one
// JSContext on its own serial queue, called with JSON in and decoded JSON out, plus the types its answers decode into.
// Each open conversation's transcript stays in the context, keyed by the handle its model minted, so a streamed event
// crosses the bridge alone and only the projected rows come back.
import Foundation
import JavaScriptCore

actor HUICore {
    struct ScriptError: Error, CustomStringConvertible {
        var description: String
    }

    private let queue = DispatchSerialQueue(label: "dev.hui.core")
    private let context: JSContext
    private let exports: JSValue
    private var transcripts: [String: JSValue] = [:]
    private var sendRequests: JSValue?

    nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }

    init(script: String) throws {
        guard let context = JSContext() else { throw ScriptError(description: "JavaScriptCore has no context") }
        context.evaluateScript(script)
        if let exception = context.exception { throw ScriptError(description: exception.toString()) }
        guard let exports = context.objectForKeyedSubscript("HUICore"), exports.isObject else {
            throw ScriptError(description: "hui-core.js did not define HUICore")
        }
        self.context = context
        self.exports = exports
    }

    static func bundled() throws -> HUICore {
        guard let url = Bundle.main.url(forResource: "hui-core", withExtension: "js") else {
            throw ScriptError(description: "hui-core.js is not in the app; run npm run ios:core")
        }
        return try HUICore(script: String(contentsOf: url, encoding: .utf8))
    }

    func resolveNavigation(_ path: String) throws -> NavigationResolution {
        try call("resolveNavigation", path)
    }

    func filterSettingsPages(_ query: String) throws -> [SettingsPageEntry] {
        try call("filterSettingsPages", query)
    }

    func decodeSseFrame(_ chunk: String) throws -> SSEFrame? {
        try call("decodeSseFrame", chunk)
    }

    func reconnectDelay(attempt: Int) throws -> Duration {
        .milliseconds(try call("reconnectDelay", attempt) as Double)
    }

    func sessionAccessibleName(_ session: API.SessionView) throws -> String {
        try call("sessionAccessibleName", session)
    }

    func sessionStatusText(_ status: API.SessionStatus) throws -> String {
        try call("sessionStatusText", status)
    }

    func sessionStatusLabel(_ session: API.SessionView) throws -> String {
        try call("sessionStatusLabel", session)
    }

    func sessionGlyph(_ session: API.SessionView) throws -> SessionGlyph {
        try call("sessionGlyph", session)
    }

    func sessionGroupLabel(_ label: String) throws -> String {
        try call("sessionGroupLabel", label)
    }

    func sessionMoveGroupOptions(_ groups: [API.SessionGroup]) throws -> [MoveGroupOption] {
        try call("sessionMoveGroupOptions", groups)
    }

    func sessionIcons() throws -> [String] {
        try decode(exports.forProperty("SESSION_ICONS"))
    }

    func normalizeCustomSessionIcon(_ value: String) throws -> String? {
        try call("normalizeCustomSessionIcon", value)
    }

    func sessionCopiedNotice(_ action: String) throws -> String {
        try call("sessionCopiedNotice", action)
    }

    func sessionPath(_ id: String) throws -> String {
        try call("navigationPath", ["kind": "session", "id": id])
    }

    func sidebarSessionGroups(_ groups: [API.SessionGroup], options: SidebarOptions? = nil) throws -> [SidebarGroup] {
        try call("sidebarSessionGroups", groups, "", options ?? sidebarOptions(stored: nil))
    }

    func sidebarOptions(stored json: String?) throws -> SidebarOptions {
        try decode(invoke("normalizeSidebarSessionOptions", [invoke(global: "JSON", "parse", json ?? "null")]))
    }

    func sessionTree(_ sessions: [API.SessionView], selected: String, toggled: Set<String>) throws -> [SidebarTreeRow] {
        guard let fold = context.evaluateScript("(selectedId, toggled) => ({ selectedId, toggled: new Set(toggled) })")?.call(withArguments: [selected, Array(toggled)]) else {
            throw ScriptError(description: "could not build a fold")
        }
        return try decode(invoke("sessionTreeRows", [json(sessions), fold]))
    }

    func transcriptMarkdown(_ handle: String) throws -> String {
        try decode(invoke("transcriptAsMarkdown", [items(handle)]))
    }

    func transcript(_ handle: String, snapshot entries: [API.TranscriptEntry], streaming: Bool) throws -> ChatProjection {
        let options = try json(["streaming": streaming])
        return try project(handle, invoke("normalizeTranscript", [json(entries), options]))
    }

    func transcript(_ handle: String, event: API.SessionEvent) throws -> ChatProjection {
        try project(handle, invoke("reduceTranscript", [items(handle), json(event)]))
    }

    func transcript(_ handle: String, pending id: String, text: String) throws -> ChatProjection {
        try project(handle, invoke("appendPendingUser", [items(handle), id, text, json([String]())]))
    }

    func transcript(_ handle: String, accepted id: String) throws -> ChatProjection {
        try project(handle, invoke("settlePendingUser", [items(handle), id, true]))
    }

    func transcript(_ handle: String, failed id: String, text: String) throws -> ChatProjection {
        try project(handle, invoke("failPendingUser", [items(handle), id, text, json([String]())]))
    }

    func transcript(_ handle: String, duplicate id: String, earlierRow: String?) throws -> ChatProjection {
        try project(handle, invoke("dropDuplicateSend", [items(handle), id, earlierRow ?? JSValue(undefinedIn: context) as Any]))
    }

    func markdownTokens(_ source: String, agent: Bool) throws -> [MarkdownToken] {
        try call("markdownTokens", source, agent)
    }

    func composerPlaceholder(status: API.SessionStatus?, reconnecting: Bool, streaming: Bool) throws -> String {
        try call("composerPlaceholder", ComposerPlaceholderInput(status: status, reconnecting: reconnecting, streaming: streaming))
    }

    private struct ComposerPlaceholderInput: Encodable {
        var status: API.SessionStatus?
        var reconnecting: Bool
        var streaming: Bool
        var coarsePointer = true
        var applePlatform = true
    }

    func continueAfterErrorPrompt() throws -> String {
        try decode(exports.objectForKeyedSubscript("CONTINUE_AFTER_ERROR_PROMPT"))
    }

    func queueRows(_ queue: API.RuntimeQueue) throws -> [QueueRow] {
        try call("queueRows", queue)
    }

    func closeTranscript(_ handle: String) {
        transcripts[handle] = nil
    }

    func takeRequestId(_ session: String, text: String) throws -> RequestId {
        try decode(invoke("take", [session, text, json([String]())], on: requests()))
    }

    func sendFailed(_ session: String, requestId: String, text: String, row: String?) throws {
        _ = try invoke("failed", [session, requestId, text, json([String]()), row ?? JSValue(undefinedIn: context) as Any], on: requests())
    }

    private func items(_ handle: String) throws -> JSValue {
        if let items = transcripts[handle] { return items }
        return try json([String]())
    }

    private func project(_ handle: String, _ items: JSValue) throws -> ChatProjection {
        transcripts[handle] = items
        let rows: ChatRows = try decode(invoke("chatRows", [items]))
        return ChatProjection(rows: rows.rows, working: try decode(invoke("workingLabel", [items])), runError: try decode(invoke("latestRunError", [items, false])))
    }

    private func requests() throws -> JSValue {
        if let sendRequests { return sendRequests }
        let newId: @convention(block) () -> String = { UUID().uuidString }
        guard let constructor = exports.objectForKeyedSubscript("SendRequests"),
              let requests = constructor.construct(withArguments: [JSValue(object: newId, in: context) as Any]) else {
            throw ScriptError(description: "hui-core.js has no SendRequests")
        }
        try rethrow("SendRequests")
        sendRequests = requests
        return requests
    }

    private func rethrow(_ name: String) throws {
        guard let exception = context.exception else { return }
        context.exception = nil
        throw ScriptError(description: "\(name): \(exception.toString() ?? "exception")")
    }

    private func call<Answer: Decodable>(_ name: String, _ arguments: any Encodable...) throws -> Answer {
        try decode(invoke(name, arguments.map(json)))
    }

    private func invoke(_ name: String, _ arguments: [Any], on target: JSValue? = nil) throws -> JSValue {
        let result = (target ?? exports).invokeMethod(name, withArguments: arguments)
        try rethrow(name)
        guard let result else { throw ScriptError(description: "\(name) returned nothing") }
        return result
    }

    private func json(_ value: any Encodable) throws -> JSValue {
        let text = String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
        return try invoke(global: "JSON", "parse", text)
    }

    private func decode<Answer: Decodable>(_ value: JSValue) throws -> Answer {
        let text = value.isUndefined ? "null" : try invoke(global: "JSON", "stringify", value).toString() ?? "null"
        return try JSONDecoder().decode(Answer.self, from: Data(text.utf8))
    }

    private func invoke(global: String, _ name: String, _ argument: Any) throws -> JSValue {
        guard let result = context.objectForKeyedSubscript(global)?.invokeMethod(name, withArguments: [argument]) else {
            throw ScriptError(description: "\(global).\(name) returned nothing")
        }
        if let exception = context.exception {
            context.exception = nil
            throw ScriptError(description: exception.toString())
        }
        return result
    }
}

struct ChatProjection: Equatable, Sendable {
    var rows: [ChatRow]
    var working: String
    var runError: RunErrorNotice?
}

struct RunErrorNotice: Decodable, Equatable, Sendable {
    var key: String
    var summary: String
    var detail: String
    var multiline: Bool
}

struct QueueRow: Decodable, Hashable, Sendable {
    var id: String
    var text: String
    var label: String
    var editable: Bool
}

struct RequestId: Decodable, Sendable {
    var requestId: String
    var earlierRow: String?
}

struct SSEFrame: Decodable, Sendable {
    var name: String
    var payload: API.JSONValue
}

struct MoveGroupOption: Decodable, Hashable, Sendable {
    var label: String
    var value: String
}

struct SidebarGroup: Decodable, Sendable {
    var key: String
    var label: String
    var sessions: [API.SessionView]
}

struct SessionGlyph: Decodable, Equatable, Sendable {
    struct Attention: Decodable, Equatable, Sendable {
        var tone: String
    }

    var attention: Attention?
    var busy: Bool
    var unread: Bool
    var label: String
}

struct SidebarOptions: Codable, Equatable, Sendable {
    var groupBy: String
    var sortBy: String
    var status: String
    var hideEmpty: String
}

struct SidebarTreeRow: Decodable, Sendable {
    var session: API.SessionView
    var depth: Int
    var hasChildren: Bool
    var collapsed: Bool
}

struct NavigationResolution: Decodable, Equatable, Sendable {
    var target: NavigationTarget
    var path: String
}

enum NavigationTarget: Decodable, Equatable, Sendable {
    case home
    case kanban
    case page(String)
    case settings(String)
    case session(String)
    case bot(String)

    private enum CodingKeys: String, CodingKey {
        case kind, page, id
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "home": self = .home
        case "kanban": self = .kanban
        case "page": self = .page(try container.nestedContainer(keyedBy: CodingKeys.self, forKey: .page).decode(String.self, forKey: .id))
        case "settings": self = .settings(try container.decode(String.self, forKey: .page))
        case "session": self = .session(try container.decode(String.self, forKey: .id))
        case "bot": self = .bot(try container.decode(String.self, forKey: .id))
        default: throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "unknown navigation target")
        }
    }
}
