// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct WorkerActionResponse: Codable, Hashable, Sendable {
        var ok: Bool = true
    }

    struct WorkerError: Codable, Hashable, Sendable {
        var error: String
    }

    struct WorkerInput: Codable, Hashable, Sendable {
        var name: String
        var command: String
        var extraPaths: [String]?
    }

    struct WorkerPatch: Codable, Hashable, Sendable {
        var name: String?
        var command: String?
        var extraPaths: [String]?
    }

    struct WorkerResponse: Codable, Hashable, Sendable {
        var worker: WorkerView
    }

    enum WorkerState: RawRepresentable, Codable, Hashable, Sendable {
        case disconnected
        case connecting
        case connected
        case error
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "disconnected": self = .disconnected
            case "connecting": self = .connecting
            case "connected": self = .connected
            case "error": self = .error
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .disconnected: "disconnected"
            case .connecting: "connecting"
            case .connected: "connected"
            case .error: "error"
            case .unrecognized(let value): value
            }
        }
    }

    struct WorkerView: Codable, Hashable, Sendable {
        var id: String
        var name: String
        var command: String
        var extraPaths: [String]
        var state: WorkerState
        var phase: String?
        var error: String?
        var host: Host?
        var sync: Sync?

        struct Host: Codable, Hashable, Sendable {
            var hostname: String
            var platform: String
            var arch: String
            var node: String
            var home: String
            var release: String
        }

        struct Sync: Codable, Hashable, Sendable {
            var at: String
            var files: Double
            var uploaded: Double
            var deleted: Double
            var installed: [String]
            var skipped: [String]
            var errors: [String]
        }
    }

    struct WorkersResponse: Codable, Hashable, Sendable {
        var workers: [WorkerView]
    }
}
