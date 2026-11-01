// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct MemorySource: Codable, Hashable, Sendable {
        var workspace: String
        var path: String
        var relativePath: String
        var kind: Kind
        var bytes: Double
        var modifiedAt: String

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case context
            case memory
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "context": self = .context
                case "memory": self = .memory
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .context: "context"
                case .memory: "memory"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct WorkspaceInspection: Codable, Hashable, Sendable {
        var workspaces: [String]
        var memory: [MemorySource]
        var worktrees: [WorktreeView]
        var diagnostics: [String]
    }

    struct WorktreeError: Codable, Hashable, Sendable {
        var error: String
    }

    struct WorktreeInventory: Codable, Hashable, Sendable {
        var worktrees: [WorktreeRow]
        var diagnostics: [String]
        var pending: Bool
    }

    enum WorktreeRemovalMode: RawRepresentable, Codable, Hashable, Sendable {
        case single
        case merged
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "single": self = .single
            case "merged": self = .merged
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .single: "single"
            case .merged: "merged"
            case .unrecognized(let value): value
            }
        }
    }

    struct WorktreeRemovalRequest: Codable, Hashable, Sendable {
        var paths: [String]
        var mode: WorktreeRemovalMode
        var acknowledged: [WorktreeRisk]?
    }

    struct WorktreeRemovalResponse: Codable, Hashable, Sendable {
        var results: [WorktreeRemovalResult]
        var inventory: WorktreeInventory
    }

    struct WorktreeRemovalResult: Codable, Hashable, Sendable {
        var path: String
        var label: String
        var removed: Bool
        var branchDeleted: Bool
        var error: String?
    }

    enum WorktreeRisk: RawRepresentable, Codable, Hashable, Sendable {
        case dirty
        case unknown
        case locked
        case running
        case missing
        case external
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "dirty": self = .dirty
            case "unknown": self = .unknown
            case "locked": self = .locked
            case "running": self = .running
            case "missing": self = .missing
            case "external": self = .external
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .dirty: "dirty"
            case .unknown: "unknown"
            case .locked: "locked"
            case .running: "running"
            case .missing: "missing"
            case .external: "external"
            case .unrecognized(let value): value
            }
        }
    }

    struct WorktreeRow: Codable, Hashable, Sendable {
        var repository: String
        var path: String
        var displayPath: String
        var branch: String
        var head: String
        var detached: Bool
        var managed: Bool
        var sessions: [WorktreeSessionRef]
        var pullRequests: [SessionPullRequest]?
        var dirty: Bool?
        var bytes: Double?
        var merged: Bool
        var risks: [WorktreeRisk]
        var unavailable: [UnavailableItem]?
        var removal: Removal?
        var remainingBytes: Double?

        enum UnavailableItem: RawRepresentable, Codable, Hashable, Sendable {
            case pullRequests
            case dirty
            case bytes
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "pullRequests": self = .pullRequests
                case "dirty": self = .dirty
                case "bytes": self = .bytes
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .pullRequests: "pullRequests"
                case .dirty: "dirty"
                case .bytes: "bytes"
                case .unrecognized(let value): value
                }
            }
        }

        enum Removal: RawRepresentable, Codable, Hashable, Sendable {
            case queued
            case removing
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "queued": self = .queued
                case "removing": self = .removing
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .queued: "queued"
                case .removing: "removing"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct WorktreeSessionRef: Codable, Hashable, Sendable {
        var id: String
        var title: String
        var archived: Bool
    }

    struct WorktreeView: Codable, Hashable, Sendable {
        var repository: String
        var path: String
        var branch: String
        var head: String
        var bare: Bool
        var detached: Bool
        var sessionIds: [String]
    }
}
