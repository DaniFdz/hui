// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct DirectoriesResponse: Codable, Hashable, Sendable {
        var directories: [String]
    }

    struct GitCheckoutInfo: Codable, Hashable, Sendable {
        var available: Bool
        var headBranch: String
        var defaultBranch: String
        var branches: [String]
        var branchesUnavailable: Bool?
    }

    struct GitCheckoutResponse: Codable, Hashable, Sendable {
        var checkout: GitCheckoutInfo
    }

    struct LocalPathError: Codable, Hashable, Sendable {
        var error: String
    }

    struct LocalPathSuggestion: Codable, Hashable, Sendable {
        var path: String
        var kind: Kind

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case directory
            case file
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "directory": self = .directory
                case "file": self = .file
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .directory: "directory"
                case .file: "file"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct LocalPathsResponse: Codable, Hashable, Sendable {
        var paths: [LocalPathSuggestion]
    }
}
