// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    enum DiagnosticArea: RawRepresentable, Codable, Hashable, Sendable {
        case gateway
        case session
        case runtime
        case automation
        case ui
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "gateway": self = .gateway
            case "session": self = .session
            case "runtime": self = .runtime
            case "automation": self = .automation
            case "ui": self = .ui
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .gateway: "gateway"
            case .session: "session"
            case .runtime: "runtime"
            case .automation: "automation"
            case .ui: "ui"
            case .unrecognized(let value): value
            }
        }
    }

    struct DiagnosticEvent: Codable, Hashable, Sendable {
        var id: Double
        var timestamp: String
        var area: DiagnosticArea
        var level: DiagnosticLevel
        var action: String
        var summary: String
        var detail: String?
        var sessionId: String?
    }

    enum DiagnosticLevel: RawRepresentable, Codable, Hashable, Sendable {
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

    struct DiagnosticsError: Codable, Hashable, Sendable {
        var error: String
    }

    struct GatewayHealth: Codable, Hashable, Sendable {
        var status: String = "online"
        var transport: String = "HTTP + SSE"
        var uptimeSeconds: Double
        var access: String = "Full Access"
        var sessions: Sessions

        struct Sessions: Codable, Hashable, Sendable {
            var idle: Double
            var running: Double
            var waiting: Double
            var starting: Double
            var error: Double
            var reconnecting: Double
            var disconnected: Double
            var registered: Double
            var processes: Double
        }
    }

    struct ObservabilitySnapshot: Codable, Hashable, Sendable {
        var generatedAt: String
        var retention: Retention
        var activity: [DiagnosticEvent]
        var logs: [DiagnosticEvent]
        var usage: UsageTotals
        var debug: Debug

        struct Retention: Codable, Hashable, Sendable {
            var kind: String = "memory"
            var maximum: Double
            var since: String
        }

        struct Debug: Codable, Hashable, Sendable {
            var node: String
            var platform: String
            var uptimeSeconds: Double
            var memory: Memory
            var eventCount: Double

            struct Memory: Codable, Hashable, Sendable {
                var rssBytes: Double
                var heapUsedBytes: Double
                var heapTotalBytes: Double
            }
        }
    }

    struct UiErrorBatch: Codable, Hashable, Sendable {
        var reports: [UiErrorReport]
        var suppressed: Double
    }

    struct UiErrorBatchRequest: Codable, Hashable, Sendable {
        var reports: [ReportsItem]
        var suppressed: Double?

        struct ReportsItem: Codable, Hashable, Sendable {
            var kind: UiErrorKind
            var message: String
            var count: Double?
            var firstAt: String?
            var lastAt: String?
            var location: String?
            var page: String?
            var request: Request?

            struct Request: Codable, Hashable, Sendable {
                var method: String
                var path: String
            }
        }
    }

    enum UiErrorKind: RawRepresentable, Codable, Hashable, Sendable {
        case uncaughtError
        case unhandledRejection
        case requestFailed
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "uncaught_error": self = .uncaughtError
            case "unhandled_rejection": self = .unhandledRejection
            case "request_failed": self = .requestFailed
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .uncaughtError: "uncaught_error"
            case .unhandledRejection: "unhandled_rejection"
            case .requestFailed: "request_failed"
            case .unrecognized(let value): value
            }
        }
    }

    struct UiErrorReceipt: Codable, Hashable, Sendable {
        var recorded: Double
        var dropped: Double
    }

    struct UiErrorReport: Codable, Hashable, Sendable {
        var kind: UiErrorKind
        var message: String
        var count: Double
        var firstAt: String?
        var lastAt: String?
        var location: String?
        var page: String?
        var request: Request?

        struct Request: Codable, Hashable, Sendable {
            var method: String
            var path: String
        }
    }

    struct UsageTotals: Codable, Hashable, Sendable {
        var sessions: Double
        var filesRead: Double
        var records: Double
        var inputTokens: Double
        var outputTokens: Double
        var cacheReadTokens: Double
        var cacheWriteTokens: Double
        var totalTokens: Double
        var costUsd: Double?
        var models: [ModelsItem]
        var unavailable: [String]

        struct ModelsItem: Codable, Hashable, Sendable {
            var model: String
            var tokens: Double
        }
    }
}
