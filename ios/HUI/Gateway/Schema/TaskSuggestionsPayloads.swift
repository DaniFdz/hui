// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct TaskSuggestion: Codable, Hashable, Sendable {
        var id: String
        var title: String
        var problem: String
        var fix: String
        var cwd: String
        var worker: String?
        var createdAt: String
    }

    struct TaskSuggestionBacklogResponse: Codable, Hashable, Sendable {
        var taskId: String
        var suggestions: [TaskSuggestion]
    }

    struct TaskSuggestionError: Codable, Hashable, Sendable {
        var error: String
    }

    enum TaskSuggestionStartMode: RawRepresentable, Codable, Hashable, Sendable {
        case session
        case worktree
        case current
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "session": self = .session
            case "worktree": self = .worktree
            case "current": self = .current
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .session: "session"
            case .worktree: "worktree"
            case .current: "current"
            case .unrecognized(let value): value
            }
        }
    }

    struct TaskSuggestionStartRequest: Codable, Hashable, Sendable {
        var mode: TaskSuggestionStartMode?
    }

    struct TaskSuggestionStartResponse: Codable, Hashable, Sendable {
        var session: SessionView
        var suggestions: [TaskSuggestion]
    }

    struct TaskSuggestionsResponse: Codable, Hashable, Sendable {
        var suggestions: [TaskSuggestion]
    }
}
