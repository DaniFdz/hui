// Generated from docs/api.schema.json by scripts/api-schema.ts. Do not edit.

extension API {
    struct JiraConnectRequest: Codable, Hashable, Sendable {
        var site: String
        var email: String
        var token: String
        var defaultProject: String
    }

    struct JiraConnection: Codable, Hashable, Sendable {
        var configured: Bool
        var site: String
        var email: String
        var tokenSet: Bool
        var defaultProject: String
        var accountName: String?
    }

    struct JiraCreateRequest: Codable, Hashable, Sendable {
        var project: String
        var parent: String
        var summary: String
        var description: String
        var assignToMe: Bool?
        var suggestionId: String?
    }

    struct JiraCreateResponse: Codable, Hashable, Sendable {
        var issue: JiraIssueRef
        var session: SessionView?
        var warning: String?
    }

    struct JiraDefaultProjectRequest: Codable, Hashable, Sendable {
        var defaultProject: String
    }

    struct JiraDraft: Codable, Hashable, Sendable {
        var project: String
        var parents: [JiraParentCandidate]
        var parent: String
        var summary: String
        var description: String
        var model: String?
        var note: String?
        var parentChoice: ParentChoice?
        var rejectedParent: String?

        enum ParentChoice: RawRepresentable, Codable, Hashable, Sendable {
            case suggested
            case unmatched
            case noneAvailable
            case notDrafted
            case omitted
            case unrecognized(String)

            init(rawValue: String) {
                switch rawValue {
                case "suggested": self = .suggested
                case "unmatched": self = .unmatched
                case "none-available": self = .noneAvailable
                case "not-drafted": self = .notDrafted
                case "omitted": self = .omitted
                default: self = .unrecognized(rawValue)
                }
            }

            var rawValue: String {
                switch self {
                case .suggested: "suggested"
                case .unmatched: "unmatched"
                case .noneAvailable: "none-available"
                case .notDrafted: "not-drafted"
                case .omitted: "omitted"
                case .unrecognized(let value): value
                }
            }
        }
    }

    struct JiraDraftRequest: Codable, Hashable, Sendable {
        var project: String?
        var suggestionId: String?
    }

    struct JiraDraftResponse: Codable, Hashable, Sendable {
        var draft: JiraDraft
    }

    struct JiraError: Codable, Hashable, Sendable {
        var error: String
    }

    struct JiraIssueMatch: Codable, Hashable, Sendable {
        var key: String
        var url: String
        var summary: String
        var status: String?
        var statusCategory: JiraStatusCategory?
        var issueType: String?
    }

    struct JiraIssueRef: Codable, Hashable, Sendable {
        var key: String
        var url: String
    }

    struct JiraIssuesResponse: Codable, Hashable, Sendable {
        var issues: [JiraIssueMatch]
    }

    struct JiraLinkRequest: Codable, Hashable, Sendable {
        var key: String
    }

    struct JiraLinkResponse: Codable, Hashable, Sendable {
        var issue: JiraIssueRef
        var session: SessionView?
    }

    struct JiraParentCandidate: Codable, Hashable, Sendable {
        var key: String
        var summary: String
        var issueType: String
        var hierarchyLevel: Double
        var status: String?
    }

    struct JiraProject: Codable, Hashable, Sendable {
        var key: String
        var name: String
    }

    struct JiraProjectsResponse: Codable, Hashable, Sendable {
        var projects: [JiraProject]
        var total: Double
    }
}
