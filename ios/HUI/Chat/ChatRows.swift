// The chat's view models as the core's `chatRows` returns them (src/lib/chat-rows.ts): transcript items
// (`TranscriptItem` in src/api/sessions.ts) grouped into rows, each row and item with a unique `key`, activity rows with
// their labels and tool items with their cards. Mirrored by hand, so scripts/ios-contract.test.mjs checks both kind
// enums against the TypeScript unions. A kind a newer gateway adds decodes as `unrecognized` and draws nothing, and a
// row that fails to decode is logged and left out, so the rest of the chat keeps working.
import Foundation
import OSLog

protocol ForwardCompatibleKind: RawRepresentable<String>, Decodable {
    static var unrecognized: Self { get }
}

extension ForwardCompatibleKind {
    init(from decoder: any Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unrecognized
    }
}

enum TranscriptItemKind: String, ForwardCompatibleKind, Sendable {
    case message, call, compaction, thinking, tool, error, unrecognized
}

enum ChatRowKind: String, ForwardCompatibleKind, Sendable {
    case messages, activity, compaction, call, subagentEvent, botCreated, unrecognized
}

struct TranscriptItem: Decodable, Equatable, Sendable {
    var kind: TranscriptItemKind
    var id: String
    var key: String
    var role: String?
    var text: String?
    var name: String?
    var args: API.JSONValue?
    var output: String?
    var status: String?
    var failed: Bool?
    var pending: Bool?
    var read: ReadCard?
    var command: CommandCard?
    var codemode: CodemodeCard?
}

struct ReadCard: Decodable, Equatable, Sendable {
    var target: String
    var detail: String
}

struct CommandCard: Decodable, Equatable, Sendable {
    var command: String
    var preview: String
}

struct CodemodeCard: Decodable, Equatable, Sendable {
    var code: String
    var output: String
    var summary: String
    var outcome: String
}

struct ChatRow: Decodable, Equatable, Sendable {
    var kind: ChatRowKind
    var key: String
    var messages: [TranscriptItem]?
    var activity: [TranscriptItem]?
    var label: String?
    var liveLabel: String?

    private enum CodingKeys: String, CodingKey {
        case kind, key, messages, items, label, liveLabel
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(ChatRowKind.self, forKey: .kind)
        key = try container.decode(String.self, forKey: .key)
        messages = try container.decodeIfPresent([TranscriptItem].self, forKey: .messages)
        activity = kind == .activity ? try container.decodeIfPresent([TranscriptItem].self, forKey: .items) : nil
        label = try container.decodeIfPresent(String.self, forKey: .label)
        liveLabel = try container.decodeIfPresent(String.self, forKey: .liveLabel)
    }
}

struct ChatRows: Decodable, Equatable, Sendable {
    var rows: [ChatRow]

    private struct Row: Decodable {
        var row: ChatRow?

        init(from decoder: any Decoder) throws {
            do {
                row = try ChatRow(from: decoder)
            } catch {
                Logger(subsystem: "dev.hui.ios", category: "chat").error("Left out a chat row that did not decode: \(error)")
            }
        }
    }

    init(from decoder: any Decoder) throws {
        rows = try [Row](from: decoder).compactMap(\.row)
    }
}
