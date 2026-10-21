// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    enum CompactionReason: RawRepresentable, Codable, Hashable, Sendable {
        case manual
        case threshold
        case overflow
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "manual": self = .manual
            case "threshold": self = .threshold
            case "overflow": self = .overflow
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .manual: "manual"
            case .threshold: "threshold"
            case .overflow: "overflow"
            case .unrecognized(let value): value
            }
        }
    }

    struct QueuedMessage: Codable, Hashable, Sendable {
        var id: String
        var text: String
        var mode: String = "followUp"
    }

    struct RuntimeCommand: Codable, Hashable, Sendable {
        var name: String
        var description: String
        var source: Source

        enum Source: RawRepresentable, Codable, Hashable, Sendable {
            case `extension`
            case skill
            case prompt
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "extension": self = .`extension`
                case "skill": self = .skill
                case "prompt": self = .prompt
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .`extension`: "extension"
                case .skill: "skill"
                case .prompt: "prompt"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct RuntimeCompaction: Codable, Hashable, Sendable {
        var status: Status
        var reason: CompactionReason
        var message: String?
        var blocking: Bool?
        var background: Bool?

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case running
            case failed
            case cancelled
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "running": self = .running
                case "failed": self = .failed
                case "cancelled": self = .cancelled
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .running: "running"
                case .failed: "failed"
                case .cancelled: "cancelled"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct RuntimeModel: Codable, Hashable, Sendable {
        var provider: String
        var id: String
        var name: String
        var contextWindow: Double?
        var maxTokens: Double?
        var thinkingLevels: [String]?
        var fast: Bool?
    }

    enum RuntimeQuestion: Codable, Hashable, Sendable {
        case select(Select)
        case confirm(Confirm)
        case input(Input)
        case editor(Editor)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case method
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .method) {
            case "select": self = try .select(Select(from: decoder))
            case "confirm": self = try .confirm(Confirm(from: decoder))
            case "input": self = try .input(Input(from: decoder))
            case "editor": self = try .editor(Editor(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .select(let value): try value.encode(to: encoder)
            case .confirm(let value): try value.encode(to: encoder)
            case .input(let value): try value.encode(to: encoder)
            case .editor(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Select: Codable, Hashable, Sendable {
            var id: String
            var method: String = "select"
            var title: String
            var message: String?
            var options: [String]
            var timeout: Double?
        }

        struct Confirm: Codable, Hashable, Sendable {
            var id: String
            var method: String = "confirm"
            var title: String
            var message: String
            var timeout: Double?
        }

        struct Input: Codable, Hashable, Sendable {
            var id: String
            var method: String = "input"
            var title: String
            var placeholder: String?
            var timeout: Double?
        }

        struct Editor: Codable, Hashable, Sendable {
            var id: String
            var method: String = "editor"
            var title: String
            var prefill: String?
            var timeout: Double?
        }
    }

    struct RuntimeQueue: Codable, Hashable, Sendable {
        var steering: [String]
        var followUp: [String]
        var items: [QueuedMessage]?
    }

    struct RuntimeUsage: Codable, Hashable, Sendable {
        var contextTokens: Double?
        var contextWindow: Double
        var percent: Double?
        var inputTokens: Double
        var outputTokens: Double
        var costUsd: Double?

        enum CodingKeys: String, CodingKey {
            case contextTokens
            case contextWindow
            case percent
            case inputTokens
            case outputTokens
            case costUsd
        }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(contextTokens, forKey: .contextTokens)
            try container.encode(contextWindow, forKey: .contextWindow)
            try container.encode(percent, forKey: .percent)
            try container.encode(inputTokens, forKey: .inputTokens)
            try container.encode(outputTokens, forKey: .outputTokens)
            try container.encode(costUsd, forKey: .costUsd)
        }
    }

    struct SessionBtwRequest: Codable, Hashable, Sendable {
        var question: String
    }

    struct SessionClearResponse: Codable, Hashable, Sendable {
        var snapshot: SessionSnapshot
    }

    struct SessionCommandsResponse: Codable, Hashable, Sendable {
        var commands: [RuntimeCommand]
    }

    enum SessionEvent: Codable, Hashable, Sendable {
        case text(Text)
        case thinking(Thinking)
        case toolStart(ToolStart)
        case toolUpdate(ToolUpdate)
        case toolEnd(ToolEnd)
        case queueUpdate(QueueUpdate)
        case question(Question)
        case notice(Notice)
        case turnStart(TurnStart)
        case turnEnd(TurnEnd)
        case compactionStart(CompactionStart)
        case compactionEnd(CompactionEnd)
        case settled(Settled)
        case error(ErrorValue)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case type
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .type) {
            case "text": self = try .text(Text(from: decoder))
            case "thinking": self = try .thinking(Thinking(from: decoder))
            case "tool_start": self = try .toolStart(ToolStart(from: decoder))
            case "tool_update": self = try .toolUpdate(ToolUpdate(from: decoder))
            case "tool_end": self = try .toolEnd(ToolEnd(from: decoder))
            case "queue_update": self = try .queueUpdate(QueueUpdate(from: decoder))
            case "question": self = try .question(Question(from: decoder))
            case "notice": self = try .notice(Notice(from: decoder))
            case "turn_start": self = try .turnStart(TurnStart(from: decoder))
            case "turn_end": self = try .turnEnd(TurnEnd(from: decoder))
            case "compaction_start": self = try .compactionStart(CompactionStart(from: decoder))
            case "compaction_end": self = try .compactionEnd(CompactionEnd(from: decoder))
            case "settled": self = try .settled(Settled(from: decoder))
            case "error": self = try .error(ErrorValue(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .text(let value): try value.encode(to: encoder)
            case .thinking(let value): try value.encode(to: encoder)
            case .toolStart(let value): try value.encode(to: encoder)
            case .toolUpdate(let value): try value.encode(to: encoder)
            case .toolEnd(let value): try value.encode(to: encoder)
            case .queueUpdate(let value): try value.encode(to: encoder)
            case .question(let value): try value.encode(to: encoder)
            case .notice(let value): try value.encode(to: encoder)
            case .turnStart(let value): try value.encode(to: encoder)
            case .turnEnd(let value): try value.encode(to: encoder)
            case .compactionStart(let value): try value.encode(to: encoder)
            case .compactionEnd(let value): try value.encode(to: encoder)
            case .settled(let value): try value.encode(to: encoder)
            case .error(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Text: Codable, Hashable, Sendable {
            var type: String = "text"
            var delta: String
        }

        struct Thinking: Codable, Hashable, Sendable {
            var type: String = "thinking"
            var delta: String
        }

        struct ToolStart: Codable, Hashable, Sendable {
            var type: String = "tool_start"
            var id: String
            var name: String
            var args: JSONValue?
        }

        struct ToolUpdate: Codable, Hashable, Sendable {
            var type: String = "tool_update"
            var id: String
            var name: String
            var output: String?
            var details: JSONValue?
        }

        struct ToolEnd: Codable, Hashable, Sendable {
            var type: String = "tool_end"
            var id: String
            var name: String
            var output: String?
            var details: JSONValue?
            var failed: Bool?
        }

        struct QueueUpdate: Codable, Hashable, Sendable {
            var type: String = "queue_update"
            var queue: RuntimeQueue
        }

        struct Question: Codable, Hashable, Sendable {
            var type: String = "question"
            var question: SessionQuestion
        }

        struct Notice: Codable, Hashable, Sendable {
            var type: String = "notice"
            var message: String
            var level: Level
            var recovery: Bool?

            enum Level: RawRepresentable, Codable, Hashable, Sendable {
                case info
                case warning
                case error
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "info": self = .info
                    case "warning": self = .warning
                    case "error": self = .error
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .info: "info"
                    case .warning: "warning"
                    case .error: "error"
                    case .unrecognized(let value): value
                    }
                }
            }
        }

        struct TurnStart: Codable, Hashable, Sendable {
            var type: String = "turn_start"
        }

        struct TurnEnd: Codable, Hashable, Sendable {
            var type: String = "turn_end"
        }

        struct CompactionStart: Codable, Hashable, Sendable {
            var type: String = "compaction_start"
            var reason: CompactionReason
            var blocking: Bool?
            var background: Bool?
        }

        struct CompactionEnd: Codable, Hashable, Sendable {
            var type: String = "compaction_end"
            var reason: CompactionReason
            var outcome: Outcome
            var willRetry: Bool
            var message: String?

            enum Outcome: RawRepresentable, Codable, Hashable, Sendable {
                case done
                case failed
                case cancelled
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "done": self = .done
                    case "failed": self = .failed
                    case "cancelled": self = .cancelled
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .done: "done"
                    case .failed: "failed"
                    case .cancelled: "cancelled"
                    case .unrecognized(let value): value
                    }
                }
            }
        }

        struct Settled: Codable, Hashable, Sendable {
            var type: String = "settled"
            var historyRefreshed: Bool?
        }

        struct ErrorValue: Codable, Hashable, Sendable {
            var type: String = "error"
            var message: String
        }
    }

    struct SessionModelRequest: Codable, Hashable, Sendable {
        var provider: String?
        var modelId: String
    }

    struct SessionModelResponse: Codable, Hashable, Sendable {
        var model: RuntimeModel?

        enum CodingKeys: String, CodingKey {
            case model
        }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(model, forKey: .model)
        }
    }

    struct SessionModelsResponse: Codable, Hashable, Sendable {
        var models: [RuntimeModel]
    }

    struct SessionOpenResponse: Codable, Hashable, Sendable {
        var session: SessionView
        var transcript: [TranscriptEntry]
        var snapshot: SessionSnapshot
    }

    enum SessionQuestion: Codable, Hashable, Sendable {
        case runtimeQuestion(RuntimeQuestion)
        case secret(Secret)
        case questionnaire(Questionnaire)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case method
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .method) {
            case "select", "confirm", "input", "editor": self = try .runtimeQuestion(RuntimeQuestion(from: decoder))
            case "secret": self = try .secret(Secret(from: decoder))
            case "questionnaire": self = try .questionnaire(Questionnaire(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .runtimeQuestion(let value): try value.encode(to: encoder)
            case .secret(let value): try value.encode(to: encoder)
            case .questionnaire(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Secret: Codable, Hashable, Sendable {
            var id: String
            var method: String = "secret"
            var title: String
            var message: String
        }

        struct Questionnaire: Codable, Hashable, Sendable {
            var id: String
            var method: String = "questionnaire"
            var title: String
            var questions: [QuestionnaireQuestion]
        }
    }

    struct SessionSnapshot: Codable, Hashable, Sendable {
        var transcript: [TranscriptEntry]
        var status: SessionStatus
        var model: RuntimeModel?
        var usage: RuntimeUsage?
        var thinking: String?
        var fast: Bool?
        var queue: RuntimeQueue
        var questions: [SessionQuestion]
        var subagents: [SubagentTaskView]
        var suggestions: [TaskSuggestion]?
        var watchers: [Watcher]?
        var compaction: RuntimeCompaction?
    }

    enum SessionStreamFrame: Codable, Hashable, Sendable {
        case snapshot(Snapshot)
        case transcript(Transcript)
        case status(Status)
        case event(Event)
        case model(Model)
        case thinkingLevel(ThinkingLevelValue)
        case fast(Fast)
        case closed(Closed)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case event
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .event) {
            case "snapshot": self = try .snapshot(Snapshot(from: decoder))
            case "transcript": self = try .transcript(Transcript(from: decoder))
            case "status": self = try .status(Status(from: decoder))
            case "event": self = try .event(Event(from: decoder))
            case "model": self = try .model(Model(from: decoder))
            case "thinking_level": self = try .thinkingLevel(ThinkingLevelValue(from: decoder))
            case "fast": self = try .fast(Fast(from: decoder))
            case "closed": self = try .closed(Closed(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .snapshot(let value): try value.encode(to: encoder)
            case .transcript(let value): try value.encode(to: encoder)
            case .status(let value): try value.encode(to: encoder)
            case .event(let value): try value.encode(to: encoder)
            case .model(let value): try value.encode(to: encoder)
            case .thinkingLevel(let value): try value.encode(to: encoder)
            case .fast(let value): try value.encode(to: encoder)
            case .closed(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Snapshot: Codable, Hashable, Sendable {
            var event: String = "snapshot"
            var data: SessionSnapshot
        }

        struct Transcript: Codable, Hashable, Sendable {
            var event: String = "transcript"
            var data: [TranscriptEntry]
        }

        struct Status: Codable, Hashable, Sendable {
            var event: String = "status"
            var data: DataValue

            struct DataValue: Codable, Hashable, Sendable {
                var status: SessionStatus
            }
        }

        struct Event: Codable, Hashable, Sendable {
            var event: String = "event"
            var data: SessionEvent
        }

        struct Model: Codable, Hashable, Sendable {
            var event: String = "model"
            var data: RuntimeModel
        }

        struct ThinkingLevelValue: Codable, Hashable, Sendable {
            var event: String = "thinking_level"
            var data: DataValue

            struct DataValue: Codable, Hashable, Sendable {
                var level: String
            }
        }

        struct Fast: Codable, Hashable, Sendable {
            var event: String = "fast"
            var data: DataValue

            struct DataValue: Codable, Hashable, Sendable {
                var fast: Bool
            }
        }

        struct Closed: Codable, Hashable, Sendable {
            var event: String = "closed"
            var data: [String: JSONValue]
        }
    }

    struct SessionThinkingRequest: Codable, Hashable, Sendable {
        var level: ThinkingLevel
    }

    struct SessionThinkingResponse: Codable, Hashable, Sendable {
        var level: String?

        enum CodingKeys: String, CodingKey {
            case level
        }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(level, forKey: .level)
        }
    }

    struct SideQuestionResult: Codable, Hashable, Sendable {
        var question: String
        var answer: String
        var model: String
    }

    struct SubagentTaskView: Codable, Hashable, Sendable {
        var taskId: String
        var sessionId: String
        var parentSessionId: String
        var title: String
        var task: String
        var status: Status
        var startedAt: String
        var updatedAt: String
        var endedAt: String?
        var summary: String?
        var error: String?

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case starting
            case running
            case completed
            case failed
            case cancelled
            case timedOut
            case interrupted
            case queued
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "starting": self = .starting
                case "running": self = .running
                case "completed": self = .completed
                case "failed": self = .failed
                case "cancelled": self = .cancelled
                case "timed_out": self = .timedOut
                case "interrupted": self = .interrupted
                case "queued": self = .queued
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .starting: "starting"
                case .running: "running"
                case .completed: "completed"
                case .failed: "failed"
                case .cancelled: "cancelled"
                case .timedOut: "timed_out"
                case .interrupted: "interrupted"
                case .queued: "queued"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct TranscriptAttachment: Codable, Hashable, Sendable {
        var name: String
        var kind: Kind
        var mimeType: String?
        var url: String?

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case image
            case file
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "image": self = .image
                case "file": self = .file
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .image: "image"
                case .file: "file"
                case .unrecognized(let value): value
                }
            }
        }
    }

    enum TranscriptEntry: Codable, Hashable, Sendable {
        case message(Message)
        case call(Call)
        case compaction(Compaction)
        case thinking(Thinking)
        case tool(Tool)
        case error(ErrorValue)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case kind
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .kind) {
            case "message": self = try .message(Message(from: decoder))
            case "call": self = try .call(Call(from: decoder))
            case "compaction": self = try .compaction(Compaction(from: decoder))
            case "thinking": self = try .thinking(Thinking(from: decoder))
            case "tool": self = try .tool(Tool(from: decoder))
            case "error": self = try .error(ErrorValue(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .message(let value): try value.encode(to: encoder)
            case .call(let value): try value.encode(to: encoder)
            case .compaction(let value): try value.encode(to: encoder)
            case .thinking(let value): try value.encode(to: encoder)
            case .tool(let value): try value.encode(to: encoder)
            case .error(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Message: Codable, Hashable, Sendable {
            var metrics: TranscriptMetrics?
            var kind: String = "message"
            var role: Role
            var text: String
            var entryId: String?
            var attachments: [TranscriptAttachment]?

            enum Role: RawRepresentable, Codable, Hashable, Sendable {
                case user
                case assistant
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "user": self = .user
                    case "assistant": self = .assistant
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .user: "user"
                    case .assistant: "assistant"
                    case .unrecognized(let value): value
                    }
                }
            }
        }

        struct Call: Codable, Hashable, Sendable {
            var metrics: TranscriptMetrics?
            var kind: String = "call"
            var call: String
            var bot: String?
            var startedAt: Double
            var endedAt: Double
            var summary: String?
            var summaryUnavailable: Bool?
            var lines: [CallRecordLine]
        }

        struct Compaction: Codable, Hashable, Sendable {
            var metrics: TranscriptMetrics?
            var kind: String = "compaction"
            var summary: String
            var tokensBefore: Double
        }

        struct Thinking: Codable, Hashable, Sendable {
            var metrics: TranscriptMetrics?
            var kind: String = "thinking"
            var text: String
        }

        struct Tool: Codable, Hashable, Sendable {
            var metrics: TranscriptMetrics?
            var kind: String = "tool"
            var id: String
            var name: String
            var args: JSONValue?
            var output: String?
            var details: JSONValue?
            var failed: Bool?
        }

        struct ErrorValue: Codable, Hashable, Sendable {
            var metrics: TranscriptMetrics?
            var kind: String = "error"
            var message: String
        }
    }
}
