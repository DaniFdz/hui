// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct Watcher: Codable, Hashable, Sendable {
        var id: String
        var purpose: String
        var target: String
        var outcome: String
        var command: String
        var logPath: String
        var state: WatcherState
        var pid: Double?
        var exitCode: Double?
        var startedAt: String
        var endedAt: String?
        var lastLine: String
        var keepRunning: Bool?
    }

    struct WatcherError: Codable, Hashable, Sendable {
        var error: String
    }

    struct WatcherLog: Codable, Hashable, Sendable {
        var id: String
        var lines: [String]
        var truncated: Bool
    }

    enum WatcherState: RawRepresentable, Codable, Hashable, Sendable {
        case running
        case done
        case failed
        case stopped
        case dead
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "running": self = .running
            case "done": self = .done
            case "failed": self = .failed
            case "stopped": self = .stopped
            case "dead": self = .dead
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .running: "running"
            case .done: "done"
            case .failed: "failed"
            case .stopped: "stopped"
            case .dead: "dead"
            case .unrecognized(let value): value
            }
        }
    }

    struct WatchersResponse: Codable, Hashable, Sendable {
        var watchers: [Watcher]
    }
}
