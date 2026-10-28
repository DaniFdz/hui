// Reads the payloads recorded from a fixture gateway (Fixtures/), which the tests bundle, and waits for a model to
// reach a state.
import Foundation
import Testing
@testable import HUI

private final class BundleToken {}

func fixture(_ name: String) throws -> Data {
    let parts = name.split(separator: ".")
    guard let url = Bundle(for: BundleToken.self).url(forResource: String(parts[0]), withExtension: String(parts[1])) else {
        throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: name])
    }
    return try Data(contentsOf: url)
}

func frames(_ bytes: some Sequence<UInt8>) -> [String] {
    var framer = SSEFramer()
    return bytes.compactMap { framer.push($0) }
}

@MainActor
func until(_ condition: () -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(10)
    while !condition() {
        guard ContinuousClock.now < deadline else {
            Issue.record("the model never reached the expected state")
            return
        }
        try await Task.sleep(for: .milliseconds(10))
    }
}
