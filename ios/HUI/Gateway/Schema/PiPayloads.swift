// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct PiConfiguredResource: Codable, Hashable, Sendable {
        var id: String
        var label: String
        var kind: Kind

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case package
            case `extension`
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "package": self = .package
                case "extension": self = .`extension`
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .package: "package"
                case .`extension`: "extension"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct PiError: Codable, Hashable, Sendable {
        var error: String
    }

    struct PiInstallRequest: Codable, Hashable, Sendable {
        var url: String
    }

    struct PiModel: Codable, Hashable, Sendable {
        var defaultProvider: String
        var defaultModel: String
        var thinking: String?
        var enabled: [String]
        var authenticated: [String]
        var catalog: [PiModelCatalogEntry]

        enum CodingKeys: String, CodingKey {
            case defaultProvider
            case defaultModel
            case thinking
            case enabled
            case authenticated
            case catalog
        }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(defaultProvider, forKey: .defaultProvider)
            try container.encode(defaultModel, forKey: .defaultModel)
            try container.encode(thinking, forKey: .thinking)
            try container.encode(enabled, forKey: .enabled)
            try container.encode(authenticated, forKey: .authenticated)
            try container.encode(catalog, forKey: .catalog)
        }
    }

    struct PiModelCatalogEntry: Codable, Hashable, Sendable {
        var provider: String
        var id: String
        var name: String
        var contextWindow: Double?
        var maxTokens: Double?
        var thinkingLevels: [String]?
        var fast: Bool?
    }

    enum PiMutationKind: RawRepresentable, Codable, Hashable, Sendable {
        case packageInstall
        case packageRemove
        case skillInstall
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "package-install": self = .packageInstall
            case "package-remove": self = .packageRemove
            case "skill-install": self = .skillInstall
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .packageInstall: "package-install"
            case .packageRemove: "package-remove"
            case .skillInstall: "skill-install"
            case .unrecognized(let value): value
            }
        }
    }

    struct PiMutationResult: Codable, Hashable, Sendable {
        var kind: PiMutationKind
        var target: String
        var message: String
        var snapshot: PiSnapshot
    }

    struct PiRemoveRequest: Codable, Hashable, Sendable {
        var source: String
    }

    struct PiResourceDocument: Codable, Hashable, Sendable {
        var id: String
        var kind: Kind
        var title: String
        var fileName: String
        var format: Format
        var content: String
        var truncated: Bool

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case skill
            case package
            case `extension`
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "skill": self = .skill
                case "package": self = .package
                case "extension": self = .`extension`
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .skill: "skill"
                case .package: "package"
                case .`extension`: "extension"
                case .unrecognized(let value): value
                }
            }
        }

        enum Format: RawRepresentable, Codable, Hashable, Sendable {
            case markdown
            case code
            case json
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "markdown": self = .markdown
                case "code": self = .code
                case "json": self = .json
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .markdown: "markdown"
                case .code: "code"
                case .json: "json"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct PiSettingsSummary: Codable, Hashable, Sendable {
        var path: String
        var exists: Bool
        var packages: [String]
        var extensions: [String]
        var resources: [PiConfiguredResource]
        var skillRoots: [String]
    }

    struct PiSkill: Codable, Hashable, Sendable {
        var id: String
        var name: String
        var description: String
        var path: String
        var root: String
        var origin: String?
        var tags: [String]?
        var preferencePath: String?
    }

    struct PiSnapshot: Codable, Hashable, Sendable {
        var agentDir: String
        var settings: PiSettingsSummary
        var skills: [PiSkill]
        var tools: [PiTool]
        var model: PiModel
        var diagnostics: [String]
    }

    struct PiTool: Codable, Hashable, Sendable {
        var name: String
        var kind: Kind
        var source: String?

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case builtin
            case hui
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "builtin": self = .builtin
                case "hui": self = .hui
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .builtin: "builtin"
                case .hui: "hui"
                case .unrecognized(let value): value
                }
            }
        }
    }
}
