// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct ApiSchemaDocument: Codable, Hashable, Sendable {
        var schema: String = "https://json-schema.org/draft/2020-12/schema"
        var defs: [String: JSONValue]
        var xHuiApiVersion: String
        var xHuiAreas: [String: [String]]
        var xHuiRoutes: [ApiSchemaRoute]

        enum CodingKeys: String, CodingKey {
            case schema = "$schema"
            case defs = "$defs"
            case xHuiApiVersion = "x-hui-api-version"
            case xHuiAreas = "x-hui-areas"
            case xHuiRoutes = "x-hui-routes"
        }
    }

    struct ApiSchemaError: Codable, Hashable, Sendable {
        var error: String
    }

    struct ApiSchemaReference: Codable, Hashable, Sendable {
        var ref: String

        enum CodingKeys: String, CodingKey {
            case ref = "$ref"
        }
    }

    struct ApiSchemaRoute: Codable, Hashable, Sendable {
        var method: String
        var path: String
        var request: ApiSchemaReference?
        var response: ApiSchemaReference
        var events: ApiSchemaReference?
    }
}
