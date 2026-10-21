// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct DiffBranch: Codable, Hashable, Sendable {
        var ref: String
        var name: String
        var remote: Bool
        var distance: Double?
    }

    struct DiffChanges: Codable, Hashable, Sendable {
        var comparison: DiffComparison
        var base: DiffEndpoint
        var head: DiffEndpoint
        var includesUncommitted: Bool
        var files: [DiffFile]
        var additions: Double
        var deletions: Double
        var truncated: Bool
        var filesOmitted: Double
        var untrackedOmitted: Double
    }

    enum DiffComparison: RawRepresentable, Codable, Hashable, Sendable {
        case uncommitted
        case lastCommit
        case parent
        case `default`
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "uncommitted": self = .uncommitted
            case "last-commit": self = .lastCommit
            case "parent": self = .parent
            case "default": self = .`default`
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .uncommitted: "uncommitted"
            case .lastCommit: "last-commit"
            case .parent: "parent"
            case .`default`: "default"
            case .unrecognized(let value): value
            }
        }
    }

    struct DiffEndpoint: Codable, Hashable, Sendable {
        var label: String
        var sha: String?
    }

    struct DiffErrorResponse: Codable, Hashable, Sendable {
        var error: String
        var code: String?
    }

    struct DiffFile: Codable, Hashable, Sendable {
        var path: String
        var oldPath: String?
        var status: DiffFileStatus
        var similarity: Double?
        var additions: Double
        var deletions: Double
        var binary: Bool
        var oldMode: String?
        var newMode: String?
        var patch: String?
        var truncated: Truncated?

        enum Truncated: RawRepresentable, Codable, Hashable, Sendable {
            case file
            case total
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "file": self = .file
                case "total": self = .total
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .file: "file"
                case .total: "total"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct DiffFileChanges: Codable, Hashable, Sendable {
        var file: DiffFile?
    }

    enum DiffFileStatus: RawRepresentable, Codable, Hashable, Sendable {
        case a
        case m
        case d
        case r
        case c
        case t
        case u
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "A": self = .a
            case "M": self = .m
            case "D": self = .d
            case "R": self = .r
            case "C": self = .c
            case "T": self = .t
            case "U": self = .u
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .a: "A"
            case .m: "M"
            case .d: "D"
            case .r: "R"
            case .c: "C"
            case .t: "T"
            case .u: "U"
            case .unrecognized(let value): value
            }
        }
    }

    enum DiffInfo: Codable, Hashable, Sendable {
        case notAvailable(NotAvailable)
        case available(Available)

        private enum Discriminator: String, CodingKey {
            case available
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(Bool.self, forKey: .available) {
            case false: self = try .notAvailable(NotAvailable(from: decoder))
            case true: self = try .available(Available(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .notAvailable(let value): try value.encode(to: encoder)
            case .available(let value): try value.encode(to: encoder)
            }
        }

        struct NotAvailable: Codable, Hashable, Sendable {
            var available: Bool = false
            var reason: String
            var code: Code

            enum Code: RawRepresentable, Codable, Hashable, Sendable {
                case remote
                case notRepo
                case missing
                case git
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "remote": self = .remote
                    case "not-repo": self = .notRepo
                    case "missing": self = .missing
                    case "git": self = .git
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .remote: "remote"
                    case .notRepo: "not-repo"
                    case .missing: "missing"
                    case .git: "git"
                    case .unrecognized(let value): value
                    }
                }
            }
        }

        struct Available: Codable, Hashable, Sendable {
            var available: Bool = true
            var root: String
            var subdirectory: String
            var branch: String?
            var detached: Bool
            var unborn: Bool
            var head: String?
            var uncommitted: Double
            var lastCommit: LastCommit?
            var parent: Parent?
            var branches: [DiffBranch]
            var defaultBranch: DefaultBranch?
            var comparisons: [DiffComparison]

            struct LastCommit: Codable, Hashable, Sendable {
                var sha: String
                var subject: String
            }

            struct Parent: Codable, Hashable, Sendable {
                var ref: String
                var name: String
                var remote: Bool
                var distance: Double?
                var source: DiffParentSource
            }

            struct DefaultBranch: Codable, Hashable, Sendable {
                var ref: String
                var name: String
            }
        }
    }

    enum DiffParentSource: RawRepresentable, Codable, Hashable, Sendable {
        case ghMergeBase
        case gitTown
        case upstream
        case nearest
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "gh-merge-base": self = .ghMergeBase
            case "git-town": self = .gitTown
            case "upstream": self = .upstream
            case "nearest": self = .nearest
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .ghMergeBase: "gh-merge-base"
            case .gitTown: "git-town"
            case .upstream: "upstream"
            case .nearest: "nearest"
            case .unrecognized(let value): value
            }
        }
    }
}
