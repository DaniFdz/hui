// The one client for a gateway's /__hui/ routes, as src/api/request.ts is on the web: every request carries
// `x-hui: 1` and the same 20 s response deadline, answers decode into the generated API types, and a refusal keeps
// its status and the gateway's own message.
import Foundation

struct GatewayError: Error, Equatable, LocalizedError {
    var status: Int?
    var message: String

    var errorDescription: String? { message }
}

struct GatewayClient: Sendable {
    static let responseTimeout: TimeInterval = 20
    static let streamStallTimeout: TimeInterval = 40

    let baseURL: URL
    var session: URLSession = .shared

    func request(_ path: String, method: String = "GET", body: (any Encodable)? = nil, timeout: TimeInterval = responseTimeout) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw GatewayError(message: "\(path) is not a gateway route") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("1", forHTTPHeaderField: "x-hui")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        return request
    }

    func send<Response: Decodable>(_ path: String, method: String = "GET", body: (any Encodable)? = nil, as _: Response.Type = Response.self) async throws -> Response {
        let (data, response) = try await reach { try await session.data(for: request(path, method: method, body: body)) }
        try Self.check(response, path: path, body: data)
        return try JSONDecoder().decode(Response.self, from: data)
    }

    func stream(_ path: String) async throws -> URLSession.AsyncBytes {
        var request = try request(path, timeout: Self.streamStallTimeout)
        request.setValue("text/event-stream", forHTTPHeaderField: "accept")
        let (bytes, response) = try await reach { try await session.bytes(for: request) }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw GatewayError(status: http.statusCode, message: "\(path) returned HTTP \(http.statusCode)")
        }
        return bytes
    }

    static func check(_ response: URLResponse, path: String, body: Data) throws {
        guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else { return }
        let detail = try? JSONDecoder().decode(ErrorBody.self, from: body)
        throw GatewayError(status: http.statusCode, message: detail?.error ?? "\(path) returned HTTP \(http.statusCode)")
    }

    private func reach<T>(_ operation: () async throws -> T) async throws -> T {
        do {
            return try await operation()
        } catch let error as URLError where error.code == .timedOut {
            throw GatewayError(message: "HUI did not answer within \(Int(Self.responseTimeout)) s. Check the connection and try again.")
        } catch let error as URLError where error.code != .cancelled {
            throw GatewayError(message: "Could not reach HUI. Check the connection and try again.")
        }
    }

    private struct ErrorBody: Decodable {
        var error: String?
    }
}
