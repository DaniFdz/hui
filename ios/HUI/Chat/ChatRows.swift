// The chat's view models as the core returns them: transcript items (`TranscriptItem` in src/api/sessions.ts) and the
// rows `projectChatTranscript` groups them into (src/lib/chat-projection.ts), with the activity labels and tool card
// views the core adds. Mirrored by hand, so scripts/ios-contract.test.mjs checks both kind enums against the
// TypeScript unions.
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
    var read: ReadCard?
    var command: CommandCard?
    var codemode: CodemodeCard?
}

struct ReadCard: Codable, Equatable, Sendable {
    var target: String
    var detail: String
}

struct CommandCard: Codable, Equatable, Sendable {
    var command: String
    var preview: String
}

struct CodemodeCard: Codable, Equatable, Sendable {
    var code: String
    var output: String
    var summary: String?
    var outcome: String?
}

struct ChatRow: Decodable, Equatable, Identifiable, Sendable {
    var kind: ChatRowKind
    var id: String
    var messages: [TranscriptItem]?
    var activity: [TranscriptItem]?
    var label = ""
    var liveLabel = ""

    private enum CodingKeys: String, CodingKey {
        case kind, id, messages, items
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(ChatRowKind.self, forKey: .kind)
        id = try container.decode(String.self, forKey: .id)
        messages = try container.decodeIfPresent([TranscriptItem].self, forKey: .messages)
        activity = kind == .activity ? try container.decodeIfPresent([TranscriptItem].self, forKey: .items) : nil
    }
}
