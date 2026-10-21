// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct RuntimeInspection: Codable, Hashable, Sendable {
        var status: String = "live"
        var backend: String
        var version: String
        var revision: String
        var tools: [RuntimeTool]
        var prompt: String
        var promptPhase: PromptPhase
        var promptSource: String
        var diagnostics: [String]

        enum PromptPhase: RawRepresentable, Codable, Hashable, Sendable {
            case initialized
            case currentTurn
            case lastTurn
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "initialized": self = .initialized
                case "current-turn": self = .currentTurn
                case "last-turn": self = .lastTurn
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .initialized: "initialized"
                case .currentTurn: "current-turn"
                case .lastTurn: "last-turn"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct RuntimeTool: Codable, Hashable, Sendable {
        var name: String
        var description: String
        var source: String
        var active: Bool
        var parameters: JSONValue?
    }

    enum SessionTools: Codable, Hashable, Sendable {
        case live(RuntimeInspection)
        case coldOrUnsupported(ColdOrUnsupported)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case status
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .status) {
            case "live": self = try .live(RuntimeInspection(from: decoder))
            case "cold", "unsupported": self = try .coldOrUnsupported(ColdOrUnsupported(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .live(let value): try value.encode(to: encoder)
            case .coldOrUnsupported(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct ColdOrUnsupported: Codable, Hashable, Sendable {
            var status: Status

            enum Status: RawRepresentable, Codable, Hashable, Sendable {
                case cold
                case unsupported
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "cold": self = .cold
                    case "unsupported": self = .unsupported
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .cold: "cold"
                    case .unsupported: "unsupported"
                    case .unrecognized(let value): value
                    }
                }
            }
        }
    }

    struct ToolCatalogEntry: Codable, Hashable, Sendable {
        var name: String
        var description: String
        var source: String
        var defaultEnabled: Bool
    }

    struct ToolsCatalog: Codable, Hashable, Sendable {
        var backend: Backend
        var sdkVersion: String
        var tools: [ToolCatalogEntry]
        var sources: [String]
        var diagnostics: [String]
        var prompt: Prompt

        enum Backend: RawRepresentable, Codable, Hashable, Sendable {
            case sdk
            case cli
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "sdk": self = .sdk
                case "cli": self = .cli
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .sdk: "sdk"
                case .cli: "cli"
                case .unrecognized(let value): value
                }
            }
        }

        struct Prompt: Codable, Hashable, Sendable {
            var revision: String
            var text: String
        }
    }

    struct ToolsError: Codable, Hashable, Sendable {
        var error: String
    }
}
