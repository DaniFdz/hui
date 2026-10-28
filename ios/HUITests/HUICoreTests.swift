// The JavaScriptCore bridge: hui-core.js loads from the app and answers as the web's functions do.
import Foundation
import Testing
@testable import HUI

struct HUICoreTests {
    @Test func resolvesNavigationLikeTheWeb() async throws {
        let core = try HUICore.bundled()
        #expect(try await core.resolveNavigation("/sessions/a%20b") == NavigationResolution(target: .session("a b"), path: "/sessions/a%20b"))
        #expect(try await core.resolveNavigation("/settings/appearance").target == .settings("appearance"))
        #expect(try await core.resolveNavigation("/sessions").target == .page("sessions"))
        #expect(try await core.resolveNavigation("/nowhere") == NavigationResolution(target: .home, path: "/"))
    }

    @Test func reconnectDelayStaysWithinItsJitter() async throws {
        let core = try HUICore.bundled()
        let first = try await core.reconnectDelay(attempt: 1)
        #expect(first >= .milliseconds(250) && first <= .milliseconds(500))
        let late = try await core.reconnectDelay(attempt: 10)
        #expect(late >= .milliseconds(2_000) && late <= .milliseconds(4_000))
    }

    @Test func aScriptExceptionThrows() async throws {
        let core = try HUICore.bundled()
        await #expect(throws: HUICore.ScriptError.self) { try await core.decodeSseFrame("data: {broken") }
    }

    @Test func labelsARecordedSessionLikeTheWebSidebar() async throws {
        let core = try HUICore.bundled()
        let list = try JSONDecoder().decode(API.SessionList.self, from: fixture("sessions.json"))
        let groups = try await core.sidebarSessionGroups(list.groups)
        #expect(groups.map(\.key) == ["ungrouped"])
        #expect(try await core.sessionGroupLabel(groups[0].label) == "OTHER")
        let session = try #require(groups[0].sessions.first { $0.title == "Write release notes" })
        #expect(try await core.sessionAccessibleName(session) == "Write release notes, status starting, tool pi, stage investigation")
        #expect(try await core.sessionStatusText(.idle) == "Idle")
    }

    @Test func readsStoredSidebarOptionsAndAppliesThem() async throws {
        let core = try HUICore.bundled()
        #expect(try await core.sidebarOptions(stored: nil) == SidebarOptions(groupBy: "custom", sortBy: "updated", status: "all", hideEmpty: "filtering"))
        let stored = try await core.sidebarOptions(stored: #"{"sortBy":"title","status":"nope"}"#)
        #expect(stored == SidebarOptions(groupBy: "custom", sortBy: "title", status: "all", hideEmpty: "filtering"))
        let list = try JSONDecoder().decode(API.SessionList.self, from: fixture("sessions.json"))
        let starting = try await core.sidebarSessionGroups(list.groups, options: SidebarOptions(groupBy: "none", sortBy: "title", status: "starting", hideEmpty: "filtering"))
        #expect(starting.map(\.key) == ["\u{0}flat"])
        #expect(starting[0].sessions.map(\.title) == starting[0].sessions.map(\.title).sorted())
        let session = try #require(starting[0].sessions.first)
        #expect(try await core.sessionGlyph(session) == SessionGlyph(busy: false, unread: false, label: ""))
    }

    @Test func rowsAndItemsKeepUniqueKeysWhenToolIdsRepeat() async throws {
        let core = try HUICore.bundled()
        let entries = try JSONDecoder().decode([API.TranscriptEntry].self, from: Data(#"[{"kind":"message","entryId":"u1","role":"user","text":"One"},{"kind":"tool","id":"t","name":"read"},{"kind":"message","entryId":"u2","role":"user","text":"Two"},{"kind":"tool","id":"t","name":"read"}]"#.utf8))
        let rows = try await core.transcript("k", snapshot: entries, streaming: false).rows
        let keys = rows.map(\.key) + rows.flatMap { ($0.activity ?? []) + ($0.messages ?? []) }.map(\.key)
        #expect(Set(keys).count == keys.count)
        #expect(rows.compactMap { $0.activity?.first?.key } == ["tool:t", "tool:t#1"])
    }

    @Test func aProgressCallBecomesTheComposerCardInsteadOfARow() async throws {
        let core = try HUICore.bundled()
        let entries = try JSONDecoder().decode([API.TranscriptEntry].self, from: Data(#"[{"kind":"tool","id":"p","name":"progress_card","args":{"markdown":"Notes","plan":[{"step":"One","status":"completed"},{"step":"Two","status":"in_progress"}]}}]"#.utf8))
        let projection = try await core.transcript("p", snapshot: entries, streaming: false)
        #expect(projection.rows.isEmpty)
        #expect(projection.progressCard?.markdown == "Notes")
        #expect(projection.progressCard?.steps.map(\.step) == ["One", "Two"])
        #expect(projection.progressCard?.steps.map(\.status) == [.completed, .inProgress])
    }

    @Test func anUnknownKindDecodesAsUnrecognizedAndABrokenRowIsLeftOut() throws {
        let json = #"[{"kind":"poll","key":"poll:p"},{"kind":"messages"},{"kind":"messages","key":"m","messages":[{"kind":"sticker","id":"s","key":"s"}]}]"#
        let rows = try JSONDecoder().decode(ChatRows.self, from: Data(json.utf8)).rows
        #expect(rows.map(\.kind) == [.unrecognized, .messages])
        #expect(rows.last?.messages?.first?.kind == .unrecognized)
    }
}
