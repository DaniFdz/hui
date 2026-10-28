// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct ProviderAnswerRequest: Codable, Hashable, Sendable {
        var promptId: String
        var value: String
    }

    struct ProviderError: Codable, Hashable, Sendable {
        var error: String
    }

    struct ProviderLogin: Codable, Hashable, Sendable {
        var id: String
        var provider: String
        var phase: Phase
        var accountId: String?
        var message: String?
        var url: String?
        var code: String?
        var prompt: Prompt?

        enum Phase: RawRepresentable, Codable, Hashable, Sendable {
            case pending
            case complete
            case failed
            case cancelled
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "pending": self = .pending
                case "complete": self = .complete
                case "failed": self = .failed
                case "cancelled": self = .cancelled
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .pending: "pending"
                case .complete: "complete"
                case .failed: "failed"
                case .cancelled: "cancelled"
                case .unrecognized(let value): value
                }
            }
        }

        struct Prompt: Codable, Hashable, Sendable {
            var id: String
            var type: TypeValue
            var message: String
            var options: [OptionsItem]?

            enum TypeValue: RawRepresentable, Codable, Hashable, Sendable {
                case text
                case secret
                case select
                case manualCode
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "text": self = .text
                    case "secret": self = .secret
                    case "select": self = .select
                    case "manual_code": self = .manualCode
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .text: "text"
                    case .secret: "secret"
                    case .select: "select"
                    case .manualCode: "manual_code"
                    case .unrecognized(let value): value
                    }
                }
            }

            struct OptionsItem: Codable, Hashable, Sendable {
                var id: String
                var label: String
            }
        }
    }

    struct ProviderLoginRequest: Codable, Hashable, Sendable {
        var method: Method
        var name: String?
        var accountId: String?

        enum Method: RawRepresentable, Codable, Hashable, Sendable {
            case apiKey
            case oauth
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "api_key": self = .apiKey
                case "oauth": self = .oauth
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .apiKey: "api_key"
                case .oauth: "oauth"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct ProviderModel: Codable, Hashable, Sendable {
        var id: String
        var name: String
        var contextWindow: Double?
        var maxTokens: Double?
    }

    struct ProviderModelsRequest: Codable, Hashable, Sendable {
        var models: [String]
    }

    struct ProviderOk: Codable, Hashable, Sendable {
        var ok: Bool = true
    }

    struct ProviderOrderRequest: Codable, Hashable, Sendable {
        var order: [String]
    }

    struct ProviderQuota: Codable, Hashable, Sendable {
        var status: Status
        var message: String?
        var checkedAt: Double
        var plan: String?
        var email: String?
        var access: Access?
        var windows: [WindowsItem]

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case available
            case unsupported
            case unavailable
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "available": self = .available
                case "unsupported": self = .unsupported
                case "unavailable": self = .unavailable
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .available: "available"
                case .unsupported: "unsupported"
                case .unavailable: "unavailable"
                case .unrecognized(let value): value
                }
            }
        }

        enum Access: RawRepresentable, Codable, Hashable, Sendable {
            case available
            case limited
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "available": self = .available
                case "limited": self = .limited
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .available: "available"
                case .limited: "limited"
                case .unrecognized(let value): value
                }
            }
        }

        struct WindowsItem: Codable, Hashable, Sendable {
            var label: String
            var usedPercent: Double
            var resetAt: Double?
            var scope: Scope

            enum Scope: RawRepresentable, Codable, Hashable, Sendable {
                case account
                case scoped
                case spend
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "account": self = .account
                    case "scoped": self = .scoped
                    case "spend": self = .spend
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .account: "account"
                    case .scoped: "scoped"
                    case .spend: "spend"
                    case .unrecognized(let value): value
                    }
                }
            }
        }
    }

    struct ProviderSnapshot: Codable, Hashable, Sendable {
        var providers: [ProviderSummary]
        var login: ProviderLogin?
    }

    struct ProviderSummary: Codable, Hashable, Sendable {
        var id: String
        var name: String
        var methods: [MethodsItem]
        var accounts: [AccountsItem]?
        var configured: Bool
        var authenticated: Bool
        var selected: [String]
        var models: [ProviderModel]

        struct MethodsItem: Codable, Hashable, Sendable {
            var id: Id
            var label: String

            enum Id: RawRepresentable, Codable, Hashable, Sendable {
                case apiKey
                case oauth
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "api_key": self = .apiKey
                    case "oauth": self = .oauth
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .apiKey: "api_key"
                    case .oauth: "oauth"
                    case .unrecognized(let value): value
                    }
                }
            }
        }

        struct AccountsItem: Codable, Hashable, Sendable {
            var id: String
            var name: String
            var email: String?
            var authenticated: Bool
            var cooldownUntil: Double?
        }
    }
}
