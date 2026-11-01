// Payloads recorded from a fixture gateway decode into the generated API types, and a refusal keeps its status and
// the gateway's message.
import Foundation
import Testing
@testable import HUI

struct GatewayClientTests {
    @Test func decodesRecordedResponses() throws {
        let update = try JSONDecoder().decode(API.UpdateSnapshot.self, from: fixture("update.json"))
        #expect(update.currentVersion == nil)
        let list = try JSONDecoder().decode(API.SessionList.self, from: fixture("sessions.json"))
        #expect(list.groups.flatMap(\.sessions).map(\.title).sorted() == ["Fix the login bug", "Write release notes"])
    }

    @Test func aRefusalKeepsItsStatusAndMessage() throws {
        let url = URL(string: "http://127.0.0.1:1/__hui/sessions/missing")!
        let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!
        #expect(throws: GatewayError(status: 404, message: "unknown route: /__hui/sessions/does-not-exist")) {
            try GatewayClient.check(response, path: url.path, body: fixture("error-not-found.json"))
        }
        #expect(throws: GatewayError(status: 500, message: "/x returned HTTP 500")) {
            try GatewayClient.check(HTTPURLResponse(url: url, statusCode: 500, httpVersion: nil, headerFields: nil)!, path: "/x", body: Data())
        }
    }

    @Test func everyRequestCarriesTheClientHeaderAndDeadline() throws {
        let client = GatewayClient(baseURL: URL(string: "http://127.0.0.1:4000")!)
        let request = try client.request("/__hui/update")
        #expect(request.url?.absoluteString == "http://127.0.0.1:4000/__hui/update")
        #expect(request.value(forHTTPHeaderField: "x-hui") == "1")
        #expect(request.timeoutInterval == GatewayClient.responseTimeout)
    }
}
