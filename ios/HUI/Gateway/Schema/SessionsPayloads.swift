// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    enum JiraStatusCategory: RawRepresentable, Codable, Hashable, Sendable {
        case new
        case indeterminate
        case done
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "new": self = .new
            case "indeterminate": self = .indeterminate
            case "done": self = .done
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .new: "new"
            case .indeterminate: "indeterminate"
            case .done: "done"
            case .unrecognized(let value): value
            }
        }
    }

    struct ProgressCard: Codable, Hashable, Sendable {
        var markdown: String
        var steps: [ProgressStep]
    }

    struct ProgressStep: Codable, Hashable, Sendable {
        var step: String
        var status: Status

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case pending
            case inProgress
            case completed
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "pending": self = .pending
                case "in_progress": self = .inProgress
                case "completed": self = .completed
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .pending: "pending"
                case .inProgress: "in_progress"
                case .completed: "completed"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct QuestionnaireAnswer: Codable, Hashable, Sendable {
        var header: String
        var question: String
        var selected: [String]
        var preview: String?
    }

    struct QuestionnaireOption: Codable, Hashable, Sendable {
        var label: String
        var description: String
        var preview: String?
    }

    struct QuestionnaireQuestion: Codable, Hashable, Sendable {
        var header: String
        var question: String
        var multiSelect: Bool
        var options: [QuestionnaireOption]
    }

    struct QuestionnaireResult: Codable, Hashable, Sendable {
        var cancelled: Bool
        var answers: [QuestionnaireAnswer]
        var timedOut: Bool?
        var timeoutMinutes: Double?
    }

    struct SessionConnectResponse: Codable, Hashable, Sendable {
        var url: String
    }

    struct SessionError: Codable, Hashable, Sendable {
        var error: String
    }

    struct SessionFastResponse: Codable, Hashable, Sendable {
        var fast: Bool
    }

    struct SessionGroup: Codable, Hashable, Sendable {
        var label: String
        var cwd: String?
        var workspaceMode: WorkspaceMode?
        var baseRef: String?
        var sessions: [SessionView]

        enum WorkspaceMode: RawRepresentable, Codable, Hashable, Sendable {
            case branch
            case worktree
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "branch": self = .branch
                case "worktree": self = .worktree
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .branch: "branch"
                case .worktree: "worktree"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct SessionJiraIssue: Codable, Hashable, Sendable {
        var key: String
        var url: String
        var summary: String?
        var status: String?
        var statusCategory: JiraStatusCategory?
        var issueType: String?
        var description: String?
    }

    struct SessionList: Codable, Hashable, Sendable {
        var revision: Double
        var groups: [SessionGroup]
    }

    struct SessionListLayoutGroup: Codable, Hashable, Sendable {
        var label: String
        var cwd: String?
        var workspaceMode: WorkspaceMode?
        var baseRef: String?
        var ids: [String]

        enum WorkspaceMode: RawRepresentable, Codable, Hashable, Sendable {
            case branch
            case worktree
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "branch": self = .branch
                case "worktree": self = .worktree
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .branch: "branch"
                case .worktree: "worktree"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct SessionListUpdate: Codable, Hashable, Sendable {
        var revision: Double
        var groups: [SessionListLayoutGroup]?
        var upserts: [SessionView]
    }

    struct SessionOk: Codable, Hashable, Sendable {
        var ok: Bool = true
    }

    struct SessionPromptResponse: Codable, Hashable, Sendable {
        var ok: Bool = true
        var duplicate: Bool?
    }

    enum SessionQueueRequest: Codable, Hashable, Sendable {
        case edit(Edit)
        case remove(Remove)
        case move(Move)
        case steer(Steer)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case operation
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .operation) {
            case "edit": self = try .edit(Edit(from: decoder))
            case "remove": self = try .remove(Remove(from: decoder))
            case "move": self = try .move(Move(from: decoder))
            case "steer": self = try .steer(Steer(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .edit(let value): try value.encode(to: encoder)
            case .remove(let value): try value.encode(to: encoder)
            case .move(let value): try value.encode(to: encoder)
            case .steer(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Edit: Codable, Hashable, Sendable {
            var operation: String = "edit"
            var itemId: String
            var text: String
        }

        struct Remove: Codable, Hashable, Sendable {
            var operation: String = "remove"
            var itemId: String
        }

        struct Move: Codable, Hashable, Sendable {
            var operation: String = "move"
            var itemId: String
            var toIndex: Double
        }

        struct Steer: Codable, Hashable, Sendable {
            var operation: String = "steer"
            var itemId: String
        }
    }

    struct SessionResponse: Codable, Hashable, Sendable {
        var session: SessionView
    }

    struct SessionSearchResult: Codable, Hashable, Sendable {
        var hits: [HitsItem]
        var unsearched: [UnsearchedItem]

        struct HitsItem: Codable, Hashable, Sendable {
            var id: String
            var snippet: String
            var matches: Double
        }

        struct UnsearchedItem: Codable, Hashable, Sendable {
            var worker: String
            var error: String
        }
    }

    enum SessionStage: RawRepresentable, Codable, Hashable, Sendable {
        case investigation
        case implementation
        case testing
        case done
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "investigation": self = .investigation
            case "implementation": self = .implementation
            case "testing": self = .testing
            case "done": self = .done
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .investigation: "investigation"
            case .implementation: "implementation"
            case .testing: "testing"
            case .done: "done"
            case .unrecognized(let value): value
            }
        }
    }

    enum SessionStageOrigin: RawRepresentable, Codable, Hashable, Sendable {
        case `operator`
        case agent
        case pullRequest
        case `default`
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "operator": self = .`operator`
            case "agent": self = .agent
            case "pullRequest": self = .pullRequest
            case "default": self = .`default`
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .`operator`: "operator"
            case .agent: "agent"
            case .pullRequest: "pullRequest"
            case .`default`: "default"
            case .unrecognized(let value): value
            }
        }
    }

    enum SessionStageSource: RawRepresentable, Codable, Hashable, Sendable {
        case `operator`
        case agent
        case pullRequest
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "operator": self = .`operator`
            case "agent": self = .agent
            case "pullRequest": self = .pullRequest
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .`operator`: "operator"
            case .agent: "agent"
            case .pullRequest: "pullRequest"
            case .unrecognized(let value): value
            }
        }
    }

    enum SessionStatus: RawRepresentable, Codable, Hashable, Sendable {
        case idle
        case running
        case waiting
        case starting
        case error
        case reconnecting
        case disconnected
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "idle": self = .idle
            case "running": self = .running
            case "waiting": self = .waiting
            case "starting": self = .starting
            case "error": self = .error
            case "reconnecting": self = .reconnecting
            case "disconnected": self = .disconnected
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .idle: "idle"
            case .running: "running"
            case .waiting: "waiting"
            case .starting: "starting"
            case .error: "error"
            case .reconnecting: "reconnecting"
            case .disconnected: "disconnected"
            case .unrecognized(let value): value
            }
        }
    }

    enum SessionStatusStreamFrame: Codable, Hashable, Sendable {
        case snapshot(Snapshot)
        case status(Status)
        case sessions(Sessions)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case event
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .event) {
            case "snapshot": self = try .snapshot(Snapshot(from: decoder))
            case "status": self = try .status(Status(from: decoder))
            case "sessions": self = try .sessions(Sessions(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .snapshot(let value): try value.encode(to: encoder)
            case .status(let value): try value.encode(to: encoder)
            case .sessions(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Snapshot: Codable, Hashable, Sendable {
            var event: String = "snapshot"
            var data: DataValue

            struct DataValue: Codable, Hashable, Sendable {
                var statuses: [SessionStatusUpdate]
            }
        }

        struct Status: Codable, Hashable, Sendable {
            var event: String = "status"
            var data: SessionStatusUpdate
        }

        struct Sessions: Codable, Hashable, Sendable {
            var event: String = "sessions"
            var data: SessionListUpdate
        }
    }

    struct SessionStatusUpdate: Codable, Hashable, Sendable {
        var id: String
        var status: SessionStatus
        var unread: Bool?
        var creating: WorktreeProgress?
        var creationError: String?
        var title: String?
    }

    struct SessionSubagent: Codable, Hashable, Sendable {
        var taskId: String
        var task: String
        var label: String?
        var status: SubagentStatus
        var startedAt: String
        var updatedAt: String
        var endedAt: String?
        var summary: String?
        var error: String?
        var completionDelivery: CompletionDelivery?
        var collect: Bool?

        enum CompletionDelivery: RawRepresentable, Codable, Hashable, Sendable {
            case pending
            case delivered
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "pending": self = .pending
                case "delivered": self = .delivered
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .pending: "pending"
                case .delivered: "delivered"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct SessionView: Codable, Hashable, Sendable {
        var progress: ProgressCard?
        var pullRequests: [SessionPullRequest]?
        var jiraIssues: [SessionJiraIssue]?
        var id: String
        var title: String
        var group: String
        var cwd: String
        var displayCwd: String
        var worker: Worker?
        var tool: String
        var status: SessionStatus
        var creating: WorktreeProgress?
        var creationError: String?
        var initialPrompt: String?
        var runtime: Runtime?
        var interrupted: Bool?
        var background: Bool?
        var model: String?
        var thinking: String?
        var pinned: Bool?
        var archived: Bool?
        var unread: Bool?
        var icon: String?
        var parentId: String?
        var subagent: SessionSubagent?
        var bot: Bot?
        var stage: SessionStage
        var stageOrigin: SessionStageOrigin
        var createdAt: String
        var updatedAt: String

        struct Worker: Codable, Hashable, Sendable {
            var id: String
            var name: String
        }

        struct Runtime: Codable, Hashable, Sendable {
            var active: Bool = true
            var memoryBytes: Double?
            var bootDurationMs: Double?
        }

        struct Bot: Codable, Hashable, Sendable {
            var id: String
            var handle: String
            var name: String
        }
    }

    enum SubagentStatus: RawRepresentable, Codable, Hashable, Sendable {
        case starting
        case running
        case completed
        case failed
        case cancelled
        case timedOut
        case interrupted
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
            case .unrecognized(let value): value
            }
        }
    }

    enum ThinkingLevel: RawRepresentable, Codable, Hashable, Sendable {
        case off
        case minimal
        case low
        case medium
        case high
        case xhigh
        case max
        case ultra
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "off": self = .off
            case "minimal": self = .minimal
            case "low": self = .low
            case "medium": self = .medium
            case "high": self = .high
            case "xhigh": self = .xhigh
            case "max": self = .max
            case "ultra": self = .ultra
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .off: "off"
            case .minimal: "minimal"
            case .low: "low"
            case .medium: "medium"
            case .high: "high"
            case .xhigh: "xhigh"
            case .max: "max"
            case .ultra: "ultra"
            case .unrecognized(let value): value
            }
        }
    }

    struct TranscriptMetrics: Codable, Hashable, Sendable {
        var timestamp: Double?
        var completedAt: Double?
        var durationMs: Double?
        var inputTokens: Double?
        var outputTokens: Double?
        var cacheReadTokens: Double?
        var cacheWriteTokens: Double?
        var costUsd: Double?
    }

    struct WorktreeProgress: Codable, Hashable, Sendable {
        var phase: Phase
        var percent: Double?
        var completed: Double?
        var total: Double?

        enum Phase: RawRepresentable, Codable, Hashable, Sendable {
            case naming
            case preparing
            case checkout
            case filtering
            case finalizing
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "naming": self = .naming
                case "preparing": self = .preparing
                case "checkout": self = .checkout
                case "filtering": self = .filtering
                case "finalizing": self = .finalizing
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .naming: "naming"
                case .preparing: "preparing"
                case .checkout: "checkout"
                case .filtering: "filtering"
                case .finalizing: "finalizing"
                case .unrecognized(let value): value
                }
            }
        }
    }
}
