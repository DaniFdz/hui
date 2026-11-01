// The session stream's WebSocket (`POST /__hui/sessions/:id/connect` hands out its one-use address): text frames in,
// the close code once it ends. A WebSocket can't carry `x-hui`, so the upgrade carries an `Origin` equal to the
// gateway's own, which the gateway's same-origin check requires. Tests replace it with a stub.
import Foundation

protocol SessionSocket: Sendable {
    func receive() async throws -> String
    var closeCode: Int { get }
    func close()
}

struct WebSocketSession: SessionSocket {
    let task: URLSessionWebSocketTask

    static func connect(_ url: URL, origin: String) -> any SessionSocket {
        var request = URLRequest(url: url)
        request.setValue(origin, forHTTPHeaderField: "Origin")
        let task = URLSession.shared.webSocketTask(with: request)
        task.resume()
        return WebSocketSession(task: task)
    }

    func receive() async throws -> String {
        switch try await task.receive() {
        case .string(let text): return text
        case .data(let data): return String(decoding: data, as: UTF8.self)
        @unknown default: return ""
        }
    }

    var closeCode: Int { task.closeCode.rawValue }

    func close() {
        task.cancel(with: .normalClosure, reason: nil)
    }
}
