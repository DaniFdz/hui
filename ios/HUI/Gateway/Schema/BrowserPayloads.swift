// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct BrowserControl: Codable, Hashable, Sendable {
        var action: Action

        enum Action: RawRepresentable, Codable, Hashable, Sendable {
            case start
            case stop
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "start": self = .start
                case "stop": self = .stop
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .start: "start"
                case .stop: "stop"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BrowserError: Codable, Hashable, Sendable {
        var error: String
    }

    struct BrowserExecutableView: Codable, Hashable, Sendable {
        var path: String
        var name: String
        var source: Source

        enum Source: RawRepresentable, Codable, Hashable, Sendable {
            case configured
            case detected
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "configured": self = .configured
                case "detected": self = .detected
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .configured: "configured"
                case .detected: "detected"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BrowserPreview: Codable, Hashable, Sendable {
        var image: String
    }

    enum BrowserState: RawRepresentable, Codable, Hashable, Sendable {
        case stopped
        case starting
        case running
        case stopping
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "stopped": self = .stopped
            case "starting": self = .starting
            case "running": self = .running
            case "stopping": self = .stopping
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .stopped: "stopped"
            case .starting: "starting"
            case .running: "running"
            case .stopping: "stopping"
            case .unrecognized(let value): value
            }
        }
    }

    struct BrowserStatus: Codable, Hashable, Sendable {
        var enabled: Bool
        var headless: Bool
        var executablePath: String
        var executable: BrowserExecutableView?
        var executableError: String
        var state: BrowserState
        var mode: Mode?
        var version: String?
        var startedAt: String?
        var profileDir: String
        var lastError: String
        var tabs: [BrowserTabView]

        enum Mode: RawRepresentable, Codable, Hashable, Sendable {
            case headless
            case windowed
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "headless": self = .headless
                case "windowed": self = .windowed
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .headless: "headless"
                case .windowed: "windowed"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BrowserTabView: Codable, Hashable, Sendable {
        var id: String
        var ownerSessionId: String
        var ownerTitle: String
        var title: String
        var url: String
    }

    struct BrowserViewAction: Codable, Hashable, Sendable {
        var tabId: String
        var text: String
        var point: Point?
        var at: String

        struct Point: Codable, Hashable, Sendable {
            var x: Double
            var y: Double
        }
    }

    struct BrowserViewConnection: Codable, Hashable, Sendable {
        var url: String
    }

    struct BrowserViewControl: Codable, Hashable, Sendable {
        var action: String = "select"
        var tabId: String?
    }

    enum BrowserViewMessage: Codable, Hashable, Sendable {
        case state(State)
        case action(Action)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case type
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .type) {
            case "state": self = try .state(State(from: decoder))
            case "action": self = try .action(Action(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .state(let value): try value.encode(to: encoder)
            case .action(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct State: Codable, Hashable, Sendable {
            var type: String = "state"
            var running: Bool
            var mode: Mode?
            var tabs: [BrowserViewTab]
            var current: String?
            var watching: String?
            var following: Bool

            enum Mode: RawRepresentable, Codable, Hashable, Sendable {
                case headless
                case windowed
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "headless": self = .headless
                    case "windowed": self = .windowed
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .headless: "headless"
                    case .windowed: "windowed"
                    case .unrecognized(let value): value
                    }
                }
            }
        }

        struct Action: Codable, Hashable, Sendable {
            var type: String = "action"
            var tabId: String
            var text: String
            var point: Point?
            var at: String

            struct Point: Codable, Hashable, Sendable {
                var x: Double
                var y: Double
            }
        }
    }

    struct BrowserViewState: Codable, Hashable, Sendable {
        var running: Bool
        var mode: Mode?
        var tabs: [BrowserViewTab]
        var current: String?
        var watching: String?
        var following: Bool

        enum Mode: RawRepresentable, Codable, Hashable, Sendable {
            case headless
            case windowed
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "headless": self = .headless
                case "windowed": self = .windowed
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .headless: "headless"
                case .windowed: "windowed"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BrowserViewTab: Codable, Hashable, Sendable {
        var id: String
        var title: String
        var url: String
    }
}
