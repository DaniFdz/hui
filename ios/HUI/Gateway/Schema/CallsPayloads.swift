// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct CallDelegationRequest: Codable, Hashable, Sendable {
        var id: String
        var request: String
    }

    struct CallDelegationResult: Codable, Hashable, Sendable {
        var status: Status
        var speak: String
        var task: String?

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case answered
            case handedOff
            case failed
            case timeout
            case limit
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "answered": self = .answered
                case "handed-off": self = .handedOff
                case "failed": self = .failed
                case "timeout": self = .timeout
                case "limit": self = .limit
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .answered: "answered"
                case .handedOff: "handed-off"
                case .failed: "failed"
                case .timeout: "timeout"
                case .limit: "limit"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct CallEnded: Codable, Hashable, Sendable {
        var ended: Bool
    }

    struct CallHeartbeat: Codable, Hashable, Sendable {
        var ok: Bool = true
    }

    struct CallLine: Codable, Hashable, Sendable {
        var role: Role
        var text: String

        enum Role: RawRepresentable, Codable, Hashable, Sendable {
            case user
            case assistant
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "user": self = .user
                case "assistant": self = .assistant
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .user: "user"
                case .assistant: "assistant"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct CallLinesKept: Codable, Hashable, Sendable {
        var kept: Double
    }

    struct CallLinesRequest: Codable, Hashable, Sendable {
        var lines: [LinesItem]

        struct LinesItem: Codable, Hashable, Sendable {
            var role: Role
            var text: String
            var at: Double?

            enum Role: RawRepresentable, Codable, Hashable, Sendable {
                case user
                case assistant
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "user": self = .user
                    case "assistant": self = .assistant
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .user: "user"
                    case .assistant: "assistant"
                    case .unrecognized(let value): value
                    }
                }
            }
        }
    }

    struct CallRecord: Codable, Hashable, Sendable {
        var call: String
        var bot: String?
        var startedAt: Double
        var endedAt: Double
        var summary: String?
        var summaryUnavailable: Bool?
        var lines: [CallRecordLine]
    }

    struct CallRecordLine: Codable, Hashable, Sendable {
        var role: Role
        var text: String
        var at: Double
        var request: String?

        enum Role: RawRepresentable, Codable, Hashable, Sendable {
            case user
            case assistant
            case helper
            case handoff
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "user": self = .user
                case "assistant": self = .assistant
                case "helper": self = .helper
                case "handoff": self = .handoff
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .user: "user"
                case .assistant: "assistant"
                case .helper: "helper"
                case .handoff: "handoff"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct CallStartRequest: Codable, Hashable, Sendable {
        var sdp: String
    }

    struct CallStarted: Codable, Hashable, Sendable {
        var callId: String
        var answer: String
        var model: String
        var voice: GptLiveVoice
        var account: Account
        var instructionsBytes: Double
        var memoryBytes: Double

        struct Account: Codable, Hashable, Sendable {
            var name: String
        }
    }

    struct CallTaskResult: Codable, Hashable, Sendable {
        var status: Status
        var speak: String

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case answered
            case failed
            case needsInput
            case timeout
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "answered": self = .answered
                case "failed": self = .failed
                case "needs-input": self = .needsInput
                case "timeout": self = .timeout
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .answered: "answered"
                case .failed: "failed"
                case .needsInput: "needs-input"
                case .timeout: "timeout"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct CallsStatus: Codable, Hashable, Sendable {
        var model: String
        var voices: [GptLiveVoice]
        var chatgpt: Chatgpt
        var active: Double
        var limit: Double

        struct Chatgpt: Codable, Hashable, Sendable {
            var signedIn: Bool
            var account: Account?
            var waitingUntil: Double?

            struct Account: Codable, Hashable, Sendable {
                var name: String
                var email: String?
            }
        }
    }
}
