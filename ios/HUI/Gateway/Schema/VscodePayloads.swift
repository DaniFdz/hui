// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    enum VscodeAction: RawRepresentable, Codable, Hashable, Sendable {
        case stop
        case acceptLicense
        case revokeLicense
        case install
        case cancelInstall
        case uninstall
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "stop": self = .stop
            case "accept-license": self = .acceptLicense
            case "revoke-license": self = .revokeLicense
            case "install": self = .install
            case "cancel-install": self = .cancelInstall
            case "uninstall": self = .uninstall
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .stop: "stop"
            case .acceptLicense: "accept-license"
            case .revokeLicense: "revoke-license"
            case .install: "install"
            case .cancelInstall: "cancel-install"
            case .uninstall: "uninstall"
            case .unrecognized(let value): value
            }
        }
    }

    struct VscodeActionRequest: Codable, Hashable, Sendable {
        var action: VscodeAction
    }

    struct VscodeConnectRequest: Codable, Hashable, Sendable {
        var theme: VscodeTheme?
    }

    typealias VscodeConnectResponse = JSONValue

    struct VscodeConnection: Codable, Hashable, Sendable {
        var url: String
        var folder: String
        var label: String
        var instance: Double
    }

    enum VscodeErrorCode: RawRepresentable, Codable, Hashable, Sendable {
        case setup
        case remote
        case folder
        case failed
        case busy
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "setup": self = .setup
            case "remote": self = .remote
            case "folder": self = .folder
            case "failed": self = .failed
            case "busy": self = .busy
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .setup: "setup"
            case .remote: "remote"
            case .folder: "folder"
            case .failed: "failed"
            case .busy: "busy"
            case .unrecognized(let value): value
            }
        }
    }

    struct VscodeFailure: Codable, Hashable, Sendable {
        var error: String
        var code: VscodeErrorCode
    }

    enum VscodeFlavor: RawRepresentable, Codable, Hashable, Sendable {
        case server
        case serveWeb
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "server": self = .server
            case "serve-web": self = .serveWeb
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .server: "server"
            case .serveWeb: "serve-web"
            case .unrecognized(let value): value
            }
        }
    }

    enum VscodeInstallPhase: RawRepresentable, Codable, Hashable, Sendable {
        case downloading
        case verifying
        case extracting
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "downloading": self = .downloading
            case "verifying": self = .verifying
            case "extracting": self = .extracting
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .downloading: "downloading"
            case .verifying: "verifying"
            case .extracting: "extracting"
            case .unrecognized(let value): value
            }
        }
    }

    struct VscodeInstallStatus: Codable, Hashable, Sendable {
        var supported: Bool
        var reason: String
        var version: String
        var arch: String
        var size: Double
        var dir: String
        var installed: Installed?
        var task: TaskValue?
        var error: String
        var hint: String

        struct Installed: Codable, Hashable, Sendable {
            var version: String
            var path: String
        }

        struct TaskValue: Codable, Hashable, Sendable {
            var phase: VscodeInstallPhase
            var received: Double
            var total: Double
        }
    }

    struct VscodePending: Codable, Hashable, Sendable {
        var pending: Bool = true
        var status: VscodeStatus
    }

    struct VscodeProvider: Codable, Hashable, Sendable {
        var kind: VscodeProviderKind
        var flavor: VscodeFlavor
        var path: String
        var name: String
        var version: String
        var commit: String?
    }

    enum VscodeProviderKind: RawRepresentable, Codable, Hashable, Sendable {
        case configured
        case desktop
        case managed
        case path
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "configured": self = .configured
            case "desktop": self = .desktop
            case "managed": self = .managed
            case "path": self = .path
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .configured: "configured"
            case .desktop: "desktop"
            case .managed: "managed"
            case .path: "path"
            case .unrecognized(let value): value
            }
        }
    }

    struct VscodeSetup: Codable, Hashable, Sendable {
        var needed: Bool
        var desktop: VscodeProvider?
        var install: Bool
        var download: Bool
    }

    enum VscodeState: RawRepresentable, Codable, Hashable, Sendable {
        case setup
        case stopped
        case starting
        case running
        case failed
        case unrecognized(String)

        init(rawValue: String) {
            switch rawValue {
            case "setup": self = .setup
            case "stopped": self = .stopped
            case "starting": self = .starting
            case "running": self = .running
            case "failed": self = .failed
            default: self = .unrecognized(rawValue)
            }
        }

        var rawValue: String {
            switch self {
            case .setup: "setup"
            case .stopped: "stopped"
            case .starting: "starting"
            case .running: "running"
            case .failed: "failed"
            case .unrecognized(let value): value
            }
        }
    }

    struct VscodeStatus: Codable, Hashable, Sendable {
        var platform: String
        var enabled: Bool
        var configuredExecutable: String
        var preference: VscodeProviderPreference
        var providers: [VscodeProvider]
        var problems: [String]
        var active: VscodeProvider?
        var activeError: String
        var setup: VscodeSetup
        var license: License
        var install: VscodeInstallStatus
        var state: VscodeState
        var running: VscodeProvider?
        var preparing: Preparing?
        var instance: Double
        var pid: Double?
        var startedAt: String?
        var lastError: String
        var connections: Double
        var idleMinutes: Double
        var dataDir: String

        struct License: Codable, Hashable, Sendable {
            var accepted: Bool
            var acceptedAt: String
        }

        struct Preparing: Codable, Hashable, Sendable {
            var received: Double
            var total: Double
        }
    }

    struct VscodeTheme: Codable, Hashable, Sendable {
        var background: String
        var panel: String
        var elevated: String
        var text: String
        var border: String?
        var accent: String?
    }
}
