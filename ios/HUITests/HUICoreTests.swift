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
}
