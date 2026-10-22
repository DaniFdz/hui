// Reads the payloads recorded from a fixture gateway (Fixtures/), which the tests bundle.
import Foundation
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
