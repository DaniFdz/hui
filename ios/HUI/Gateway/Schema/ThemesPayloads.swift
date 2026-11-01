// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct ThemeError: Codable, Hashable, Sendable {
        var error: String
    }

    typealias ThemeFile = [String: JSONValue]

    struct ThemeImportRequest: Codable, Hashable, Sendable {
        var url: String
    }

    struct ThemeImportResponse: Codable, Hashable, Sendable {
        var id: String
        var themes: [ThemeRef]
    }

    struct ThemeRef: Codable, Hashable, Sendable {
        var id: String
        var name: String
        var url: String
    }

    struct ThemesResponse: Codable, Hashable, Sendable {
        var themes: [ThemeRef]
    }
}
