// Server-sent events from the gateway: SSEFramer cuts a byte stream into the text of each frame (CRLF or LF line
// ends, multi-line data, a multi-byte character split across chunks), and the core's decodeSseFrame turns that text
// into a typed frame, as the web's stream readers do.
import Foundation

struct SSEFramer {
    private var line: [UInt8] = []
    private var lines: [String] = []

    mutating func push(_ byte: UInt8) -> String? {
        guard byte == UInt8(ascii: "\n") else {
            line.append(byte)
            return nil
        }
        if line.last == UInt8(ascii: "\r") { line.removeLast() }
        defer { line.removeAll(keepingCapacity: true) }
        guard line.isEmpty else {
            lines.append(String(decoding: line, as: UTF8.self))
            return nil
        }
        guard !lines.isEmpty else { return nil }
        defer { lines.removeAll() }
        return lines.joined(separator: "\n")
    }
}

extension HUICore {
    func decodeFrame<Frame: Decodable>(_ chunk: String, as _: Frame.Type) throws -> Frame? {
        guard let frame = try decodeSseFrame(chunk) else { return nil }
        let tagged = API.JSONValue.object(["event": .string(frame.name), "data": frame.payload])
        return try JSONDecoder().decode(Frame.self, from: JSONEncoder().encode(tagged))
    }
}
