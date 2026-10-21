// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct FileCreateRequest: Codable, Hashable, Sendable {
        var path: String
        var kind: Kind

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case file
            case directory
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "file": self = .file
                case "directory": self = .directory
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .file: "file"
                case .directory: "directory"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct FileDeleted: Codable, Hashable, Sendable {
        var deleted: Deleted

        struct Deleted: Codable, Hashable, Sendable {
            var path: String
            var kind: FileEntryKind
        }
    }

    struct FileEntry: Codable, Hashable, Sendable {
        var name: String
        var path: String
        var kind: FileEntryKind
        var size: Double
        var symlink: Bool?
    }

    enum FileEntryKind: RawRepresentable, Codable, Hashable, Sendable {
        case directory
        case file
        case symlink
        case other
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "directory": self = .directory
            case "file": self = .file
            case "symlink": self = .symlink
            case "other": self = .other
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .directory: "directory"
            case .file: "file"
            case .symlink: "symlink"
            case .other: "other"
            case .unrecognized(let value): value
            }
        }
    }

    struct FileEntryResponse: Codable, Hashable, Sendable {
        var entry: FileEntry
    }

    struct FileError: Codable, Hashable, Sendable {
        var error: String
        var code: String?
        var current: FileRead?
    }

    struct FileLocation: Codable, Hashable, Sendable {
        var path: String
        var kind: Kind

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case file
            case directory
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "file": self = .file
                case "directory": self = .directory
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .file: "file"
                case .directory: "directory"
                case .unrecognized(let value): value
                }
            }
        }
    }

    enum FilePreviewKind: RawRepresentable, Codable, Hashable, Sendable {
        case text
        case image
        case pdf
        case binary
        case tooLarge
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "text": self = .text
            case "image": self = .image
            case "pdf": self = .pdf
            case "binary": self = .binary
            case "too-large": self = .tooLarge
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .text: "text"
            case .image: "image"
            case .pdf: "pdf"
            case .binary: "binary"
            case .tooLarge: "too-large"
            case .unrecognized(let value): value
            }
        }
    }

    struct FileRead: Codable, Hashable, Sendable {
        var path: String
        var name: String
        var size: Double
        var mtime: String
        var etag: String
        var writable: Bool
        var kind: FilePreviewKind
        var mimeType: String
        var content: String?
    }

    struct FileSaveRequest: Codable, Hashable, Sendable {
        var content: String
    }

    struct FileSaved: Codable, Hashable, Sendable {
        var path: String
        var etag: String
        var size: Double
        var mtime: String
    }

    enum FilesInfo: Codable, Hashable, Sendable {
        case available(Available)
        case notAvailable(NotAvailable)

        private enum Discriminator: String, CodingKey {
            case available
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(Bool.self, forKey: .available) {
            case true: self = try .available(Available(from: decoder))
            case false: self = try .notAvailable(NotAvailable(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .available(let value): try value.encode(to: encoder)
            case .notAvailable(let value): try value.encode(to: encoder)
            }
        }

        struct Available: Codable, Hashable, Sendable {
            var available: Bool = true
            var root: String
            var name: String
        }

        struct NotAvailable: Codable, Hashable, Sendable {
            var available: Bool = false
            var reason: String
        }
    }

    struct FilesListing: Codable, Hashable, Sendable {
        var path: String
        var entries: [FileEntry]
        var truncated: Bool
    }

    struct FilesResolve: Codable, Hashable, Sendable {
        var entries: [FileLocation?]
    }

    struct FilesResolveRequest: Codable, Hashable, Sendable {
        var paths: [String]
    }

    struct FilesSearch: Codable, Hashable, Sendable {
        var query: String
        var entries: [FileEntry]
        var truncated: Bool
        var source: Source

        enum Source: RawRepresentable, Codable, Hashable, Sendable {
            case git
            case walk
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "git": self = .git
                case "walk": self = .walk
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .git: "git"
                case .walk: "walk"
                case .unrecognized(let value): value
                }
            }
        }
    }
}
