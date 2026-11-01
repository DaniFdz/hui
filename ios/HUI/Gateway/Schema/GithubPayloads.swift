// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct ActivityBlock: Codable, Hashable, Sendable {
        var start: Double
        var end: Double
        var model: String?
        var firstMessage: String?
    }

    struct ActivitySession: Codable, Hashable, Sendable {
        var id: String
        var title: String
        var group: String
        var project: String
        var archived: Bool?
        var blocks: [ActivityBlock]
    }

    struct GitHubAccount: Codable, Hashable, Sendable {
        var host: String
        var login: String
        var scopes: [String]
        var tokenSource: String?
    }

    struct GitHubConnection: Codable, Hashable, Sendable {
        var cli: Cli
        var status: Status
        var account: GitHubAccount?
        var message: String?
        var login: GitHubLoginState

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

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case connected
            case disconnected
            case invalid
            case unknown
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "connected": self = .connected
                case "disconnected": self = .disconnected
                case "invalid": self = .invalid
                case "unknown": self = .unknown
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .connected: "connected"
                case .disconnected: "disconnected"
                case .invalid: "invalid"
                case .unknown: "unknown"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct GitHubContributionAccount: Codable, Hashable, Sendable {
        var login: String
        var createdAt: String?
        var commits: [String]
        var pullRequests: [String]
        var error: String?
    }

    struct GitHubContributions: Codable, Hashable, Sendable {
        var accounts: [GitHubContributionAccount]
    }

    struct GitHubError: Codable, Hashable, Sendable {
        var error: String
    }

    enum GitHubLoginState: Codable, Hashable, Sendable {
        case idle(Idle)
        case starting(Starting)
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
            case "starting": self = try .starting(Starting(from: decoder))
            case "pending": self = try .pending(Pending(from: decoder))
            case "failed": self = try .failed(Failed(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .idle(let value): try value.encode(to: encoder)
            case .starting(let value): try value.encode(to: encoder)
            case .pending(let value): try value.encode(to: encoder)
            case .failed(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Idle: Codable, Hashable, Sendable {
            var phase: String = "idle"
        }

        struct Starting: Codable, Hashable, Sendable {
            var phase: String = "starting"
        }

        struct Pending: Codable, Hashable, Sendable {
            var phase: String = "pending"
            var userCode: String
            var verificationUri: String
            var expiresAt: Double
        }

        struct Failed: Codable, Hashable, Sendable {
            var phase: String = "failed"
            var message: String
        }
    }

    enum GitHubPreview: Codable, Hashable, Sendable {
        case repo(Repo)
        case pull(Pull)
        case issue(Issue)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case kind
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .kind) {
            case "repo": self = try .repo(Repo(from: decoder))
            case "pull": self = try .pull(Pull(from: decoder))
            case "issue": self = try .issue(Issue(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .repo(let value): try value.encode(to: encoder)
            case .pull(let value): try value.encode(to: encoder)
            case .issue(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Repo: Codable, Hashable, Sendable {
            var kind: String = "repo"
            var url: String
            var fullName: String
            var description: String?
            var stars: Double
            var forks: Double
            var language: String?
            var `private`: Bool
            var archived: Bool
        }

        struct Pull: Codable, Hashable, Sendable {
            var kind: String = "pull"
            var url: String
            var repository: String
            var number: Double
            var title: String
            var state: PullRequestState
            var author: String?
            var additions: Double
            var deletions: Double
            var changedFiles: Double
            var comments: Double
            var body: String?
        }

        struct Issue: Codable, Hashable, Sendable {
            var kind: String = "issue"
            var url: String
            var repository: String
            var number: Double
            var title: String
            var state: State
            var stateReason: String?
            var author: String?
            var comments: Double
            var labels: [String]
            var body: String?

            enum State: RawRepresentable, Codable, Hashable, Sendable {
                case `open`
                case closed
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "open": self = .`open`
                    case "closed": self = .closed
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .`open`: "open"
                    case .closed: "closed"
                    case .unrecognized(let value): value
                    }
                }
            }
        }
    }

    enum GitHubPreviewError: RawRepresentable, Codable, Hashable, Sendable {
        case notFound
        case signedOut
        case cliMissing
        case unavailable
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "not_found": self = .notFound
            case "signed_out": self = .signedOut
            case "cli_missing": self = .cliMissing
            case "unavailable": self = .unavailable
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .notFound: "not_found"
            case .signedOut: "signed_out"
            case .cliMissing: "cli_missing"
            case .unavailable: "unavailable"
            case .unrecognized(let value): value
            }
        }
    }

    struct GitHubPreviewResult: Codable, Hashable, Sendable {
        var url: String
        var preview: GitHubPreview?
        var error: GitHubPreviewError?
    }

    struct GitHubPreviewsResponse: Codable, Hashable, Sendable {
        var previews: [GitHubPreviewResult]
    }

    enum PullRequestState: RawRepresentable, Codable, Hashable, Sendable {
        case `open`
        case draft
        case merged
        case closed
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "open": self = .`open`
            case "draft": self = .draft
            case "merged": self = .merged
            case "closed": self = .closed
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .`open`: "open"
            case .draft: "draft"
            case .merged: "merged"
            case .closed: "closed"
            case .unrecognized(let value): value
            }
        }
    }

    struct SessionActivity: Codable, Hashable, Sendable {
        var sessions: [ActivitySession]
    }

    struct SessionPullRequest: Codable, Hashable, Sendable {
        var repository: String
        var number: Double
        var url: String
        var state: PullRequestState?
        var title: String?
        var body: String?
    }
}
