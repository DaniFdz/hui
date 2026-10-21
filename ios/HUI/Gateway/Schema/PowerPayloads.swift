// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct PowerError: Codable, Hashable, Sendable {
        var error: String
    }

    struct PowerRequest: Codable, Hashable, Sendable {
        var lidAwake: Bool
    }

    struct PowerResponse: Codable, Hashable, Sendable {
        var power: PowerStatus?
    }

    struct PowerState: Codable, Hashable, Sendable {
        var state: State
        var detail: String

        enum State: RawRepresentable, Codable, Hashable, Sendable {
            case off
            case pending
            case active
            case error
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "off": self = .off
                case "pending": self = .pending
                case "active": self = .active
                case "error": self = .error
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .off: "off"
                case .pending: "pending"
                case .active: "active"
                case .error: "error"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct PowerStatus: Codable, Hashable, Sendable {
        var keepAwake: PowerState
        var lidAwake: PowerState
        var lidOn: Bool
    }
}
