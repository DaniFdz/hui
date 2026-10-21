// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct BrowserSettings: Codable, Hashable, Sendable {
        var enabled: Bool
        var headless: Bool
        var executablePath: String
    }

    struct Settings: Codable, Hashable, Sendable {
        var theme: String
        var themeMode: ThemeMode
        var accent: String
        var fontUi: FontUi
        var fontChat: FontChat
        var fontTerminal: String
        var textScale: TextScale
        var chat: Chat
        var profileName: String
        var profileHandle: String
        var branchPrefix: String
        var browser: BrowserSettings
        var codemode: Codemode
        var questions: Questions
        var vscode: VscodeSettings
        var power: Power
        var models: Models
        var calls: Calls
        var disabledSkills: [DisabledSkillsItem]
        var disabledPlugins: [DisabledPluginsItem]
        var labs: Labs

        enum ThemeMode: RawRepresentable, Codable, Hashable, Sendable {
            case system
            case light
            case dark
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "system": self = .system
                case "light": self = .light
                case "dark": self = .dark
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .system: "system"
                case .light: "light"
                case .dark: "dark"
                case .unrecognized(let value): value
                }
            }
        }

        enum FontUi: RawRepresentable, Codable, Hashable, Sendable {
            case instrumentSans
            case geist
            case dmSans
            case ibmPlexSans
            case spaceGrotesk
            case atkinsonHyperlegible
            case fraunces
            case lora
            case jetbrainsMono
            case system
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "instrument-sans": self = .instrumentSans
                case "geist": self = .geist
                case "dm-sans": self = .dmSans
                case "ibm-plex-sans": self = .ibmPlexSans
                case "space-grotesk": self = .spaceGrotesk
                case "atkinson-hyperlegible": self = .atkinsonHyperlegible
                case "fraunces": self = .fraunces
                case "lora": self = .lora
                case "jetbrains-mono": self = .jetbrainsMono
                case "system": self = .system
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .instrumentSans: "instrument-sans"
                case .geist: "geist"
                case .dmSans: "dm-sans"
                case .ibmPlexSans: "ibm-plex-sans"
                case .spaceGrotesk: "space-grotesk"
                case .atkinsonHyperlegible: "atkinson-hyperlegible"
                case .fraunces: "fraunces"
                case .lora: "lora"
                case .jetbrainsMono: "jetbrains-mono"
                case .system: "system"
                case .unrecognized(let value): value
                }
            }
        }

        enum FontChat: RawRepresentable, Codable, Hashable, Sendable {
            case instrumentSans
            case geist
            case dmSans
            case ibmPlexSans
            case spaceGrotesk
            case atkinsonHyperlegible
            case fraunces
            case lora
            case jetbrainsMono
            case system
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "instrument-sans": self = .instrumentSans
                case "geist": self = .geist
                case "dm-sans": self = .dmSans
                case "ibm-plex-sans": self = .ibmPlexSans
                case "space-grotesk": self = .spaceGrotesk
                case "atkinson-hyperlegible": self = .atkinsonHyperlegible
                case "fraunces": self = .fraunces
                case "lora": self = .lora
                case "jetbrains-mono": self = .jetbrainsMono
                case "system": self = .system
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .instrumentSans: "instrument-sans"
                case .geist: "geist"
                case .dmSans: "dm-sans"
                case .ibmPlexSans: "ibm-plex-sans"
                case .spaceGrotesk: "space-grotesk"
                case .atkinsonHyperlegible: "atkinson-hyperlegible"
                case .fraunces: "fraunces"
                case .lora: "lora"
                case .jetbrainsMono: "jetbrains-mono"
                case .system: "system"
                case .unrecognized(let value): value
                }
            }
        }

        enum TextScale: RawRepresentable, Codable, Hashable, Sendable {
            case _90
            case _100
            case _110
            case _125
            case _140
            case unrecognized(Double)

            init(rawValue: Double) {
                switch rawValue {
                case 90: self = ._90
                case 100: self = ._100
                case 110: self = ._110
                case 125: self = ._125
                case 140: self = ._140
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: Double {
                switch self {
                case ._90: 90
                case ._100: 100
                case ._110: 110
                case ._125: 125
                case ._140: 140
                case .unrecognized(let value): value
                }
            }
        }

        struct Chat: Codable, Hashable, Sendable {
            var messageWidth: MessageWidth
            var collapseTaskProgress: Bool
            var sendShortcut: SendShortcut
            var githubEmbeds: Bool
            var datadogEmbeds: Bool

            enum MessageWidth: RawRepresentable, Codable, Hashable, Sendable {
                case compact
                case comfortable
                case wide
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "compact": self = .compact
                    case "comfortable": self = .comfortable
                    case "wide": self = .wide
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .compact: "compact"
                    case .comfortable: "comfortable"
                    case .wide: "wide"
                    case .unrecognized(let value): value
                    }
                }
            }

            enum SendShortcut: RawRepresentable, Codable, Hashable, Sendable {
                case enter
                case modifierEnter
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "enter": self = .enter
                    case "modifierEnter": self = .modifierEnter
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .enter: "enter"
                    case .modifierEnter: "modifierEnter"
                    case .unrecognized(let value): value
                    }
                }
            }
        }

        struct Codemode: Codable, Hashable, Sendable {
            var enabled: Bool
        }

        struct Questions: Codable, Hashable, Sendable {
            var timeoutMinutes: Double
        }

        struct Power: Codable, Hashable, Sendable {
            var keepAwake: Bool
        }

        struct Models: Codable, Hashable, Sendable {
            var primary: String
            var fallback: String
            var utility: String
        }

        struct Calls: Codable, Hashable, Sendable {
            var voice: Voice

            enum Voice: RawRepresentable, Codable, Hashable, Sendable {
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
        }

        struct DisabledSkillsItem: Codable, Hashable, Sendable {
            var name: String
            var path: String
        }

        struct DisabledPluginsItem: Codable, Hashable, Sendable {
            var id: String
            var name: String
            var kind: Kind

            enum Kind: RawRepresentable, Codable, Hashable, Sendable {
                case package
                case `extension`
                case unrecognized(String)

                init(rawValue: String) {
                    switch rawValue {
                    case "package": self = .package
                    case "extension": self = .`extension`
                    default: self = .unrecognized(rawValue)
                    }
                }

                var rawValue: String {
                    switch self {
                    case .package: "package"
                    case .`extension`: "extension"
                    case .unrecognized(let value): value
                    }
                }
            }
        }

        struct Labs: Codable, Hashable, Sendable {
            var denseObservability: Bool
            var detailedDebug: Bool
        }
    }

    struct SettingsError: Codable, Hashable, Sendable {
        var error: String
    }

    typealias SettingsRequest = JSONValue

    enum VscodeProviderPreference: RawRepresentable, Codable, Hashable, Sendable {
        case auto
        case configured
        case desktop
        case managed
        case path
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "auto": self = .auto
            case "configured": self = .configured
            case "desktop": self = .desktop
            case "managed": self = .managed
            case "path": self = .path
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .auto: "auto"
            case .configured: "configured"
            case .desktop: "desktop"
            case .managed: "managed"
            case .path: "path"
            case .unrecognized(let value): value
            }
        }
    }

    struct VscodeSettings: Codable, Hashable, Sendable {
        var enabled: Bool
        var executable: String
        var provider: VscodeProviderPreference
        var licenseAcceptedAt: String
    }
}
