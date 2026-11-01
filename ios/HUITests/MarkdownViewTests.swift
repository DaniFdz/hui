// Markdown from the core's tokens: a link with a scheme the parser blocks stays plain text, and a task list's
// checkboxes read ☐ and ☑, as on the web.
import Foundation
import Testing
@testable import HUI

@MainActor
struct MarkdownViewTests {
    @Test func blockedSchemesAreNotLinks() async throws {
        let core = try HUICore.bundled()
        for href in ["javascript:alert(1)", "tel:+15550100", "shortcuts://run-shortcut?name=x", "file:///etc/passwd"] {
            let tokens = try await core.markdownTokens("[tap](\(href))", agent: true)
            let text = MarkdownView.inline(tokens.first { $0.type == "inline" }?.children ?? [])
            #expect(String(text.characters) == "tap")
            #expect(text.runs.allSatisfy { $0.link == nil }, "\(href) became a link")
        }
        let tokens = try await core.markdownTokens("[site](https://example.com)", agent: true)
        #expect(MarkdownView.inline(tokens.first { $0.type == "inline" }?.children ?? []).runs.contains { $0.link == URL(string: "https://example.com") })
    }

    @Test func taskListsShowTheirCheckboxes() async throws {
        let core = try HUICore.bundled()
        let blocks = MarkdownView.blocks(try await core.markdownTokens("- [ ] todo\n- [x] done", agent: true))
        let lines = blocks.compactMap { block -> String? in
            guard case .text(let text, let prefix, _) = block else { return nil }
            return prefix + String(text.characters)
        }
        #expect(lines == ["☐ todo", "☑ done"])
    }
}
