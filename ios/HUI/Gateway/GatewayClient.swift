// The one client for a gateway's /__hui/ routes, as src/api/request.ts is on the web: every request carries
// `x-hui: 1` and the same 20 s response deadline, answers decode into the generated API types, and a refusal keeps
// its status and the gateway's own message. A timeout or lost connection, while asking or while reading a stream,
// reads as one of HUI's own messages instead of Foundation's.
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

    func request(_ path: String, timeout: TimeInterval = responseTimeout) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw GatewayError(message: "\(path) is not a gateway route") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.setValue("1", forHTTPHeaderField: "x-hui")
        return request
    }

    func get<Response: Decodable>(_ path: String, as _: Response.Type = Response.self) async throws -> Response {
        let (data, response) = try await reach(timeout: Self.responseTimeout) { try await URLSession.shared.data(for: request(path)) }
        try Self.check(response, path: path, body: data)
        return try JSONDecoder().decode(Response.self, from: data)
    }

    func stream(_ path: String) async throws -> URLSession.AsyncBytes {
        var request = try request(path, timeout: Self.streamStallTimeout)
        request.setValue("text/event-stream", forHTTPHeaderField: "accept")
        let (bytes, response) = try await reach(timeout: Self.streamStallTimeout) { try await URLSession.shared.bytes(for: request) }
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

    private func reach<T>(timeout: TimeInterval, _ operation: () async throws -> T) async throws -> T {
        do {
            return try await operation()
        } catch {
            throw Self.described(error, timeout: timeout)
        }
    }

    static func described(_ error: any Error, timeout: TimeInterval) -> any Error {
        guard let error = error as? URLError, error.code != .cancelled else { return error }
        if error.code == .timedOut {
            return GatewayError(message: "HUI did not answer within \(Int(timeout)) s. Check the connection and try again.")
        }
        return GatewayError(message: "Could not reach HUI. Check the connection and try again.")
    }

    private struct ErrorBody: Decodable {
        var error: String?
    }
}
