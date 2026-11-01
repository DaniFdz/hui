// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct DatadogConnection: Codable, Hashable, Sendable {
        var cli: Cli
        var orgs: [DatadogOrgStatus]
        var pupOrgs: [DatadogOrg]
        var login: DatadogLoginState

        enum Cli: Codable, Hashable, Sendable {
            case notInstalled(NotInstalled)
            case installed(Installed)

            private enum Discriminator: String, CodingKey {
                case installed
            }

            init(from decoder: any Decoder) throws {
                let container = try decoder.container(keyedBy: Discriminator.self)
                switch try container.decode(Bool.self, forKey: .installed) {
                case false: self = try .notInstalled(NotInstalled(from: decoder))
                case true: self = try .installed(Installed(from: decoder))
                }
            }

            func encode(to encoder: any Encoder) throws {
                switch self {
                case .notInstalled(let value): try value.encode(to: encoder)
                case .installed(let value): try value.encode(to: encoder)
                }
            }

            struct NotInstalled: Codable, Hashable, Sendable {
                var installed: Bool = false
            }

            struct Installed: Codable, Hashable, Sendable {
                var installed: Bool = true
                var version: String
            }
        }
    }

    struct DatadogError: Codable, Hashable, Sendable {
        var error: String
    }

    enum DatadogLoginState: Codable, Hashable, Sendable {
        case idle(Idle)
        case pending(Pending)
        case failed(Failed)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case phase
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .phase) {
            case "idle": self = try .idle(Idle(from: decoder))
            case "pending": self = try .pending(Pending(from: decoder))
            case "failed": self = try .failed(Failed(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .idle(let value): try value.encode(to: encoder)
            case .pending(let value): try value.encode(to: encoder)
            case .failed(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Idle: Codable, Hashable, Sendable {
            var phase: String = "idle"
        }

        struct Pending: Codable, Hashable, Sendable {
            var phase: String = "pending"
            var org: DatadogOrg
            var url: String?
            var expiresAt: Double
        }

        struct Failed: Codable, Hashable, Sendable {
            var phase: String = "failed"
            var org: DatadogOrg
            var message: String
        }
    }

    struct DatadogOrg: Codable, Hashable, Sendable {
        var name: String
        var site: String
    }

    struct DatadogOrgRequest: Codable, Hashable, Sendable {
        var name: String?
        var site: String?
    }

    struct DatadogOrgStatus: Codable, Hashable, Sendable {
        var name: String
        var site: String
        var status: Status

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case connected
            case signedOut
            case unknown
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "connected": self = .connected
                case "signed_out": self = .signedOut
                case "unknown": self = .unknown
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .connected: "connected"
                case .signedOut: "signed_out"
                case .unknown: "unknown"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct DatadogPreview: Codable, Hashable, Sendable {
        var kind: Kind
        var url: String
        var title: String
        var detail: String?
        var org: String?
        var from: Double?
        var to: Double?
        var relative: Bool?
        var image: String?

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case share
            case widget
            case dashboard
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "share": self = .share
                case "widget": self = .widget
                case "dashboard": self = .dashboard
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .share: "share"
                case .widget: "widget"
                case .dashboard: "dashboard"
                case .unrecognized(let value): value
                }
            }
        }
    }

    enum DatadogPreviewError: RawRepresentable, Codable, Hashable, Sendable {
        case notFound
        case signedOut
        case noOrg
        case cliMissing
        case unavailable
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "not_found": self = .notFound
            case "signed_out": self = .signedOut
            case "no_org": self = .noOrg
            case "cli_missing": self = .cliMissing
            case "unavailable": self = .unavailable
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .notFound: "not_found"
            case .signedOut: "signed_out"
            case .noOrg: "no_org"
            case .cliMissing: "cli_missing"
            case .unavailable: "unavailable"
            case .unrecognized(let value): value
            }
        }
    }

    struct DatadogPreviewResult: Codable, Hashable, Sendable {
        var url: String
        var preview: DatadogPreview?
        var error: DatadogPreviewError?
        var signIn: DatadogOrg?
    }

    struct DatadogPreviewsResponse: Codable, Hashable, Sendable {
        var previews: [DatadogPreviewResult]
    }
}
