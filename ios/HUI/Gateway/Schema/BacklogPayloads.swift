// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct BacklogBranchNameRequest: Codable, Hashable, Sendable {
        var cwd: String
    }

    struct BacklogError: Codable, Hashable, Sendable {
        var error: String
    }

    struct BacklogGroupRequest: Codable, Hashable, Sendable {
        var group: String
    }

    struct BacklogItem: Codable, Hashable, Sendable {
        var id: String
        var kind: BacklogItemKind
        var title: String
        var group: String
        var cwd: String?
        var problem: String?
        var fix: String?
        var createdAt: String?
        var jira: SessionJiraIssue?
    }

    enum BacklogItemKind: RawRepresentable, Codable, Hashable, Sendable {
        case jira
        case local
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "jira": self = .jira
            case "local": self = .local
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .jira: "jira"
            case .local: "local"
            case .unrecognized(let value): value
            }
        }
    }

    struct BacklogJiraCreateRequest: Codable, Hashable, Sendable {
        var project: String
        var parent: String
        var summary: String
        var description: String
        var assignToMe: Bool?
    }

    struct BacklogJiraDraftRequest: Codable, Hashable, Sendable {
        var project: String?
    }

    struct BacklogJiraResponse: Codable, Hashable, Sendable {
        var issue: JiraIssueRef
        var backlog: BacklogView
        var warning: String?
    }

    enum BacklogJiraState: Codable, Hashable, Sendable {
        case ok(Ok)
        case unconfigured(Unconfigured)
        case unavailable(Unavailable)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case status
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .status) {
            case "ok": self = try .ok(Ok(from: decoder))
            case "unconfigured": self = try .unconfigured(Unconfigured(from: decoder))
            case "unavailable": self = try .unavailable(Unavailable(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .ok(let value): try value.encode(to: encoder)
            case .unconfigured(let value): try value.encode(to: encoder)
            case .unavailable(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Ok: Codable, Hashable, Sendable {
            var status: String = "ok"
        }

        struct Unconfigured: Codable, Hashable, Sendable {
            var status: String = "unconfigured"
        }

        struct Unavailable: Codable, Hashable, Sendable {
            var status: String = "unavailable"
            var message: String
        }
    }

    struct BacklogStartInput: Codable, Hashable, Sendable {
        var cwd: String
        var worktree: Bool
        var branchName: String?
        var baseRef: String?
        var stage: SessionStage
        var group: String
    }

    struct BacklogStartResponse: Codable, Hashable, Sendable {
        var session: SessionView
        var backlog: BacklogView
    }

    struct BacklogView: Codable, Hashable, Sendable {
        var items: [BacklogItem]
        var jira: BacklogJiraState
    }

    struct SuggestedBranchName: Codable, Hashable, Sendable {
        var name: String
        var source: Source

        enum Source: RawRepresentable, Codable, Hashable, Sendable {
            case model
            case fallback
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "model": self = .model
                case "fallback": self = .fallback
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .model: "model"
                case .fallback: "fallback"
                case .unrecognized(let value): value
                }
            }
        }
    }
}
