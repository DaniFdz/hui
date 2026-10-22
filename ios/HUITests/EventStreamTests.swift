// The SSE framing and the core's frame decoding, on synthetic streams and one recorded from a fixture gateway.
import Foundation
import Testing
@testable import HUI

struct EventStreamTests {
    @Test func cutsFramesOnBlankLinesWithLFOrCRLF() {
        #expect(frames(Array("event: a\ndata: 1\n\nevent: b\r\ndata: 2\r\n\r\n".utf8)) == ["event: a\ndata: 1", "event: b\ndata: 2"])
    }

    @Test func keepsMultiLineDataAndHeartbeatComments() async throws {
        let core = try HUICore.bundled()
        let chunks = frames(Array(": heartbeat\n\nevent: note\ndata: {\"a\":\ndata: 1}\n\n".utf8))
        #expect(chunks == [": heartbeat", "event: note\ndata: {\"a\":\ndata: 1}"])
        #expect(try await core.decodeSseFrame(chunks[0]) == nil)
        let frame = try #require(try await core.decodeSseFrame(chunks[1]))
        #expect(frame.name == "note")
        #expect(frame.payload == .object(["a": .number(1)]))
    }

    @Test func keepsAMultiByteCharacterSplitAcrossChunks() {
        let bytes = Array("data: {\"title\":\"caf\u{e9} \u{1F99E}\"}\n\n".utf8)
        var framer = SSEFramer()
        let split = bytes.firstIndex(of: 0xF0)! + 2
        let first = bytes[..<split].compactMap { framer.push($0) }
        let second = bytes[split...].compactMap { framer.push($0) }
        #expect(first.isEmpty)
        #expect(second == ["data: {\"title\":\"caf\u{e9} \u{1F99E}\"}"])
    }

    @Test func decodesTheRecordedSessionEventsStream() async throws {
        let core = try HUICore.bundled()
        var decoded: [API.SessionStatusStreamFrame] = []
        for chunk in frames(try fixture("sessions-events.txt")) {
            decoded.append(try #require(try await core.decodeFrame(chunk, as: API.SessionStatusStreamFrame.self)))
        }
        guard case .snapshot(let snapshot) = decoded.first, case .sessions(let sessions) = decoded[1] else {
            Issue.record("expected a snapshot, then the session list: \(decoded)")
            return
        }
        #expect(snapshot.data.statuses.count == 2)
        #expect(sessions.data.groups?.first?.ids.count == 2)
        #expect(decoded.contains { if case .status = $0 { true } else { false } })
    }
}
