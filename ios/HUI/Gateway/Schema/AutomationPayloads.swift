// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct AutomationCancelResponse: Codable, Hashable, Sendable {
        var ok: Bool = true
    }

    struct AutomationCreateResponse: Codable, Hashable, Sendable {
        var task: AutomationTask
        var snapshot: AutomationSnapshot
    }

    enum AutomationCreator: Codable, Hashable, Sendable {
        case `operator`(Operator)
        case bot(Bot)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case kind
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .kind) {
            case "operator": self = try .`operator`(Operator(from: decoder))
            case "bot": self = try .bot(Bot(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .`operator`(let value): try value.encode(to: encoder)
            case .bot(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Operator: Codable, Hashable, Sendable {
            var kind: String = "operator"
        }

        struct Bot: Codable, Hashable, Sendable {
            var kind: String = "bot"
            var botId: String
            var handle: String
        }
    }

    struct AutomationError: Codable, Hashable, Sendable {
        var error: String
    }

    enum AutomationFailureKind: RawRepresentable, Codable, Hashable, Sendable {
        case connection
        case rateLimit
        case configuration
        case transient
        case interrupted
        case timeout
        case unknown
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "connection": self = .connection
            case "rate-limit": self = .rateLimit
            case "configuration": self = .configuration
            case "transient": self = .transient
            case "interrupted": self = .interrupted
            case "timeout": self = .timeout
            case "unknown": self = .unknown
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .connection: "connection"
            case .rateLimit: "rate-limit"
            case .configuration: "configuration"
            case .transient: "transient"
            case .interrupted: "interrupted"
            case .timeout: "timeout"
            case .unknown: "unknown"
            case .unrecognized(let value): value
            }
        }
    }

    struct AutomationMutationResponse: Codable, Hashable, Sendable {
        var snapshot: AutomationSnapshot
    }

    struct AutomationRun: Codable, Hashable, Sendable {
        var id: String
        var taskId: String
        var taskName: String
        var sessionId: String
        var source: Source
        var status: AutomationRunStatus
        var createdAt: String
        var startedAt: String?
        var finishedAt: String?
        var summary: String?
        var error: String?
        var attempt: Double?
        var retryAt: String?
        var deadlineAt: String?
        var delivery: Delivery?
        var failure: Failure?

        enum Source: RawRepresentable, Codable, Hashable, Sendable {
            case manual
            case scheduled
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "manual": self = .manual
                case "scheduled": self = .scheduled
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .manual: "manual"
                case .scheduled: "scheduled"
                case .unrecognized(let value): value
                }
            }
        }

        struct Delivery: Codable, Hashable, Sendable {
            var text: String
            var before: Double
            var requestId: String?
        }

        struct Failure: Codable, Hashable, Sendable {
            var kind: AutomationFailureKind
            var needsAttention: Bool
        }
    }

    struct AutomationRunResponse: Codable, Hashable, Sendable {
        var run: AutomationRun
    }

    enum AutomationRunStatus: RawRepresentable, Codable, Hashable, Sendable {
        case queued
        case running
        case completed
        case failed
        case skipped
        case cancelled
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "queued": self = .queued
            case "running": self = .running
            case "completed": self = .completed
            case "failed": self = .failed
            case "skipped": self = .skipped
            case "cancelled": self = .cancelled
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .queued: "queued"
            case .running: "running"
            case .completed: "completed"
            case .failed: "failed"
            case .skipped: "skipped"
            case .cancelled: "cancelled"
            case .unrecognized(let value): value
            }
        }
    }

    enum AutomationSchedule: Codable, Hashable, Sendable {
        case at(At)
        case every(Every)
        case cron(Cron)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case kind
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .kind) {
            case "at": self = try .at(At(from: decoder))
            case "every": self = try .every(Every(from: decoder))
            case "cron": self = try .cron(Cron(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .at(let value): try value.encode(to: encoder)
            case .every(let value): try value.encode(to: encoder)
            case .cron(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct At: Codable, Hashable, Sendable {
            var kind: String = "at"
            var at: String
        }

        struct Every: Codable, Hashable, Sendable {
            var kind: String = "every"
            var everyMs: Double
        }

        struct Cron: Codable, Hashable, Sendable {
            var kind: String = "cron"
            var expression: String
            var timezone: String
        }
    }

    struct AutomationSnapshot: Codable, Hashable, Sendable {
        var scheduler: Scheduler
        var tasks: [AutomationTask]
        var runs: [AutomationRun]

        struct Scheduler: Codable, Hashable, Sendable {
            var enabled: Bool = true
            var activeRuns: Double
            var nextWakeAt: String?

            enum CodingKeys: String, CodingKey {
                case enabled
                case activeRuns
                case nextWakeAt
            }

            func encode(to encoder: any Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(enabled, forKey: .enabled)
                try container.encode(activeRuns, forKey: .activeRuns)
                try container.encode(nextWakeAt, forKey: .nextWakeAt)
            }
        }
    }

    struct AutomationTask: Codable, Hashable, Sendable {
        var id: String
        var name: String
        var description: String
        var sessionId: String
        var prompt: String
        var schedule: AutomationSchedule
        var enabled: Bool
        var timeoutSeconds: Double
        var createdAt: String
        var updatedAt: String
        var nextRunAt: String?
        var createdBy: AutomationCreator?
        var until: String?
        var runsLeft: Double?

        enum CodingKeys: String, CodingKey {
            case id
            case name
            case description
            case sessionId
            case prompt
            case schedule
            case enabled
            case timeoutSeconds
            case createdAt
            case updatedAt
            case nextRunAt
            case createdBy
            case until
            case runsLeft
        }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(id, forKey: .id)
            try container.encode(name, forKey: .name)
            try container.encode(description, forKey: .description)
            try container.encode(sessionId, forKey: .sessionId)
            try container.encode(prompt, forKey: .prompt)
            try container.encode(schedule, forKey: .schedule)
            try container.encode(enabled, forKey: .enabled)
            try container.encode(timeoutSeconds, forKey: .timeoutSeconds)
            try container.encode(createdAt, forKey: .createdAt)
            try container.encode(updatedAt, forKey: .updatedAt)
            try container.encode(nextRunAt, forKey: .nextRunAt)
            try container.encodeIfPresent(createdBy, forKey: .createdBy)
            try container.encodeIfPresent(until, forKey: .until)
            try container.encodeIfPresent(runsLeft, forKey: .runsLeft)
        }
    }

    struct AutomationTaskInput: Codable, Hashable, Sendable {
        var name: String
        var description: String?
        var sessionId: String
        var prompt: String
        var schedule: AutomationSchedule
        var enabled: Bool?
        var timeoutSeconds: Double?
        var until: String?
        var runs: Double?
    }
}
