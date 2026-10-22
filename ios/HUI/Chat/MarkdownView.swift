// A basic Markdown renderer for chat messages, drawn from the tokens the core's markdown-it parser returns
// (src/lib/markdown/parser.ts), so both clients read Markdown alike: paragraphs, headings, list items, quotes, code
// blocks and rules as views, inline text as one AttributedString (bold, italic, strikethrough, code, links). Raw HTML
// shows as text, as the web escapes it. Until the core answers, the source shows as plain text.
import SwiftUI

struct MarkdownToken: Decodable, Equatable, Sendable {
    var type: String
    var tag: String
    var content: String
    var info: String
    var attrs: [[String]]?
    var children: [MarkdownToken]?

    func attribute(_ name: String) -> String? {
        attrs?.first { $0.first == name }?.last
    }
}

struct MarkdownView: View {
    let source: String
    let agent: Bool
    let core: HUICore
    @State private var tokens: [MarkdownToken]?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let tokens {
                ForEach(Array(Self.blocks(tokens).enumerated()), id: \.offset) { _, block in
                    view(block)
                }
            } else {
                Text(source)
            }
        }
        .task(id: source) {
            tokens = try? await core.markdownTokens(source, agent: agent)
        }
    }

    enum Block {
        case text(AttributedString, prefix: String, font: Font?)
        case code(String)
        case rule
    }

    @ViewBuilder private func view(_ block: Block) -> some View {
        switch block {
        case .text(let text, let prefix, let font):
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if !prefix.isEmpty { Text(prefix).accessibilityHidden(true) }
                Text(text).font(font).textSelection(.enabled)
            }
        case .code(let code):
            ScrollView(.horizontal) {
                Text(code).font(.system(.footnote, design: .monospaced)).textSelection(.enabled).padding(8)
            }
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
        case .rule:
            Divider()
        }
    }

    static func blocks(_ tokens: [MarkdownToken]) -> [Block] {
        var blocks: [Block] = []
        var lists: [Int?] = []
        var prefix = ""
        var font: Font?
        var quote = 0
        for token in tokens {
            switch token.type {
            case "bullet_list_open": lists.append(nil)
            case "ordered_list_open": lists.append(0)
            case "bullet_list_close", "ordered_list_close": lists.removeLast()
            case "list_item_open":
                let indent = String(repeating: "  ", count: max(0, lists.count - 1))
                if let count = lists.last ?? nil {
                    lists[lists.count - 1] = count + 1
                    prefix = "\(indent)\(count + 1)."
                } else {
                    prefix = "\(indent)•"
                }
            case "blockquote_open": quote += 1
            case "blockquote_close": quote -= 1
            case "heading_open": font = token.tag == "h1" ? .title2.bold() : token.tag == "h2" ? .title3.bold() : .headline
            case "heading_close": font = nil
            case "inline":
                let lead = String(repeating: "▍", count: quote) + prefix
                blocks.append(.text(inline(token.children ?? []), prefix: lead, font: font))
                prefix = ""
            case "fence", "code_block", "hui_math_block": blocks.append(.code(token.content.trimmingCharacters(in: .newlines)))
            case "html_block": blocks.append(.text(AttributedString(token.content.trimmingCharacters(in: .newlines)), prefix: "", font: nil))
            case "hr": blocks.append(.rule)
            default: continue
            }
        }
        return blocks
    }

    static func inline(_ tokens: [MarkdownToken]) -> AttributedString {
        var result = AttributedString()
        var intents: InlinePresentationIntent = []
        var link: URL?
        for token in tokens {
            var piece: AttributedString?
            switch token.type {
            case "text", "hui_math_inline": piece = AttributedString(token.content)
            case "softbreak", "hardbreak": piece = AttributedString("\n")
            case "code_inline":
                piece = AttributedString(token.content)
                piece?.inlinePresentationIntent = intents.union(.code)
            case "strong_open": intents.insert(.stronglyEmphasized)
            case "strong_close": intents.remove(.stronglyEmphasized)
            case "em_open": intents.insert(.emphasized)
            case "em_close": intents.remove(.emphasized)
            case "s_open": intents.insert(.strikethrough)
            case "s_close": intents.remove(.strikethrough)
            case "link_open": link = token.attribute("href").flatMap(URL.init(string:))
            case "link_close": link = nil
            case "image": piece = AttributedString(token.content)
            case "html_inline":
                if !token.content.hasPrefix("<hui-file-ref"), token.content != "</hui-file-ref>" { piece = AttributedString(token.content) }
            default: continue
            }
            guard var piece else { continue }
            if token.type != "code_inline" { piece.inlinePresentationIntent = intents }
            if let link { piece.link = link }
            result += piece
        }
        return result
    }
}
