// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct TerminalConnectResponse: Codable, Hashable, Sendable {
        var url: String
    }

    enum TerminalControlFrame: Codable, Hashable, Sendable {
        case snapshot(TerminalSnapshotFrame)
        case state(State)
        case error(ErrorValue)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case type
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .type) {
            case "snapshot": self = try .snapshot(TerminalSnapshotFrame(from: decoder))
            case "state": self = try .state(State(from: decoder))
            case "error": self = try .error(ErrorValue(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .snapshot(let value): try value.encode(to: encoder)
            case .state(let value): try value.encode(to: encoder)
            case .error(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct State: Codable, Hashable, Sendable {
            var type: String = "state"
            var terminal: TerminalView
        }

        struct ErrorValue: Codable, Hashable, Sendable {
            var type: String = "error"
            var error: String
        }
    }

    struct TerminalCreateRequest: Codable, Hashable, Sendable {
        var cols: Double?
        var rows: Double?
        var title: String?
    }

    struct TerminalError: Codable, Hashable, Sendable {
        var error: String
    }

    enum TerminalInput: Codable, Hashable, Sendable {
        case input(Input)
        case resize(Resize)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case action
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .action) {
            case "input": self = try .input(Input(from: decoder))
            case "resize": self = try .resize(Resize(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .input(let value): try value.encode(to: encoder)
            case .resize(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Input: Codable, Hashable, Sendable {
            var action: String = "input"
            var data: String
        }

        struct Resize: Codable, Hashable, Sendable {
            var action: String = "resize"
            var cols: Double
            var rows: Double
        }
    }

    enum TerminalOperationRequest: Codable, Hashable, Sendable {
        case terminalInput(TerminalInput)
        case listOrReadOrClose(ListOrReadOrClose)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case action
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .action) {
            case "input", "resize": self = try .terminalInput(TerminalInput(from: decoder))
            case "list", "read", "close": self = try .listOrReadOrClose(ListOrReadOrClose(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .terminalInput(let value): try value.encode(to: encoder)
            case .listOrReadOrClose(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct ListOrReadOrClose: Codable, Hashable, Sendable {
            var action: Action

            enum Action: RawRepresentable, Codable, Hashable, Sendable {
                case list
                case read
                case close
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "list": self = .list
                    case "read": self = .read
                    case "close": self = .close
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .list: "list"
                    case .read: "read"
                    case .close: "close"
                    case .unrecognized(let value): value
                    }
                }
            }
        }
    }

    typealias TerminalOperationResponse = JSONValue

    struct TerminalResponse: Codable, Hashable, Sendable {
        var terminal: TerminalView
    }

    struct TerminalSnapshot: Codable, Hashable, Sendable {
        var terminal: TerminalView
        var data: String
        var sequence: Double
        var truncated: Bool
    }

    struct TerminalSnapshotFrame: Codable, Hashable, Sendable {
        var type: String = "snapshot"
        var terminal: TerminalView
        var sequence: Double
        var truncated: Bool
        var replayBytes: Double
    }

    struct TerminalView: Codable, Hashable, Sendable {
        var id: String
        var ownerSessionId: String
        var title: String
        var cwd: String
        var cols: Double
        var rows: Double
        var status: Status
        var exitCode: Double?
        var createdAt: String

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case running
            case exited
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "running": self = .running
                case "exited": self = .exited
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .running: "running"
                case .exited: "exited"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct TerminalsResponse: Codable, Hashable, Sendable {
        var terminals: [TerminalView]
    }
}
