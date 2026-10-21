// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct ReleaseInfo: Codable, Hashable, Sendable {
        var version: String
        var tag: String
        var url: String
    }

    struct UpdateCheck: Codable, Hashable, Sendable {
        var currentVersion: String?
        var latest: ReleaseInfo?
        var status: Status
        var canInstall: Bool
        var message: String

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case available
            case current
            case unpublished
            case unavailable
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "available": self = .available
                case "current": self = .current
                case "unpublished": self = .unpublished
                case "unavailable": self = .unavailable
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .available: "available"
                case .current: "current"
                case .unpublished: "unpublished"
                case .unavailable: "unavailable"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct UpdateError: Codable, Hashable, Sendable {
        var error: String
    }

    struct UpdateJob: Codable, Hashable, Sendable {
        var id: String
        var pid: Double
        var status: Status
        var version: String
        var message: String

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case running
            case succeeded
            case failed
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "running": self = .running
                case "succeeded": self = .succeeded
                case "failed": self = .failed
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .running: "running"
                case .succeeded: "succeeded"
                case .failed: "failed"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct UpdateRequest: Codable, Hashable, Sendable {
        var version: String
    }

    struct UpdateSnapshot: Codable, Hashable, Sendable {
        var currentVersion: String?
        var check: UpdateCheck?
        var job: UpdateJob?
    }
}
