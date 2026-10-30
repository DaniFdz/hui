// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct BotAccessRequest: Codable, Hashable, Sendable {
        var id: String
        var sessionId: String
        var title: String
        var message: String
    }

    struct BotAvatar: Codable, Hashable, Sendable {
        var emoji: String?
        var color: String?
        var shape: BotFaceShape?
        var ears: BotFaceEars?
    }

    struct BotAvatarPatch: Codable, Hashable, Sendable {
        var emoji: String?
        var color: String?
        var shape: Shape?
        var ears: Ears?

        enum Shape: RawRepresentable, Codable, Hashable, Sendable {
            case blob
            case round
            case triangle
            case heart
            case cookie
            case star
            case flower
            case cloud
            case drop
            case ghost
            case pill
            case block
            case hexagon
            case empty
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "blob": self = .blob
                case "round": self = .round
                case "triangle": self = .triangle
                case "heart": self = .heart
                case "cookie": self = .cookie
                case "star": self = .star
                case "flower": self = .flower
                case "cloud": self = .cloud
                case "drop": self = .drop
                case "ghost": self = .ghost
                case "pill": self = .pill
                case "block": self = .block
                case "hexagon": self = .hexagon
                case "": self = .empty
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .blob: "blob"
                case .round: "round"
                case .triangle: "triangle"
                case .heart: "heart"
                case .cookie: "cookie"
                case .star: "star"
                case .flower: "flower"
                case .cloud: "cloud"
                case .drop: "drop"
                case .ghost: "ghost"
                case .pill: "pill"
                case .block: "block"
                case .hexagon: "hexagon"
                case .empty: ""
                case .unrecognized(let value): value
                }
            }
        }

        enum Ears: RawRepresentable, Codable, Hashable, Sendable {
            case cat
            case bear
            case bunny
            case antenna
            case sprout
            case horns
            case empty
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "cat": self = .cat
                case "bear": self = .bear
                case "bunny": self = .bunny
                case "antenna": self = .antenna
                case "sprout": self = .sprout
                case "horns": self = .horns
                case "": self = .empty
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .cat: "cat"
                case .bear: "bear"
                case .bunny: "bunny"
                case .antenna: "antenna"
                case .sprout: "sprout"
                case .horns: "horns"
                case .empty: ""
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BotCatalog: Codable, Hashable, Sendable {
        var tools: [BotCatalogTool]
        var skills: [BotCatalogSkill]
        var alwaysOn: [AlwaysOnItem]
        var disabledTools: [String]
        var disabledSkills: [BotSkillRef]
        var live: Bool
        var request: BotAccessRequest?

        struct AlwaysOnItem: Codable, Hashable, Sendable {
            var name: String
            var description: String
        }
    }

    struct BotCatalogSkill: Codable, Hashable, Sendable {
        var name: String
        var path: String
        var description: String
        var source: String
        var enabled: Bool
    }

    struct BotCatalogTool: Codable, Hashable, Sendable {
        var name: String
        var label: String
        var description: String
        var group: BotToolGroup
        var source: String
        var powerful: Bool
        var enabled: Bool
    }

    typealias BotDeleteResponse = JSONValue

    struct BotDeleted: Codable, Hashable, Sendable {
        var ok: Bool = true
        var queued: Bool?
    }

    struct BotDelivery: Codable, Hashable, Sendable {
        var status: Status

        enum Status: RawRepresentable, Codable, Hashable, Sendable {
            case sent
            case queued
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "sent": self = .sent
                case "queued": self = .queued
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .sent: "sent"
                case .queued: "queued"
                case .unrecognized(let value): value
                }
            }
        }
    }

    enum BotFaceEars: RawRepresentable, Codable, Hashable, Sendable {
        case cat
        case bear
        case bunny
        case antenna
        case sprout
        case horns
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "cat": self = .cat
            case "bear": self = .bear
            case "bunny": self = .bunny
            case "antenna": self = .antenna
            case "sprout": self = .sprout
            case "horns": self = .horns
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .cat: "cat"
            case .bear: "bear"
            case .bunny: "bunny"
            case .antenna: "antenna"
            case .sprout: "sprout"
            case .horns: "horns"
            case .unrecognized(let value): value
            }
        }
    }

    enum BotFaceShape: RawRepresentable, Codable, Hashable, Sendable {
        case blob
        case round
        case triangle
        case heart
        case cookie
        case star
        case flower
        case cloud
        case drop
        case ghost
        case pill
        case block
        case hexagon
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "blob": self = .blob
            case "round": self = .round
            case "triangle": self = .triangle
            case "heart": self = .heart
            case "cookie": self = .cookie
            case "star": self = .star
            case "flower": self = .flower
            case "cloud": self = .cloud
            case "drop": self = .drop
            case "ghost": self = .ghost
            case "pill": self = .pill
            case "block": self = .block
            case "hexagon": self = .hexagon
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .blob: "blob"
            case .round: "round"
            case .triangle: "triangle"
            case .heart: "heart"
            case .cookie: "cookie"
            case .star: "star"
            case .flower: "flower"
            case .cloud: "cloud"
            case .drop: "drop"
            case .ghost: "ghost"
            case .pill: "pill"
            case .block: "block"
            case .hexagon: "hexagon"
            case .unrecognized(let value): value
            }
        }
    }

    struct BotFact: Codable, Hashable, Sendable {
        var id: String
        var kind: BotFactKind
        var text: String
        var pinned: Bool
        var source: String
        var createdAt: String
        var updatedAt: String
        var revision: Double
    }

    struct BotFactInput: Codable, Hashable, Sendable {
        var kind: BotFactKind
        var text: String
        var source: String?
        var pinned: Bool?
    }

    enum BotFactKind: RawRepresentable, Codable, Hashable, Sendable {
        case fact
        case preference
        case decision
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "fact": self = .fact
            case "preference": self = .preference
            case "decision": self = .decision
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .fact: "fact"
            case .preference: "preference"
            case .decision: "decision"
            case .unrecognized(let value): value
            }
        }
    }

    struct BotFactPatch: Codable, Hashable, Sendable {
        var kind: BotFactKind?
        var text: String?
        var pinned: Bool?
        var revision: Double
    }

    struct BotFactsResponse: Codable, Hashable, Sendable {
        var facts: [BotFact]
    }

    struct BotInput: Codable, Hashable, Sendable {
        var name: String?
        var handle: String?
        var title: String?
        var description: String?
        var tagging: BotTagging?
        var cwd: String?
        var model: String?
        var thinking: String?
        var memoryModel: String?
        var memoryThinking: String?
        var hidden: Bool?
        var disabledTools: [String]?
        var disabledSkills: [BotSkillSelector]?
        var soul: String?
        var worker: String?
        var avatar: BotAvatar?
        var voice: BotVoice?
    }

    struct BotLastMessage: Codable, Hashable, Sendable {
        var role: Role
        var text: String
        var at: String

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

    struct BotMemoryResponse: Codable, Hashable, Sendable {
        var status: BotMemoryStatus
        var view: String
    }

    struct BotMemoryStatus: Codable, Hashable, Sendable {
        var messages: Double
        var built: Double
        var pending: Double
        var viewBytes: Double
        var viewLines: Double
        var waiting: Bool?
        var failing: Failing?
        var usage: BotMemoryUsage

        struct Failing: Codable, Hashable, Sendable {
            var node: String
            var error: String
            var since: String
        }
    }

    struct BotMemoryUsage: Codable, Hashable, Sendable {
        var calls: Double
        var input: Double
        var output: Double
        var cacheRead: Double
        var cacheWrite: Double
        var cost: Double
    }

    struct BotMemoryZoom: Codable, Hashable, Sendable {
        var text: String
    }

    struct BotMessageRequest: Codable, Hashable, Sendable {
        var text: String?
        var attachments: [JSONValue]?
        var wait: Bool?
        var timeoutSeconds: Double?
    }

    enum BotMessageResult: Codable, Hashable, Sendable {
        case botDelivery(BotDelivery)
        case botReply(BotReply)
        case unrecognized(JSONValue)

        private enum Discriminator: String, CodingKey {
            case status
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Discriminator.self)
            switch try container.decode(String.self, forKey: .status) {
            case "sent", "queued": self = try .botDelivery(BotDelivery(from: decoder))
            case "answered", "failed", "needs-input", "timeout": self = try .botReply(BotReply(from: decoder))
            default: self = try .unrecognized(JSONValue(from: decoder))
            }
        }

        func encode(to encoder: any Encoder) throws {
            switch self {
            case .botDelivery(let value): try value.encode(to: encoder)
            case .botReply(let value): try value.encode(to: encoder)
            case .unrecognized(let value): try value.encode(to: encoder)
            }
        }
    }

    struct BotPatch: Codable, Hashable, Sendable {
        var name: String?
        var handle: String?
        var title: String?
        var description: String?
        var tagging: BotTagging?
        var cwd: String?
        var model: String?
        var thinking: String?
        var memoryModel: String?
        var memoryThinking: String?
        var hidden: Bool?
        var disabledTools: [String]?
        var disabledSkills: [BotSkillSelector]?
        var avatar: BotAvatarPatch?
        var voice: BotVoicePatch?
    }

    struct BotQuestion: Codable, Hashable, Sendable {
        var id: String
        var method: Method
        var title: String
        var message: String?
        var options: [String]?
        var placeholder: String?
        var prefill: String?

        enum Method: RawRepresentable, Codable, Hashable, Sendable {
            case select
            case confirm
            case input
            case editor
            case secret
            case questionnaire
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "select": self = .select
                case "confirm": self = .confirm
                case "input": self = .input
                case "editor": self = .editor
                case "secret": self = .secret
                case "questionnaire": self = .questionnaire
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .select: "select"
                case .confirm: "confirm"
                case .input: "input"
                case .editor: "editor"
                case .secret: "secret"
                case .questionnaire: "questionnaire"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BotReply: Codable, Hashable, Sendable {
        var status: Status
        var reply: String?
        var error: String?
        var questions: [BotQuestion]?

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

    struct BotResponse: Codable, Hashable, Sendable {
        var bot: BotView
    }

    enum BotSessionStatus: RawRepresentable, Codable, Hashable, Sendable {
        case idle
        case running
        case waiting
        case starting
        case error
        case reconnecting
        case disconnected
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "idle": self = .idle
            case "running": self = .running
            case "waiting": self = .waiting
            case "starting": self = .starting
            case "error": self = .error
            case "reconnecting": self = .reconnecting
            case "disconnected": self = .disconnected
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .idle: "idle"
            case .running: "running"
            case .waiting: "waiting"
            case .starting: "starting"
            case .error: "error"
            case .reconnecting: "reconnecting"
            case .disconnected: "disconnected"
            case .unrecognized(let value): value
            }
        }
    }

    struct BotSkillRef: Codable, Hashable, Sendable {
        var name: String
        var path: String
    }

    typealias BotSkillSelector = JSONValue

    struct BotSoul: Codable, Hashable, Sendable {
        var soul: String?

        enum CodingKeys: String, CodingKey {
            case soul
        }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(soul, forKey: .soul)
        }
    }

    struct BotSoulRequest: Codable, Hashable, Sendable {
        var soul: String
    }

    enum BotTagging: RawRepresentable, Codable, Hashable, Sendable {
        case anyone
        case mention
        case nobody
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "anyone": self = .anyone
            case "mention": self = .mention
            case "nobody": self = .nobody
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .anyone: "anyone"
            case .mention: "mention"
            case .nobody: "nobody"
            case .unrecognized(let value): value
            }
        }
    }

    enum BotToolGroup: RawRepresentable, Codable, Hashable, Sendable {
        case files
        case shell
        case hui
        case `extension`
        case bots
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "files": self = .files
            case "shell": self = .shell
            case "hui": self = .hui
            case "extension": self = .`extension`
            case "bots": self = .bots
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .files: "files"
            case .shell: "shell"
            case .hui: "hui"
            case .`extension`: "extension"
            case .bots: "bots"
            case .unrecognized(let value): value
            }
        }
    }

    struct BotView: Codable, Hashable, Sendable {
        var id: String
        var handle: String
        var name: String
        var title: String?
        var description: String?
        var tagging: Tagging?
        var cwd: String
        var model: String?
        var thinking: String?
        var memoryModel: String?
        var memoryThinking: String?
        var avatar: BotAvatar?
        var voice: BotVoice?
        var hidden: Bool?
        var archived: Bool?
        var disabledTools: [String]?
        var disabledSkills: [BotSkillRef]?
        var sessionId: String
        var createdAt: String
        var updatedAt: String
        var worker: Worker?
        var status: BotSessionStatus
        var soul: Bool
        var lastMessage: BotLastMessage?
        var unread: Bool
        var memory: BotMemoryStatus?
        var routines: Double

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

        struct Worker: Codable, Hashable, Sendable {
            var id: String
            var name: String
        }
    }

    struct BotVoice: Codable, Hashable, Sendable {
        var language: VoiceLanguage?
        var live: GptLiveVoice?
    }

    struct BotVoicePatch: Codable, Hashable, Sendable {
        var language: Language?
        var live: Live?

        enum Language: RawRepresentable, Codable, Hashable, Sendable {
            case en
            case zh
            case de
            case es
            case ru
            case ko
            case fr
            case ja
            case pt
            case tr
            case pl
            case ca
            case nl
            case ar
            case sv
            case it
            case id
            case hi
            case fi
            case vi
            case he
            case uk
            case el
            case ms
            case cs
            case ro
            case da
            case hu
            case ta
            case no
            case th
            case ur
            case hr
            case bg
            case lt
            case la
            case mi
            case ml
            case cy
            case sk
            case te
            case fa
            case lv
            case bn
            case sr
            case az
            case sl
            case kn
            case et
            case mk
            case br
            case eu
            case `is`
            case hy
            case ne
            case mn
            case bs
            case kk
            case sq
            case sw
            case gl
            case mr
            case pa
            case si
            case km
            case sn
            case yo
            case so
            case af
            case oc
            case ka
            case be
            case tg
            case sd
            case gu
            case am
            case yi
            case lo
            case uz
            case fo
            case ht
            case ps
            case tk
            case nn
            case mt
            case sa
            case lb
            case my
            case bo
            case tl
            case mg
            case `as`
            case tt
            case haw
            case ln
            case ha
            case ba
            case jw
            case su
            case yue
            case empty
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "en": self = .en
                case "zh": self = .zh
                case "de": self = .de
                case "es": self = .es
                case "ru": self = .ru
                case "ko": self = .ko
                case "fr": self = .fr
                case "ja": self = .ja
                case "pt": self = .pt
                case "tr": self = .tr
                case "pl": self = .pl
                case "ca": self = .ca
                case "nl": self = .nl
                case "ar": self = .ar
                case "sv": self = .sv
                case "it": self = .it
                case "id": self = .id
                case "hi": self = .hi
                case "fi": self = .fi
                case "vi": self = .vi
                case "he": self = .he
                case "uk": self = .uk
                case "el": self = .el
                case "ms": self = .ms
                case "cs": self = .cs
                case "ro": self = .ro
                case "da": self = .da
                case "hu": self = .hu
                case "ta": self = .ta
                case "no": self = .no
                case "th": self = .th
                case "ur": self = .ur
                case "hr": self = .hr
                case "bg": self = .bg
                case "lt": self = .lt
                case "la": self = .la
                case "mi": self = .mi
                case "ml": self = .ml
                case "cy": self = .cy
                case "sk": self = .sk
                case "te": self = .te
                case "fa": self = .fa
                case "lv": self = .lv
                case "bn": self = .bn
                case "sr": self = .sr
                case "az": self = .az
                case "sl": self = .sl
                case "kn": self = .kn
                case "et": self = .et
                case "mk": self = .mk
                case "br": self = .br
                case "eu": self = .eu
                case "is": self = .`is`
                case "hy": self = .hy
                case "ne": self = .ne
                case "mn": self = .mn
                case "bs": self = .bs
                case "kk": self = .kk
                case "sq": self = .sq
                case "sw": self = .sw
                case "gl": self = .gl
                case "mr": self = .mr
                case "pa": self = .pa
                case "si": self = .si
                case "km": self = .km
                case "sn": self = .sn
                case "yo": self = .yo
                case "so": self = .so
                case "af": self = .af
                case "oc": self = .oc
                case "ka": self = .ka
                case "be": self = .be
                case "tg": self = .tg
                case "sd": self = .sd
                case "gu": self = .gu
                case "am": self = .am
                case "yi": self = .yi
                case "lo": self = .lo
                case "uz": self = .uz
                case "fo": self = .fo
                case "ht": self = .ht
                case "ps": self = .ps
                case "tk": self = .tk
                case "nn": self = .nn
                case "mt": self = .mt
                case "sa": self = .sa
                case "lb": self = .lb
                case "my": self = .my
                case "bo": self = .bo
                case "tl": self = .tl
                case "mg": self = .mg
                case "as": self = .`as`
                case "tt": self = .tt
                case "haw": self = .haw
                case "ln": self = .ln
                case "ha": self = .ha
                case "ba": self = .ba
                case "jw": self = .jw
                case "su": self = .su
                case "yue": self = .yue
                case "": self = .empty
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .en: "en"
                case .zh: "zh"
                case .de: "de"
                case .es: "es"
                case .ru: "ru"
                case .ko: "ko"
                case .fr: "fr"
                case .ja: "ja"
                case .pt: "pt"
                case .tr: "tr"
                case .pl: "pl"
                case .ca: "ca"
                case .nl: "nl"
                case .ar: "ar"
                case .sv: "sv"
                case .it: "it"
                case .id: "id"
                case .hi: "hi"
                case .fi: "fi"
                case .vi: "vi"
                case .he: "he"
                case .uk: "uk"
                case .el: "el"
                case .ms: "ms"
                case .cs: "cs"
                case .ro: "ro"
                case .da: "da"
                case .hu: "hu"
                case .ta: "ta"
                case .no: "no"
                case .th: "th"
                case .ur: "ur"
                case .hr: "hr"
                case .bg: "bg"
                case .lt: "lt"
                case .la: "la"
                case .mi: "mi"
                case .ml: "ml"
                case .cy: "cy"
                case .sk: "sk"
                case .te: "te"
                case .fa: "fa"
                case .lv: "lv"
                case .bn: "bn"
                case .sr: "sr"
                case .az: "az"
                case .sl: "sl"
                case .kn: "kn"
                case .et: "et"
                case .mk: "mk"
                case .br: "br"
                case .eu: "eu"
                case .`is`: "is"
                case .hy: "hy"
                case .ne: "ne"
                case .mn: "mn"
                case .bs: "bs"
                case .kk: "kk"
                case .sq: "sq"
                case .sw: "sw"
                case .gl: "gl"
                case .mr: "mr"
                case .pa: "pa"
                case .si: "si"
                case .km: "km"
                case .sn: "sn"
                case .yo: "yo"
                case .so: "so"
                case .af: "af"
                case .oc: "oc"
                case .ka: "ka"
                case .be: "be"
                case .tg: "tg"
                case .sd: "sd"
                case .gu: "gu"
                case .am: "am"
                case .yi: "yi"
                case .lo: "lo"
                case .uz: "uz"
                case .fo: "fo"
                case .ht: "ht"
                case .ps: "ps"
                case .tk: "tk"
                case .nn: "nn"
                case .mt: "mt"
                case .sa: "sa"
                case .lb: "lb"
                case .my: "my"
                case .bo: "bo"
                case .tl: "tl"
                case .mg: "mg"
                case .`as`: "as"
                case .tt: "tt"
                case .haw: "haw"
                case .ln: "ln"
                case .ha: "ha"
                case .ba: "ba"
                case .jw: "jw"
                case .su: "su"
                case .yue: "yue"
                case .empty: ""
                case .unrecognized(let value): value
                }
            }
        }

        enum Live: RawRepresentable, Codable, Hashable, Sendable {
            case cove
            case arbor
            case breeze
            case ember
            case juniper
            case maple
            case sol
            case spruce
            case vale
            case empty
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "cove": self = .cove
                case "arbor": self = .arbor
                case "breeze": self = .breeze
                case "ember": self = .ember
                case "juniper": self = .juniper
                case "maple": self = .maple
                case "sol": self = .sol
                case "spruce": self = .spruce
                case "vale": self = .vale
                case "": self = .empty
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .cove: "cove"
                case .arbor: "arbor"
                case .breeze: "breeze"
                case .ember: "ember"
                case .juniper: "juniper"
                case .maple: "maple"
                case .sol: "sol"
                case .spruce: "spruce"
                case .vale: "vale"
                case .empty: ""
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct BotsResponse: Codable, Hashable, Sendable {
        var bots: [BotView]
    }

    struct BotsStreamFrame: Codable, Hashable, Sendable {
        var event: String = "bots"
        var data: BotsUpdate
    }

    struct BotsUpdate: Codable, Hashable, Sendable {
        var revision: Double
        var ids: [String]?
        var upserts: [BotView]
    }

    enum GptLiveVoice: RawRepresentable, Codable, Hashable, Sendable {
        case cove
        case arbor
        case breeze
        case ember
        case juniper
        case maple
        case sol
        case spruce
        case vale
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "cove": self = .cove
            case "arbor": self = .arbor
            case "breeze": self = .breeze
            case "ember": self = .ember
            case "juniper": self = .juniper
            case "maple": self = .maple
            case "sol": self = .sol
            case "spruce": self = .spruce
            case "vale": self = .vale
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .cove: "cove"
            case .arbor: "arbor"
            case .breeze: "breeze"
            case .ember: "ember"
            case .juniper: "juniper"
            case .maple: "maple"
            case .sol: "sol"
            case .spruce: "spruce"
            case .vale: "vale"
            case .unrecognized(let value): value
            }
        }
    }

    enum VoiceLanguage: RawRepresentable, Codable, Hashable, Sendable {
        case en
        case zh
        case de
        case es
        case ru
        case ko
        case fr
        case ja
        case pt
        case tr
        case pl
        case ca
        case nl
        case ar
        case sv
        case it
        case id
        case hi
        case fi
        case vi
        case he
        case uk
        case el
        case ms
        case cs
        case ro
        case da
        case hu
        case ta
        case no
        case th
        case ur
        case hr
        case bg
        case lt
        case la
        case mi
        case ml
        case cy
        case sk
        case te
        case fa
        case lv
        case bn
        case sr
        case az
        case sl
        case kn
        case et
        case mk
        case br
        case eu
        case `is`
        case hy
        case ne
        case mn
        case bs
        case kk
        case sq
        case sw
        case gl
        case mr
        case pa
        case si
        case km
        case sn
        case yo
        case so
        case af
        case oc
        case ka
        case be
        case tg
        case sd
        case gu
        case am
        case yi
        case lo
        case uz
        case fo
        case ht
        case ps
        case tk
        case nn
        case mt
        case sa
        case lb
        case my
        case bo
        case tl
        case mg
        case `as`
        case tt
        case haw
        case ln
        case ha
        case ba
        case jw
        case su
        case yue
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "en": self = .en
            case "zh": self = .zh
            case "de": self = .de
            case "es": self = .es
            case "ru": self = .ru
            case "ko": self = .ko
            case "fr": self = .fr
            case "ja": self = .ja
            case "pt": self = .pt
            case "tr": self = .tr
            case "pl": self = .pl
            case "ca": self = .ca
            case "nl": self = .nl
            case "ar": self = .ar
            case "sv": self = .sv
            case "it": self = .it
            case "id": self = .id
            case "hi": self = .hi
            case "fi": self = .fi
            case "vi": self = .vi
            case "he": self = .he
            case "uk": self = .uk
            case "el": self = .el
            case "ms": self = .ms
            case "cs": self = .cs
            case "ro": self = .ro
            case "da": self = .da
            case "hu": self = .hu
            case "ta": self = .ta
            case "no": self = .no
            case "th": self = .th
            case "ur": self = .ur
            case "hr": self = .hr
            case "bg": self = .bg
            case "lt": self = .lt
            case "la": self = .la
            case "mi": self = .mi
            case "ml": self = .ml
            case "cy": self = .cy
            case "sk": self = .sk
            case "te": self = .te
            case "fa": self = .fa
            case "lv": self = .lv
            case "bn": self = .bn
            case "sr": self = .sr
            case "az": self = .az
            case "sl": self = .sl
            case "kn": self = .kn
            case "et": self = .et
            case "mk": self = .mk
            case "br": self = .br
            case "eu": self = .eu
            case "is": self = .`is`
            case "hy": self = .hy
            case "ne": self = .ne
            case "mn": self = .mn
            case "bs": self = .bs
            case "kk": self = .kk
            case "sq": self = .sq
            case "sw": self = .sw
            case "gl": self = .gl
            case "mr": self = .mr
            case "pa": self = .pa
            case "si": self = .si
            case "km": self = .km
            case "sn": self = .sn
            case "yo": self = .yo
            case "so": self = .so
            case "af": self = .af
            case "oc": self = .oc
            case "ka": self = .ka
            case "be": self = .be
            case "tg": self = .tg
            case "sd": self = .sd
            case "gu": self = .gu
            case "am": self = .am
            case "yi": self = .yi
            case "lo": self = .lo
            case "uz": self = .uz
            case "fo": self = .fo
            case "ht": self = .ht
            case "ps": self = .ps
            case "tk": self = .tk
            case "nn": self = .nn
            case "mt": self = .mt
            case "sa": self = .sa
            case "lb": self = .lb
            case "my": self = .my
            case "bo": self = .bo
            case "tl": self = .tl
            case "mg": self = .mg
            case "as": self = .`as`
            case "tt": self = .tt
            case "haw": self = .haw
            case "ln": self = .ln
            case "ha": self = .ha
            case "ba": self = .ba
            case "jw": self = .jw
            case "su": self = .su
            case "yue": self = .yue
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .en: "en"
            case .zh: "zh"
            case .de: "de"
            case .es: "es"
            case .ru: "ru"
            case .ko: "ko"
            case .fr: "fr"
            case .ja: "ja"
            case .pt: "pt"
            case .tr: "tr"
            case .pl: "pl"
            case .ca: "ca"
            case .nl: "nl"
            case .ar: "ar"
            case .sv: "sv"
            case .it: "it"
            case .id: "id"
            case .hi: "hi"
            case .fi: "fi"
            case .vi: "vi"
            case .he: "he"
            case .uk: "uk"
            case .el: "el"
            case .ms: "ms"
            case .cs: "cs"
            case .ro: "ro"
            case .da: "da"
            case .hu: "hu"
            case .ta: "ta"
            case .no: "no"
            case .th: "th"
            case .ur: "ur"
            case .hr: "hr"
            case .bg: "bg"
            case .lt: "lt"
            case .la: "la"
            case .mi: "mi"
            case .ml: "ml"
            case .cy: "cy"
            case .sk: "sk"
            case .te: "te"
            case .fa: "fa"
            case .lv: "lv"
            case .bn: "bn"
            case .sr: "sr"
            case .az: "az"
            case .sl: "sl"
            case .kn: "kn"
            case .et: "et"
            case .mk: "mk"
            case .br: "br"
            case .eu: "eu"
            case .`is`: "is"
            case .hy: "hy"
            case .ne: "ne"
            case .mn: "mn"
            case .bs: "bs"
            case .kk: "kk"
            case .sq: "sq"
            case .sw: "sw"
            case .gl: "gl"
            case .mr: "mr"
            case .pa: "pa"
            case .si: "si"
            case .km: "km"
            case .sn: "sn"
            case .yo: "yo"
            case .so: "so"
            case .af: "af"
            case .oc: "oc"
            case .ka: "ka"
            case .be: "be"
            case .tg: "tg"
            case .sd: "sd"
            case .gu: "gu"
            case .am: "am"
            case .yi: "yi"
            case .lo: "lo"
            case .uz: "uz"
            case .fo: "fo"
            case .ht: "ht"
            case .ps: "ps"
            case .tk: "tk"
            case .nn: "nn"
            case .mt: "mt"
            case .sa: "sa"
            case .lb: "lb"
            case .my: "my"
            case .bo: "bo"
            case .tl: "tl"
            case .mg: "mg"
            case .`as`: "as"
            case .tt: "tt"
            case .haw: "haw"
            case .ln: "ln"
            case .ha: "ha"
            case .ba: "ba"
            case .jw: "jw"
            case .su: "su"
            case .yue: "yue"
            case .unrecognized(let value): value
            }
        }
    }
}
