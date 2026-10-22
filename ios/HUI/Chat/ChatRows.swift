// The chat's view models as the core returns them: transcript items (`TranscriptItem` in src/api/sessions.ts) and the
// rows `projectChatTranscript` groups them into (src/lib/chat-projection.ts). Mirrored by hand, so
// scripts/ios-contract.test.mjs checks both kind enums against the TypeScript unions.
import Foundation

enum TranscriptItemKind: String, Codable, Sendable {
    case message, call, compaction, thinking, tool, error
}

enum ChatRowKind: String, Decodable, Sendable {
    case messages, activity, compaction, call, subagentEvent, botCreated
}

struct TranscriptItem: Codable, Equatable, Identifiable, Sendable {
    var kind: TranscriptItemKind
    var id: String
    var role: String?
    var text: String?
    var name: String?
    var args: API.JSONValue?
    var output: String?
    var status: String?
    var failed: Bool?
    var pending: Bool?
    var summary: String?
}

struct ChatRow: Decodable, Equatable, Identifiable, Sendable {
    var kind: ChatRowKind
    var id: String
    var role: String?
    var messages: [TranscriptItem]?
    var item: TranscriptItem?
    var name: String?
    var activity: [TranscriptItem]?

    private enum CodingKeys: String, CodingKey {
        case kind, id, role, messages, item, name, items
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(ChatRowKind.self, forKey: .kind)
        id = try container.decode(String.self, forKey: .id)
        role = try container.decodeIfPresent(String.self, forKey: .role)
        messages = try container.decodeIfPresent([TranscriptItem].self, forKey: .messages)
        item = kind == .compaction ? try container.decodeIfPresent(TranscriptItem.self, forKey: .item) : nil
        name = try container.decodeIfPresent(String.self, forKey: .name)
        activity = kind == .activity ? try container.decodeIfPresent([TranscriptItem].self, forKey: .items) : nil
    }
}
