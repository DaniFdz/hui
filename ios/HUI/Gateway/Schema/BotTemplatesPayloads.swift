// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct BotExportAddition: Codable, Hashable, Sendable {
        var quote: String
        var group: Group
        var becomes: String?

        enum Group: RawRepresentable, Codable, Hashable, Sendable {
            case remove
            case ask
            case confirm
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "remove": self = .remove
                case "ask": self = .ask
                case "confirm": self = .confirm
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .remove: "remove"
                case .ask: "ask"
                case .confirm: "confirm"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BotExportAvatar: Codable, Hashable, Sendable {
        var emoji: String?
        var shape: BotFaceShape?
        var ears: BotFaceEars?
        var color: String?
    }

    struct BotExportChange: Codable, Hashable, Sendable {
        var id: String
        var part: String
        var quote: String
        var group: BotExportGroup
        var reason: String
        var replacement: String
        var label: String
        var question: String
    }

    struct BotExportCleanup: Codable, Hashable, Sendable {
        var part: String
        var field: String
        var kind: String
        var sample: String
        var count: Double
    }

    struct BotExportField: Codable, Hashable, Sendable {
        var key: String
        var text: String
    }

    struct BotExportFileChange: Codable, Hashable, Sendable {
        var id: String
        var part: String
        var group: Group
        var reasons: [String]
        var question: String

        enum Group: RawRepresentable, Codable, Hashable, Sendable {
            case keep
            case remove
            case confirm
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "keep": self = .keep
                case "remove": self = .remove
                case "confirm": self = .confirm
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .keep: "keep"
                case .remove: "remove"
                case .confirm: "confirm"
                case .unrecognized(let value): value
                }
            }
        }
    }

    enum BotExportGroup: RawRepresentable, Codable, Hashable, Sendable {
        case keep
        case remove
        case ask
        case confirm
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "keep": self = .keep
            case "remove": self = .remove
            case "ask": self = .ask
            case "confirm": self = .confirm
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .keep: "keep"
            case .remove: "remove"
            case .ask: "ask"
            case .confirm: "confirm"
            case .unrecognized(let value): value
            }
        }
    }

    struct BotExportMeta: Codable, Hashable, Sendable {
        var avatar: BotExportAvatar?
        var model: String?
        var thinking: String?
        var memoryModel: String?
        var memoryThinking: String?
        var voice: BotVoice?
        var tagging: Tagging?
        var routines: [RoutinesItem]
        var triggers: [TriggersItem]
        var disabledTools: [String]
        var disabledSkills: [String]
        var skills: [String]

        enum Tagging: RawRepresentable, Codable, Hashable, Sendable {
            case mention
            case nobody
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "mention": self = .mention
                case "nobody": self = .nobody
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .mention: "mention"
                case .nobody: "nobody"
                case .unrecognized(let value): value
                }
            }
        }

        struct RoutinesItem: Codable, Hashable, Sendable {
            var schedule: BotExportSchedule
        }

        struct TriggersItem: Codable, Hashable, Sendable {
            var filter: BotTriggerFilter
            var delivery: Delivery?
            var cooldownSeconds: Double

            enum Delivery: RawRepresentable, Codable, Hashable, Sendable {
                case followUp
                case steer
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "followUp": self = .followUp
                    case "steer": self = .steer
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .followUp: "followUp"
                    case .steer: "steer"
                    case .unrecognized(let value): value
                    }
                }
            }
        }
    }

    struct BotExportPart: Codable, Hashable, Sendable {
        var id: String
        var label: String
        var kind: Kind
        var fields: [BotExportField]
        var read: Bool
        var unread: String?

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case text
            case script
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "text": self = .text
                case "script": self = .script
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .text: "text"
                case .script: "script"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BotExportReview: Codable, Hashable, Sendable {
        var id: String
        var botId: String
        var name: String
        var model: String?
        var warning: String?
        var parts: [BotExportPart]
        var cleanup: [BotExportCleanup]
        var changes: [BotExportChange]
        var files: [BotExportFileChange]
        var needs: [NeedsItem]
        var leftOut: [String]
        var meta: BotExportMeta

        struct NeedsItem: Codable, Hashable, Sendable {
            var id: String
            var text: String
        }
    }

    enum BotExportSchedule: Codable, Hashable, Sendable {
        case every(Every)
        case cron(Cron)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case kind
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .kind) {
            case "every": self = try .every(Every(from: decoder))
            case "cron": self = try .cron(Cron(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .every(let value): try value.encode(to: encoder)
            case .cron(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct Every: Codable, Hashable, Sendable {
            var kind: String = "every"
            var everyMs: Double
        }

        struct Cron: Codable, Hashable, Sendable {
            var kind: String = "cron"
            var expression: String
        }
    }

    struct BotImportPreview: Codable, Hashable, Sendable {
        var template: BotTemplate
        var candidates: [CandidatesItem]?
        var pick: String?
        var bot: Bot
        var soul: String
        var opener: String?
        var model: String?
        var thinking: String?
        var utilityModel: String?
        var memories: Memories
        var skills: [SkillsItem]
        var routines: [BotImportRoutine]
        var integrations: [IntegrationsItem]
        var disabledTools: [String]
        var disabledSkills: [String]
        var `open`: [BotOpenPoint]
        var needs: [String]
        var triggers: [BotTemplateTrigger]
        var dropped: [String]
        var notes: [String]

        struct CandidatesItem: Codable, Hashable, Sendable {
            var key: String
            var name: String
            var title: String?
        }

        struct Bot: Codable, Hashable, Sendable {
            var name: String
            var handle: String
            var title: String?
            var description: String?
            var emoji: String?
            var avatar: Avatar?
            var worker: Worker?

            struct Avatar: Codable, Hashable, Sendable {
                var shape: BotFaceShape?
                var ears: BotFaceEars?
                var color: String?
            }

            struct Worker: Codable, Hashable, Sendable {
                var id: String
                var name: String
            }
        }

        struct Memories: Codable, Hashable, Sendable {
            var included: Double
            var total: Double
        }

        struct SkillsItem: Codable, Hashable, Sendable {
            var name: String
            var description: String
            var content: String
            var files: [BotTemplateSkillFile]?
            var original: String
        }

        struct IntegrationsItem: Codable, Hashable, Sendable {
            var name: String
            var description: String?
            var tool: Tool?

            struct Tool: Codable, Hashable, Sendable {
                var name: String
                var label: String
            }
        }
    }

    struct BotImportPreviewRequest: Codable, Hashable, Sendable {
        var source: BotImportSource
        var pick: String?
        var worker: String?
    }

    struct BotImportRequest: Codable, Hashable, Sendable {
        var template: BotTemplate
        var worker: String?
    }

    struct BotImportResult: Codable, Hashable, Sendable {
        var bot: BotView
        var skills: [String]
        var routines: Double
        var opener: Bool
        var warnings: [String]
    }

    struct BotImportRoutine: Codable, Hashable, Sendable {
        var name: String
        var prompt: String
        var schedule: AutomationSchedule
        var scheduleText: String?
        var guessed: Bool
    }

    enum BotImportSource: Codable, Hashable, Sendable {
        case file(File)
        case files(Files)
        case url(Url)
        case text(Text)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case kind
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .kind) {
            case "file": self = try .file(File(from: decoder))
            case "files": self = try .files(Files(from: decoder))
            case "url": self = try .url(Url(from: decoder))
            case "text": self = try .text(Text(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .file(let value): try value.encode(to: encoder)
            case .files(let value): try value.encode(to: encoder)
            case .url(let value): try value.encode(to: encoder)
            case .text(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }

        struct File: Codable, Hashable, Sendable {
            var kind: String = "file"
            var name: String
            var data: String
        }

        struct Files: Codable, Hashable, Sendable {
            var kind: String = "files"
            var files: [FilesItem]

            struct FilesItem: Codable, Hashable, Sendable {
                var path: String
                var data: String
            }
        }

        struct Url: Codable, Hashable, Sendable {
            var kind: String = "url"
            var url: String
        }

        struct Text: Codable, Hashable, Sendable {
            var kind: String = "text"
            var text: String
        }
    }

    struct BotOpenPoint: Codable, Hashable, Sendable {
        var kind: Kind
        var `where`: String
        var question: String
        var excerpt: String?
        var `operator`: Bool?

        enum Kind: RawRepresentable, Codable, Hashable, Sendable {
            case ask
            case confirm
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "ask": self = .ask
                case "confirm": self = .confirm
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .ask: "ask"
                case .confirm: "confirm"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BotTemplate: Codable, Hashable, Sendable {
        var format: BotTemplateFormat
        var origin: String?
        var author: String?
        var name: String
        var title: String?
        var description: String?
        var emoji: String?
        var avatar: Avatar?
        var soul: String
        var opener: String?
        var memories: [BotTemplateMemory]
        var skills: [BotTemplateSkill]
        var routines: [BotTemplateRoutine]
        var integrations: [BotTemplateIntegration]
        var model: String?
        var tools: [String]?
        var hui: Hui?
        var `open`: [BotOpenPoint]?
        var needs: [String]?
        var triggers: [BotTemplateTrigger]?
        var dropped: [String]
        var notes: [String]

        struct Avatar: Codable, Hashable, Sendable {
            var shape: BotFaceShape?
            var ears: BotFaceEars?
            var color: String?
        }

        struct Hui: Codable, Hashable, Sendable {
            var handle: String?
            var thinking: String?
            var memoryModel: String?
            var memoryThinking: String?
            var voice: BotVoice?
            var tagging: Tagging?
            var disabledTools: [String]?
            var disabledSkills: [String]?

            enum Tagging: RawRepresentable, Codable, Hashable, Sendable {
                case mention
                case nobody
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "mention": self = .mention
                    case "nobody": self = .nobody
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .mention: "mention"
                    case .nobody: "nobody"
                    case .unrecognized(let value): value
                    }
                }
            }
        }
    }

    enum BotTemplateFormat: RawRepresentable, Codable, Hashable, Sendable {
        case grok
        case openclaw
        case claudeCode
        case letta
        case characterCard
        case crewai
        case hui
        case text
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "grok": self = .grok
            case "openclaw": self = .openclaw
            case "claude-code": self = .claudeCode
            case "letta": self = .letta
            case "character-card": self = .characterCard
            case "crewai": self = .crewai
            case "hui": self = .hui
            case "text": self = .text
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .grok: "grok"
            case .openclaw: "openclaw"
            case .claudeCode: "claude-code"
            case .letta: "letta"
            case .characterCard: "character-card"
            case .crewai: "crewai"
            case .hui: "hui"
            case .text: "text"
            case .unrecognized(let value): value
            }
        }
    }

    struct BotTemplateIntegration: Codable, Hashable, Sendable {
        var name: String
        var description: String?
    }

    struct BotTemplateMemory: Codable, Hashable, Sendable {
        var name: String?
        var text: String
    }

    struct BotTemplateRoutine: Codable, Hashable, Sendable {
        var name: String
        var prompt: String
        var schedule: String?
        var automation: AutomationSchedule?
        var description: String?
    }

    struct BotTemplateSkill: Codable, Hashable, Sendable {
        var name: String
        var description: String
        var content: String
        var files: [BotTemplateSkillFile]?
    }

    struct BotTemplateSkillFile: Codable, Hashable, Sendable {
        var path: String
        var text: String
    }

    struct BotTemplateTrigger: Codable, Hashable, Sendable {
        var name: String
        var filter: BotTriggerFilter
        var prompt: String?
        var delivery: Delivery?
        var cooldownSeconds: Double

        enum Delivery: RawRepresentable, Codable, Hashable, Sendable {
            case followUp
            case steer
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "followUp": self = .followUp
                case "steer": self = .steer
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .followUp: "followUp"
                case .steer: "steer"
                case .unrecognized(let value): value
                }
            }
        }
    }
}
