// The gateway version check: which gateways get a notice, and what it names, prereleases included.
import Testing
@testable import HUI

struct GatewayModelTests {
    @Test func namesBothVersionsWhenTheGatewayIsOlderOrNewer() {
        #expect(GatewayModel.versionNotice(gateway: "0.1.4", app: "0.1.5") == "This gateway runs HUI 0.1.4, older than this app supports (0.1.5). Update the gateway.")
        #expect(GatewayModel.versionNotice(gateway: "0.1.10", app: "0.1.5") == "This gateway runs HUI 0.1.10, newer than this app (0.1.5).")
        #expect(GatewayModel.versionNotice(gateway: "0.1.5", app: "0.1.5") == nil)
    }

    @Test func aPrereleaseIsOlderThanItsReleaseAndNewerThanTheOneBefore() {
        let nightly = "0.1.5-nightly.20261021093000.gabc1234"
        #expect(GatewayModel.versionNotice(gateway: nightly, app: "0.1.5") == "This gateway runs HUI \(nightly), older than this app supports (0.1.5). Update the gateway.")
        #expect(GatewayModel.versionNotice(gateway: "0.1.5", app: nightly) == "This gateway runs HUI 0.1.5, newer than this app (\(nightly)).")
        #expect(GatewayModel.versionNotice(gateway: nightly, app: "0.1.4") == "This gateway runs HUI \(nightly), newer than this app (0.1.4).")
        #expect(GatewayModel.versionNotice(gateway: "0.1.5-nightly.20261022093000.gdef5678", app: nightly) == "This gateway runs HUI 0.1.5-nightly.20261022093000.gdef5678, newer than this app (\(nightly)).")
        #expect(GatewayModel.versionNotice(gateway: nightly, app: nightly) == nil)
    }

    @Test func anUnversionedGatewayIsUnverified() {
        #expect(GatewayModel.versionNotice(gateway: nil, app: "0.1.5") == "Development gateway: its version is unverified.")
    }
}
