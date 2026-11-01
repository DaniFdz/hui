// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct BotTrigger: Codable, Hashable, Sendable {
        var id: String
        var botId: String
        var name: String
        var source: BotTriggerSource
        var filter: BotTriggerFilter
        var prompt: String?
        var delivery: Delivery?
        var enabled: Bool
        var cooldownSeconds: Double
        var createdBy: CreatedBy
        var createdAt: String
        var updatedAt: String
        var lastFiredAt: String?
        var tokenHint: String?
        var pending: Pending?
        var watch: Watch?

        enum Delivery: RawRepresentable, Codable, Hashable, Sendable {
            case followUp
            case steer
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "followUp": self = .followUp
                case "steer": self = .steer
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .followUp: "followUp"
                case .steer: "steer"
                case .unrecognized(let value): value
                }
            }
        }

        enum CreatedBy: RawRepresentable, Codable, Hashable, Sendable {
            case `operator`
            case bot
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "operator": self = .`operator`
                case "bot": self = .bot
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .`operator`: "operator"
                case .bot: "bot"
                case .unrecognized(let value): value
                }
            }
        }

        struct Pending: Codable, Hashable, Sendable {
            var events: Double
            var until: String
        }

        struct Watch: Codable, Hashable, Sendable {
            var polledAt: String?
            var error: String?
        }
    }

    struct BotTriggerCreated: Codable, Hashable, Sendable {
        var trigger: BotTrigger
        var hook: Hook

        struct Hook: Codable, Hashable, Sendable {
            var token: String
            var path: String
        }
    }

    struct BotTriggerDeleted: Codable, Hashable, Sendable {
        var ok: Bool = true
    }

    struct BotTriggerFilter: Codable, Hashable, Sendable {
        var match: TriggerMatch?
        var prLinks: Bool?
        var bots: Bool?
        var external: Bool?
    }

    struct BotTriggerInput: Codable, Hashable, Sendable {
        var name: String
        var source: BotTriggerSource
        var filter: BotTriggerFilter
        var prompt: String?
        var delivery: Delivery?
        var enabled: Bool?
        var cooldownSeconds: Double?

        enum Delivery: RawRepresentable, Codable, Hashable, Sendable {
            case followUp
            case steer
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "followUp": self = .followUp
                case "steer": self = .steer
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .followUp: "followUp"
                case .steer: "steer"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BotTriggerPatch: Codable, Hashable, Sendable {
        var name: String?
        var prompt: String?
        var delivery: Delivery?
        var enabled: Bool?
        var cooldownSeconds: Double?
        var filter: [String: JSONValue]?

        enum Delivery: RawRepresentable, Codable, Hashable, Sendable {
            case followUp
            case steer
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "followUp": self = .followUp
                case "steer": self = .steer
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .followUp: "followUp"
                case .steer: "steer"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BotTriggerResponse: Codable, Hashable, Sendable {
        var trigger: BotTrigger
    }

    struct BotTriggerRun: Codable, Hashable, Sendable {
        var id: String
        var triggerId: String
        var triggerName: String
        var at: String
        var status: BotTriggerRunStatus
        var events: Double
        var summary: String
        var reason: String?
        var test: Bool?
        var catchUp: Bool?
    }

    struct BotTriggerRunResponse: Codable, Hashable, Sendable {
        var run: BotTriggerRun
    }

    enum BotTriggerRunStatus: RawRepresentable, Codable, Hashable, Sendable {
        case fired
        case coalesced
        case skipped
        case failed
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "fired": self = .fired
            case "coalesced": self = .coalesced
            case "skipped": self = .skipped
            case "failed": self = .failed
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .fired: "fired"
            case .coalesced: "coalesced"
            case .skipped: "skipped"
            case .failed: "failed"
            case .unrecognized(let value): value
            }
        }
    }

    typealias BotTriggerSource = String

    struct BotTriggersList: Codable, Hashable, Sendable {
        var triggers: [BotTrigger]
        var runs: [BotTriggerRun]
        var deliveries: Deliveries

        struct Deliveries: Codable, Hashable, Sendable {
            var lastHour: Double
            var perHour: Double
        }
    }

    struct TriggerMatch: Codable, Hashable, Sendable {
        var field: String
        var op: Op
        var value: String

        enum Op: RawRepresentable, Codable, Hashable, Sendable {
            case equals
            case contains
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "equals": self = .equals
                case "contains": self = .contains
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .equals: "equals"
                case .contains: "contains"
                case .unrecognized(let value): value
                }
            }
        }
    }
}
